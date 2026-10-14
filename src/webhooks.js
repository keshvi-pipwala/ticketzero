// Webhook debugging for SideShift Connect integrators.
// Signing scheme per docs.sideshift.app/connect/webhooks:
//   X-Sideshift-Signature = hex(HMAC-SHA256(secret, `${timestamp}.${rawBody}`))
//   X-Sideshift-Timestamp = Unix seconds
// Retries: 3 attempts, 1s then 2s apart. 5xx, 429, timeouts and connection errors retry;
// other 4xx do not. There is no long-running queue: missed events are recovered by replay.

const enc = new TextEncoder();
const n = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;

async function hmacHex(key, message) {
  const k = await globalThis.crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await globalThis.crypto.subtle.sign("HMAC", k, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEqualHex(a, b) {
  const x = String(a || "").trim().toLowerCase();
  const y = String(b || "").trim().toLowerCase();
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

export async function signPayload(secret, timestamp, rawBody) {
  return hmacHex(secret, `${timestamp}.${rawBody}`);
}

/**
 * Verify a delivery, and when it fails, find out WHY by re-signing the common mistakes.
 * Returns { valid, reasons[], matchedVariant }.
 */
export async function verifyWebhook({ secret, timestamp, rawBody, signature, nowSec, toleranceSec = 300 }) {
  const reasons = [];
  if (!secret) reasons.push("No signing secret supplied.");
  else if (!/^whsec_[0-9a-f]{64}$/i.test(secret.trim())) reasons.push("Secret does not look like a SideShift secret (whsec_ followed by 64 hex characters). Check you copied the secret for the right mode (live vs sandbox).");
  if (!signature) reasons.push("No X-Sideshift-Signature header value supplied.");
  const ts = String(timestamp ?? "").trim();
  if (!/^\d+$/.test(ts)) reasons.push("X-Sideshift-Timestamp should be Unix seconds (digits only).");
  if (/^\d{13}$/.test(ts)) reasons.push("Timestamp has 13 digits: that is milliseconds. SideShift signs Unix seconds.");
  if (reasons.some((r) => r.startsWith("No "))) return { valid: false, reasons, matchedVariant: null };

  const expected = await signPayload(secret.trim(), ts, rawBody);
  if (safeEqualHex(expected, signature)) {
    if (nowSec != null && /^\d{10}$/.test(ts) && Math.abs(nowSec - Number(ts)) > toleranceSec) {
      return { valid: false, reasons: [`Signature matches, but the timestamp is ${Math.round(Math.abs(nowSec - Number(ts)) / 60)} minutes from now. Replays are re-signed with a fresh timestamp, so an old one usually means a stored or re-sent copy.`], matchedVariant: "exact" };
    }
    return { valid: true, reasons: [], matchedVariant: "exact" };
  }

  // Signature mismatch: test the mistakes that cause it in practice.
  const variants = [];
  try {
    const reserialized = JSON.stringify(JSON.parse(rawBody));
    if (reserialized !== rawBody) variants.push(["reserialized", `${ts}.${reserialized}`, secret.trim(), "Your code verifies a re-serialized body. Parsing JSON and stringifying it again changes whitespace or key order. Verify against the raw request bytes before any JSON parsing (for example express.raw() on the webhook route)."]);
    const pretty = JSON.stringify(JSON.parse(rawBody), null, 2);
    if (pretty !== rawBody) variants.push(["pretty", `${ts}.${pretty}`, secret.trim(), "Your code pretty-prints the body before verifying. Use the raw bytes."]);
  } catch { /* body is not JSON; skip */ }
  variants.push(["body-only", rawBody, secret.trim(), "Your code signs the body alone. SideShift signs `${timestamp}.${rawBody}`; prepend the X-Sideshift-Timestamp value and a dot."]);
  if (secret.trim().startsWith("whsec_")) variants.push(["secret-without-prefix", `${ts}.${rawBody}`, secret.trim().slice(6), "Your code uses the secret without its whsec_ prefix. SideShift signs with the full secret string, prefix included, exactly as shown in the console."]);
  if (/^\d{10}$/.test(ts)) variants.push(["ms-timestamp", `${ts}000.${rawBody}`, secret.trim(), "Your code builds the signed string with a millisecond timestamp. SideShift signs Unix seconds."]);
  const trimmed = rawBody.replace(/\s+$/, "");
  if (trimmed !== rawBody) variants.push(["trailing-newline", `${ts}.${trimmed}`, secret.trim(), "A trailing newline was added or stripped by middleware. Verify the exact bytes received."]);

  for (const [name, msg, key, why] of variants) {
    const sig = await hmacHex(key, msg);
    if (safeEqualHex(sig, signature)) return { valid: false, reasons: [...reasons, why], matchedVariant: name };
  }
  reasons.push("No common mistake reproduces this signature. Most likely the secret is wrong: a sandbox secret used for live events (or the reverse), or a rotated secret. Re-copy it from the console for the mode the event came from.");
  return { valid: false, reasons, matchedVariant: null };
}

/**
 * Triage the output of GET /api/embed/webhook-logs.
 * Accepts the raw response ({ data: [...] }) or an array of log entries.
 */
export function triageWebhookLogs(input) {
  const logs = Array.isArray(input) ? input : Array.isArray(input?.data) ? input.data : Array.isArray(input?.logs) ? input.logs : [];
  const byEvent = new Map();
  for (const l of logs) {
    if (!l || !l.eventId) continue;
    if (!byEvent.has(l.eventId)) byEvent.set(l.eventId, []);
    byEvent.get(l.eventId).push(l);
  }
  const lost = [];
  const recovered = [];
  const duplicates = [];
  const statusCounts = {};
  for (const [eventId, entries] of byEvent) {
    entries.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    const successes = entries.filter((e) => e.success);
    for (const e of entries) if (!e.success) statusCounts[e.statusCode ?? "no response"] = (statusCounts[e.statusCode ?? "no response"] || 0) + 1;
    if (!successes.length) lost.push({ eventId, eventType: entries[0].eventType, attempts: entries.length, lastStatus: entries.at(-1).statusCode ?? null, lastError: entries.at(-1).error ?? null });
    else if (entries.some((e) => !e.success)) recovered.push(eventId);
    if (successes.length > 1) duplicates.push({ eventId, deliveries: successes.length });
  }
  const findings = [];
  const codes = Object.keys(statusCounts);
  const fiveXX = codes.filter((c) => /^5/.test(c)).reduce((s, c) => s + statusCounts[c], 0);
  const fourXX = codes.filter((c) => /^4/.test(c) && c !== "429").reduce((s, c) => s + statusCounts[c], 0);
  const noResp = statusCounts["no response"] || 0;
  if (fiveXX) findings.push(`${n(fiveXX, "failed attempt")} returned 5xx from your endpoint. SideShift retries these, but by default only 3 attempts, 1 second then 2 seconds apart, so even a short outage on your side loses events.`);
  if (fourXX) findings.push(`${n(fourXX, "failed attempt")} returned a non-429 4xx. SideShift does not retry these. A 400 or 401 from a webhook route usually means your signature check or body parser rejected a valid event.`);
  if (statusCounts["429"]) findings.push(`${n(statusCounts["429"], "attempt")} ${statusCounts["429"] === 1 ? "was" : "were"} rate-limited by your endpoint (429). Return 2xx fast and process asynchronously.`);
  if (noResp) findings.push(`${n(noResp, "attempt")} got no response (timeout or connection error). Delivery times out after 10 seconds by default: acknowledge first, then do the work.`);
  if (duplicates.length) findings.push(`${n(duplicates.length, "event")} ${duplicates.length === 1 ? "was" : "were"} delivered successfully more than once (replays). Deduplicate on X-Sideshift-Event-Id so a replay never double-books a payout.`);
  if (!lost.length && !findings.length) findings.push("Every event in these logs was delivered. If your system still shows the wrong state, the bug is in how the event is processed, not delivered.");
  const replayCommands = lost.map((l) => `curl -X POST https://app.sideshift.app/api/embed/webhooks/${l.eventId}/replay -H "x-api-key: $SIDESHIFT_KEY"`);
  return { totalEntries: logs.length, events: byEvent.size, lost, recoveredAfterRetry: recovered.length, duplicates, statusCounts, findings, replayCommands };
}
