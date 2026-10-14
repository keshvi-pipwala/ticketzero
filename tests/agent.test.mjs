import { test } from "node:test";
import assert from "node:assert/strict";
import { classify, handleTicket, AUTO_THRESHOLD } from "../src/agent.js";
import { explainError, findErrorCodes } from "../src/errors.js";
import { TICKETS } from "../evals/tickets.js";
import { prepareState, runEvals } from "../evals/run.mjs";

const MONEY_MOVING = ["eligible_withdrawal", "payout_reversed", "guarantee_claim", "charged_after_deletion", "charged_after_cancel", "rejected_outside_window", "risk_hold", "denied_risk", "no_self_serve_deletion"];

test("no ticket that moves money, refunds, lifts a hold or deletes data is ever auto-resolved", async () => {
  for (const t of TICKETS) {
    const out = handleTicket(t.text, await prepareState(t));
    if (MONEY_MOVING.includes(out.rootCause)) assert.equal(out.decision, "human", `${t.id} ${out.rootCause}`);
  }
});

test("vocabulary-only matches suggest a queue but never auto-resolve", () => {
  const out = handleTicket("question about my payout and the bank transfer", { now: "2026-10-14T00:00:00Z" });
  assert.equal(out.tier, "vocabulary");
  assert.ok(out.confidence < AUTO_THRESHOLD);
  assert.equal(out.intent, "withdrawal_delayed");
  assert.equal(out.decision, "human");
});

test("unrelated questions are not forced into an intent", () => {
  const out = handleTicket("Do you have an affiliate program for agencies?", { now: "2026-10-14T00:00:00Z" });
  assert.equal(out.intent, "other");
  assert.equal(out.decision, "human");
});

test("every reply, summary and note is free of template bugs", async () => {
  for (const t of TICKETS) {
    const out = handleTicket(t.text, await prepareState(t));
    for (const field of ["reply", "summary", "internalNote"]) {
      const v = out[field];
      if (v == null) continue;
      assert.doesNotMatch(v, /undefined|NaN|Invalid Date|\[object Object\]|\$-/, `${t.id}.${field}: ${v}`);
    }
    assert.match(out.reply, /^Hi /, `${t.id} reply should greet the customer`);
    assert.ok(out.reply.length < 1400, `${t.id} reply too long (${out.reply.length})`);
  }
});

test("human-routed tickets always carry a queue", async () => {
  for (const t of TICKETS) {
    const out = handleTicket(t.text, await prepareState(t));
    if (out.decision === "human") assert.ok(out.queue, `${t.id} has no queue`);
    else assert.equal(out.queue, null);
  }
});

test("eval suite: zero unsafe auto-resolutions on every split", async () => {
  const { summary } = await runEvals();
  for (const s of summary) assert.equal(s.unsafeAutoResolutions, 0, s.split);
});

test("error reference resolves by HTTP status", () => {
  assert.equal(explainError("TRANSFER_FAILED", 202)[0].fix.includes("Never retry with a new key"), true);
  assert.equal(explainError("transfer_failed").length, 4);
  assert.equal(explainError("NOT_A_CODE"), null);
  assert.deepEqual(findErrorCodes("got DUPLICATE_TRANSFER 409 again"), [{ code: "DUPLICATE_TRANSFER", status: 409 }]);
});

test("creator pasting an app error is not treated as an API integrator", () => {
  const c = classify("it says TRANSFER_FAILED when I try to withdraw to my bank");
  assert.equal(c.intent, "withdrawal_blocked");
});

test("review window: day 3 is auto, day 6 escalates", () => {
  const base = { now: "2026-10-14T12:00:00Z", user: { name: "A" } };
  const early = handleTicket("I submitted my video and still haven't been paid", { ...base, submission: { id: "s", status: "pending_review", submittedAt: "2026-10-11T12:00:00Z" } });
  const late = handleTicket("I submitted my video and still haven't been paid", { ...base, submission: { id: "s", status: "pending_review", submittedAt: "2026-10-08T12:00:00Z" } });
  assert.equal(early.rootCause, "within_review_window");
  assert.equal(early.decision, "auto");
  assert.equal(late.rootCause, "review_window_lapsed");
  assert.equal(late.decision, "human");
});

test("48-hour post-publication rejection boundary", () => {
  const base = { now: "2026-10-14T12:00:00Z", user: { name: "A" } };
  const t = "brand rejected my video after I posted it";
  const inside = handleTicket(t, { ...base, submission: { id: "s", status: "rejected", postedAt: "2026-10-10T00:00:00Z", rejectedAt: "2026-10-12T00:00:00Z" } });
  const outside = handleTicket(t, { ...base, submission: { id: "s", status: "rejected", postedAt: "2026-10-10T00:00:00Z", rejectedAt: "2026-10-12T00:00:01Z" } });
  assert.equal(inside.rootCause, "rejected_within_48h");
  assert.equal(outside.rootCause, "rejected_outside_window");
});
