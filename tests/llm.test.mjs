import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPrompt, parseLabel, classifyWithLLM, reconcile } from "../src/llm.js";
import { handleTicket } from "../src/agent.js";

test("prompt lists every ticket type and the ticket", () => {
  const p = buildPrompt("where is my withdrawal");
  assert.match(p, /withdrawal_delayed/);
  assert.match(p, /connect_webhooks/);
  assert.match(p, /where is my withdrawal/);
});

test("parser accepts fenced JSON and rejects unknown intents", () => {
  assert.deepEqual(parseLabel('```json\n{"intent":"wallet_fee","confidence":0.9,"reason":"fee"}\n```'), { intent: "wallet_fee", confidence: 0.9, reason: "fee" });
  assert.equal(parseLabel('{"intent":"make_coffee","confidence":1}'), null);
  assert.equal(parseLabel("no json here"), null);
});

test("client sends the right request (mocked)", async () => {
  let seen;
  const fetchImpl = async (url, init) => { seen = { url, init }; return { ok: true, json: async () => ({ content: [{ text: '{"intent":"billing_charge","confidence":0.8,"reason":"trial"}' }] }) }; };
  const out = await classifyWithLLM("charged after trial", { apiKey: "test", fetchImpl });
  assert.equal(out.intent, "billing_charge");
  assert.equal(seen.url, "https://api.anthropic.com/v1/messages");
  assert.equal(JSON.parse(seen.init.body).max_tokens, 200);
});

test("disagreement forces a person even when the rules would auto-answer", () => {
  const state = { now: "2026-10-14T12:00:00Z", user: { name: "A" }, deposit: { id: "d", amountCents: 10000, feeCents: 300, netAmountCents: 9700, createdAt: "2026-10-10T00:00:00Z" } };
  const rules = handleTicket("We funded $100 and the wallet shows $97, is that a fee?", state);
  assert.equal(rules.decision, "auto");
  const agreed = reconcile(rules, { intent: "wallet_fee", confidence: 0.9 });
  assert.equal(agreed.decision, "auto");
  const split = reconcile(rules, { intent: "billing_charge", confidence: 0.7 });
  assert.equal(split.decision, "human");
  assert.match(split.guardrail.at(-1), /model said billing_charge/);
});
