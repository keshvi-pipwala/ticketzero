import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { verifyWebhook, triageWebhookLogs, signPayload } from "../src/webhooks.js";

const secret = "whsec_" + "ab".repeat(32);
const ts = "1760400000";
const raw = '{\n  "id": "evt_1",\n  "type": "withdrawal.completed",\n  "data": { "amountCents": 1200 }\n}';
const nodeSig = (key, msg) => createHmac("sha256", key).update(msg).digest("hex");

test("WebCrypto signature matches Node's HMAC-SHA256 over `${timestamp}.${rawBody}`", async () => {
  assert.equal(await signPayload(secret, ts, raw), nodeSig(secret, `${ts}.${raw}`));
});

test("valid signature verifies", async () => {
  const r = await verifyWebhook({ secret, timestamp: ts, rawBody: raw, signature: nodeSig(secret, `${ts}.${raw}`) });
  assert.equal(r.valid, true);
});

test("stale timestamp is flagged even with a correct signature", async () => {
  const r = await verifyWebhook({ secret, timestamp: ts, rawBody: raw, signature: nodeSig(secret, `${ts}.${raw}`), nowSec: Number(ts) + 3600 });
  assert.equal(r.valid, false);
  assert.match(r.reasons[0], /minutes from now/);
});

const cases = [
  ["reserialized", nodeSig(secret, `${ts}.${JSON.stringify(JSON.parse(raw))}`)],
  ["body-only", nodeSig(secret, raw)],
  ["secret-without-prefix", nodeSig(secret.slice(6), `${ts}.${raw}`)],
  ["ms-timestamp", nodeSig(secret, `${ts}000.${raw}`)],
];
for (const [variant, sig] of cases) {
  test(`diagnoses the ${variant} mistake`, async () => {
    const r = await verifyWebhook({ secret, timestamp: ts, rawBody: raw, signature: sig });
    assert.equal(r.valid, false);
    assert.equal(r.matchedVariant, variant);
  });
}

test("unknown mismatch points at the secret", async () => {
  const r = await verifyWebhook({ secret, timestamp: ts, rawBody: raw, signature: nodeSig("whsec_other", `${ts}.${raw}`) });
  assert.equal(r.matchedVariant, null);
  assert.match(r.reasons.at(-1), /secret is wrong/);
});

test("triage finds lost events, recovered retries and duplicate deliveries", () => {
  const logs = { data: [
    { eventId: "e1", eventType: "withdrawal.completed", success: false, statusCode: 503, createdAt: "1" },
    { eventId: "e1", eventType: "withdrawal.completed", success: false, statusCode: 503, createdAt: "2" },
    { eventId: "e1", eventType: "withdrawal.completed", success: false, statusCode: 503, createdAt: "3" },
    { eventId: "e2", eventType: "deposit.confirmed", success: false, statusCode: 500, createdAt: "1" },
    { eventId: "e2", eventType: "deposit.confirmed", success: true, statusCode: 200, createdAt: "2" },
    { eventId: "e3", eventType: "transfer.completed", success: true, statusCode: 200, createdAt: "1" },
    { eventId: "e3", eventType: "transfer.completed", success: true, statusCode: 200, createdAt: "9" },
    { eventId: "e4", eventType: "withdrawal.updated", success: false, statusCode: 401, createdAt: "1" },
  ] };
  const t = triageWebhookLogs(logs);
  assert.deepEqual(t.lost.map((l) => l.eventId).sort(), ["e1", "e4"]);
  assert.equal(t.recoveredAfterRetry, 1);
  assert.equal(t.duplicates.length, 1);
  assert.equal(t.replayCommands.length, 2);
  assert.ok(t.findings.some((f) => /does not retry/.test(f)));
});
