// TicketZero agent core: classify a ticket, diagnose it from account state,
// decide auto-resolve vs human, and draft the reply.
// Hard rule (mirrors SideShift's MCP "sensitive tool" policy): the agent never
// moves money, issues refunds, lifts holds or deletes data. Those always go to a human.

import { INTENTS, INTENT_IDS, VOCAB } from "./intents.js";
import { explainError, findErrorCodes } from "./errors.js";
import { triageWebhookLogs } from "./webhooks.js";

export const AUTO_THRESHOLD = 0.6; // minimum classifier confidence to let the agent answer alone
const DAY = 86400000;

// ---------- classification ----------
export function classify(text) {
  const raw = String(text || "");
  const lower = raw.toLowerCase();
  const scores = {};
  for (const id of INTENT_IDS) {
    let s = 0;
    const hits = [];
    for (const [re, w] of INTENTS[id].patterns) {
      const target = /A-Z/.test(re.source) ? raw : lower;
      if (re.test(target)) { s += w; hits.push(re.source.slice(0, 40)); }
    }
    scores[id] = { score: s, hits };
  }
  // A documented error code is strong evidence of an integrator ticket, but creators
  // also paste error text from the app, so API intents need a developer signal too.
  const codes = findErrorCodes(raw);
  if (codes.length) scores.api_error.score += 4;
  const devSignal = /\b(api|endpoint|integration|sandbox|sk_(live|test)_\w*|sspk_\w*|x-api-key|batch|connect|webhooks?|idempotency|api keys?|rotated keys|our (app|platform|backend|ledger|code|system|server))\b|\b(post|get|patch) \/|(^|\s)\/[a-z][a-z/_{}-]*/i.test(raw);
  if (!devSignal) scores.api_error.score = Math.floor(scores.api_error.score / 3);
  // Webhook tickets often quote error codes too; prefer the webhook intent when both fire.
  if (scores.connect_webhooks.score >= 5 && scores.api_error.score > 0) scores.api_error.score -= 3;
  // "Unpaid" language about a rejected video is a rejection ticket.
  if (scores.content_rejected.score >= 5) scores.unpaid_work.score = Math.max(0, scores.unpaid_work.score - 3);
  // A charge after closing an account is a billing error first, a deletion request second.
  if (scores.billing_charge.score >= 8 && scores.account_deletion.score > 0) scores.account_deletion.score = Math.max(0, scores.account_deletion.score - 5);
  // Removed from a campaign beats generic payment words.
  if (scores.campaign_removed.score >= 5) scores.unpaid_work.score = Math.max(0, scores.unpaid_work.score - 2);

  const ranked = INTENT_IDS.map((id) => ({ id, score: scores[id].score })).sort((a, b) => b.score - a.score);
  const [top, second] = ranked;
  if (!top || top.score < 3) {
    // Tier 2: vocabulary overlap. Suggests a queue for the human; never auto-resolves.
    const words = new Set(lower.match(/[a-z]+/g) || []);
    const v = INTENT_IDS.map((id) => ({ id, score: VOCAB[id].filter((w) => words.has(w)).length })).sort((a, b) => b.score - a.score);
    if (v[0].score >= 2 && v[0].score > v[1].score) return { intent: v[0].id, confidence: 0.4, tier: "vocabulary", ranked: v.slice(0, 3), codes };
    return { intent: "other", confidence: 0, ranked, codes };
  }
  // Smoothed margin: a lone weak match can't claim certainty, and a close runner-up drags it down.
  const confidence = +(top.score / (top.score + (second?.score || 0) + 2)).toFixed(2);
  return { intent: top.id, confidence, ranked: ranked.slice(0, 3), codes };
}

// ---------- helpers ----------
const usd = (c) => `$${(Number(c || 0) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const fmtDate = (iso) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const daysBetween = (a, b) => (new Date(b) - new Date(a)) / DAY;
const addDays = (iso, d) => new Date(new Date(iso).getTime() + d * DAY).toISOString();
const firstName = (s) => (s?.user?.name || "there").split(" ")[0];

function result(o) {
  return {
    decision: "human",
    queue: null,
    priority: "normal",
    checks: [],
    sources: [],
    productFix: null,
    ...o,
  };
}

// ---------- diagnosis, one function per intent ----------
const DIAGNOSE = {
  withdrawal_delayed(s) {
    const w = s.withdrawal;
    const checks = [{ tool: "list_wallet_ledger", result: w ? `withdrawal ${w.id}: ${w.status}, ${usd(w.amountCents)}` : "no withdrawal in the last 30 days" }];
    const src = ["Connect webhooks: withdrawal statuses requested → awaiting_payment → in_transit → completed / failed / canceled / denied"];
    if (!w) {
      return result({ rootCause: "no_withdrawal_found", decision: "auto", checks, sources: src,
        summary: `No withdrawal request exists. Available balance is ${usd(s.wallet?.availableCents)}.`,
        reply: `Hi ${firstName(s)}, I checked your wallet and there's no withdrawal request on it yet, so nothing has been sent to your bank. Your available balance is ${usd(s.wallet?.availableCents)}. To send it, open Wallet, tap Withdraw and confirm your payout method. You'll get a status update as soon as it's on its way.` });
    }
    const eta = w.estimatedAvailability;
    if (["requested", "awaiting_payment", "in_transit"].includes(w.status)) {
      checks.push({ tool: "GET /transfers/{id}", result: `estimatedAvailability ${eta ? fmtDate(eta) : "not set"}${w.traceCode ? `, traceCode ${w.traceCode}` : ""}` });
      if (eta && daysBetween(eta, s.now) <= 1) {
        return result({ rootCause: "in_flight_within_eta", decision: "auto", checks, sources: src,
          summary: `Withdrawal is ${w.status} and still inside its estimated arrival date (${fmtDate(eta)}).`,
          reply: `Hi ${firstName(s)}, your withdrawal of ${usd(w.amountCents)} is on its way. It's currently "${w.status.replace("_", " ")}" and the expected arrival date is ${fmtDate(eta)}.${w.traceCode ? ` If your bank asks, the trace code is ${w.traceCode}.` : ""} Banks can post it any time up to that date. If it hasn't arrived by the end of ${fmtDate(eta)}, reply here and I'll chase it with our payments team right away.`,
          productFix: "Show status, expected arrival date and trace code on the withdrawal row in the app, so creators don't have to ask." });
      }
      return result({ rootCause: "past_eta", queue: "payments", priority: "high", checks, sources: src,
        summary: `Withdrawal ${w.id} is ${w.status} and ${Math.floor(daysBetween(eta || w.createdAt, s.now))} day(s) past its expected arrival date. Needs a payments investigation with the provider.`,
        internalNote: `Withdrawal ${w.id} (${usd(w.amountCents)}) stuck in ${w.status} past ETA ${eta ? fmtDate(eta) : "n/a"}. traceCode ${w.traceCode || "none"}. Check provider status and withdrawal.updated webhooks.`,
        reply: `Hi ${firstName(s)}, thanks for flagging this. Your withdrawal of ${usd(w.amountCents)} should have arrived by ${eta ? fmtDate(eta) : "now"}, and it hasn't, so I've escalated it to our payments team with the transfer details. I'll update you here within one business day.` });
    }
    if (w.status === "completed") {
      checks.push({ tool: "GET /transfers/{id}", result: `completed ${fmtDate(w.completedAt)}, traceCode ${w.traceCode || "n/a"}` });
      return result({ rootCause: "completed_sent", decision: "auto", checks, sources: src,
        summary: `Withdrawal completed on ${fmtDate(w.completedAt)}. The money has left SideShift.`,
        reply: `Hi ${firstName(s)}, good news: your withdrawal of ${usd(w.amountCents)} completed on ${fmtDate(w.completedAt)}, so it has left SideShift and is with your bank.${w.traceCode ? ` Give your bank this trace code and they can find it: ${w.traceCode}.` : ""} If they can't locate it with that code, reply here and we'll open a trace from our side.` });
    }
    if (w.status === "failed") {
      const badDest = /bank|account|routing|iban|destination|closed|invalid|name mismatch/i.test(`${w.errorCode} ${w.errorMessage}`);
      checks.push({ tool: "withdrawal.failed event", result: `${w.errorCode || "no code"}: ${w.errorMessage || "no message"}` });
      if (badDest) {
        return result({ rootCause: "failed_bad_destination", decision: "auto", checks, sources: src,
          summary: "Withdrawal failed because the bank rejected the payout details. Funds return to the wallet.",
          reply: `Hi ${firstName(s)}, your withdrawal of ${usd(w.amountCents)} didn't go through because your bank rejected the payout details ("${w.errorMessage}"). The money is safe: it goes back to your SideShift wallet. Please update your payout method in Wallet (double-check the account number and that the name matches your ID), then withdraw again.`,
          productFix: "Validate bank details at entry and show the failure reason in-app with a one-tap fix." });
      }
      return result({ rootCause: "failed_other", queue: "payments", priority: "high", checks, sources: src,
        summary: `Withdrawal failed with ${w.errorCode || "an unclassified error"}. Needs payments review.`,
        internalNote: `Withdrawal ${w.id} failed: ${w.errorCode} ${w.errorMessage}.`,
        reply: `Hi ${firstName(s)}, your withdrawal didn't complete, and I've passed it to our payments team to find out why. Your funds are still accounted for. I'll come back to you here within one business day.` });
    }
    if (w.status === "canceled") {
      return result({ rootCause: "canceled_returned", decision: "auto", checks, sources: src,
        summary: "Withdrawal was canceled before it was sent. Funds are back in the wallet.",
        reply: `Hi ${firstName(s)}, that withdrawal was canceled before it left SideShift, so the ${usd(w.amountCents)} is back in your wallet. You can withdraw it again from Wallet whenever you're ready.` });
    }
    // denied
    return result({ rootCause: "denied_risk", queue: "trust_safety", priority: "high", checks, sources: [...src, "Terms C9.1: payouts may be held for listed risk reasons"],
      summary: "Withdrawal was denied, which points to a risk or compliance review. Never auto-answer.",
      internalNote: `Withdrawal ${w.id} denied. Review risk flags before replying. Do not disclose risk signals to the user.`,
      reply: `Hi ${firstName(s)}, thanks for your patience. Your withdrawal needs a manual review by our team before it can be sent. I've passed it on, and a specialist will reply here directly.` });
  },

  withdrawal_blocked(s) {
    const a = s.account || {};
    const checks = [
      { tool: "get_verification", result: `identity: ${a.verification || "unknown"}` },
      { tool: "get_wallet_balance", result: `available ${usd(s.wallet?.availableCents)}, pending ${usd(s.wallet?.pendingCents)}` },
    ];
    if (a.riskFlag) {
      checks.push({ tool: "account.risk_flagged", result: `${a.riskFlag.riskType} (${a.riskFlag.severity})` });
      return result({ rootCause: "risk_hold", queue: "trust_safety", priority: "high", checks, sources: ["Terms C9.1–C9.2: payout holds up to 180 days for listed risk situations"],
        summary: `Account has a ${a.riskFlag.severity} risk flag (${a.riskFlag.riskType}). Withdrawals stay held until Trust & Safety reviews it.`,
        internalNote: `Risk flag ${a.riskFlag.riskType}/${a.riskFlag.severity}${a.riskFlag.duplicateOfAccountIds?.length ? `, possible duplicate of ${a.riskFlag.duplicateOfAccountIds.join(", ")}` : ""}. Do not share risk reasons with the user.`,
        reply: `Hi ${firstName(s)}, I can see your balance is on a temporary hold while our team completes a standard account review. I've moved your ticket to the specialists who handle these reviews, and they'll reply here directly. Your earnings stay recorded on your account during the review.` });
    }
    if (a.verification && a.verification !== "verified") {
      if (a.verification === "failed") {
        return result({ rootCause: "verification_failed", queue: "trust_safety", priority: "normal", checks, sources: ["Terms C1.4, C10.1: identity, payout and tax checks run through the payment provider"],
          summary: "Identity verification failed, so withdrawals are blocked. A person has to review the retry path.",
          reply: `Hi ${firstName(s)}, your withdrawal is blocked because your identity check didn't pass. I've asked our team to look at it and tell you exactly what to resubmit. You'll hear back here.` });
      }
      return result({ rootCause: "identity_not_verified", decision: "auto", checks, sources: ["Connect errors: TRANSFER_FAILED (400) when withdrawing before identity verification", "Terms C10.1"],
        summary: `Identity verification is "${a.verification}". Withdrawals unlock once it's complete.`,
        reply: `Hi ${firstName(s)}, your ${usd(s.wallet?.availableCents)} is ready to go. The only thing missing is a one-time identity check, which we need before any payout. Open Wallet, tap Verify identity and follow the steps (it takes a few minutes with your ID). Once it shows Verified, the Withdraw button will work.`,
        productFix: "Prompt verification when a creator's first payout lands, not when they try to withdraw." });
    }
    if (s.otherWithdrawal && ["requested", "awaiting_payment", "in_transit"].includes(s.otherWithdrawal.status)) {
      checks.push({ tool: "GET /transfers", result: `withdrawal ${s.otherWithdrawal.id} still ${s.otherWithdrawal.status}` });
      return result({ rootCause: "previous_withdrawal_settling", decision: "auto", checks, sources: ["Connect errors: DUPLICATE_TRANSFER (409, source_serialization)"],
        summary: "A previous withdrawal is still settling. A new one from the same wallet is blocked until it finishes.",
        reply: `Hi ${firstName(s)}, you have an earlier withdrawal of ${usd(s.otherWithdrawal.amountCents)} that's still on its way, and a new withdrawal can't start until that one settles. Once it shows Completed, you'll be able to withdraw the rest.` });
    }
    if (!s.wallet?.availableCents && s.wallet?.pendingCents) {
      return result({ rootCause: "funds_pending_not_available", decision: "auto", checks, sources: ["Terms B9.1 / C5.2: brand review period"],
        summary: "All funds are pending (awaiting brand approval or bonus calculation). Nothing is withdrawable yet.",
        reply: `Hi ${firstName(s)}, your ${usd(s.wallet.pendingCents)} is showing as pending, which means it's tied to content that's still in the brand's review window or to a bonus that hasn't been calculated yet. Pending money moves to Available automatically, and that's when you can withdraw it.`,
        productFix: "Show, per pending item, why it's pending and the date it becomes available." });
    }
    return result({ rootCause: "unknown_block", queue: "engineering", priority: "high", checks,
      summary: "Verified account, no risk flag, available balance, no settling transfer, yet the withdrawal is blocked. Likely a product bug.",
      internalNote: "Reproduce the withdrawal from the creator's account and capture the request ID.",
      reply: `Hi ${firstName(s)}, everything on your account looks right, so this looks like a bug on our side. I've sent it to engineering with your account details and will update you here.` });
  },

  unpaid_work(s) {
    const sub = s.submission || { status: "none" };
    const p = s.payout || { status: "none" };
    const checks = [
      { tool: "list_video_submissions", result: `submission ${sub.id || "-"}: ${sub.status}${sub.submittedAt ? `, submitted ${fmtDate(sub.submittedAt)}` : ""}` },
      { tool: "list_payouts", result: `payout: ${p.status}${p.scheduledFor ? ` for ${fmtDate(p.scheduledFor)}` : ""}` },
    ];
    const src = ["Terms B9.1 / C5.2: 5 calendar days to review; silence after that counts as acceptance", "Terms C8.2–C8.3: nonpayment claims within 30 days; review up to 10 business days"];
    if (sub.status === "none") {
      return result({ rootCause: "no_submission", decision: "auto", checks, sources: src,
        summary: "No submission on record for this campaign, so no payout was triggered.",
        reply: `Hi ${firstName(s)}, I can't find a submitted video for this campaign on your account, and payouts start from the submission. Open the campaign, tap Submit content and add your video link. The brand then has 5 days to review it.` });
    }
    if (sub.status === "rejected") return { ...DIAGNOSE.content_rejected(s), note: "Ticket said unpaid; the submission was rejected." };
    if (sub.status === "pending_review") {
      const age = daysBetween(sub.submittedAt, s.now);
      const deadline = addDays(sub.submittedAt, 5);
      if (age < 5) {
        return result({ rootCause: "within_review_window", decision: "auto", checks, sources: src,
          summary: `Submitted ${age.toFixed(1)} days ago. The brand is still inside its 5-day review window (ends ${fmtDate(deadline)}).`,
          reply: `Hi ${firstName(s)}, your video was submitted on ${fmtDate(sub.submittedAt)} and the brand is still inside its 5-day review window, which ends ${fmtDate(deadline)}. Under our Terms, if they don't review it by then it counts as accepted, so you're covered either way. I'll keep this open and check on ${fmtDate(deadline)}.`,
          productFix: "Show the review deadline on each submission and notify the creator when auto-acceptance kicks in." });
      }
      return result({ rootCause: "review_window_lapsed", queue: "payments", priority: "high", checks, sources: src,
        summary: `Submitted ${Math.floor(age)} days ago with no brand decision. Under B9.1 it is accepted, but no payout was created. The auto-acceptance job may have missed it.`,
        internalNote: `Submission ${sub.id} past the 5-day window with no decision. Expected auto-acceptance and payout creation. Check the job and the brand wallet balance.`,
        reply: `Hi ${firstName(s)}, you're right to ask. The brand's 5-day review window for your video ended on ${fmtDate(deadline)}, so it counts as accepted, and your payout should have been created. It hasn't been, so I've escalated it to our payments team with the details. I'll update you here within one business day.` });
    }
    // approved
    if (p.status === "scheduled") {
      return result({ rootCause: "payout_scheduled", decision: "auto", checks, sources: src,
        summary: `Approved. Payout of ${usd(p.amountCents)} is scheduled for ${fmtDate(p.scheduledFor)}.`,
        reply: `Hi ${firstName(s)}, your video was approved and your payment of ${usd(p.amountCents)} is scheduled for ${fmtDate(p.scheduledFor)}. It will land in your SideShift wallet that day, and you can withdraw it straight away.` });
    }
    if (p.status === "paid") {
      return result({ rootCause: "paid_to_wallet", decision: "auto", checks, sources: src,
        summary: `Paid ${usd(p.amountCents)} to the creator's SideShift wallet on ${fmtDate(p.paidAt)}. The creator may be expecting it in their bank.`,
        reply: `Hi ${firstName(s)}, this one has been paid: ${usd(p.amountCents)} went into your SideShift wallet on ${fmtDate(p.paidAt)}. Payments land in your wallet first. To move it to your bank, open Wallet and tap Withdraw.`,
        productFix: "Send a push notification on wallet credit that says 'Paid to your wallet, tap to withdraw'." });
    }
    if (p.status === "reversed") {
      return result({ rootCause: "payout_reversed", queue: "payments", priority: "high", checks, sources: [...src, "Terms B5.5 / C9.4: offsets and reversals"],
        summary: "Payout was created and then reversed. A person must decide whether to retry it (retry_reversed_payout moves money).",
        internalNote: `Payout ${p.id} reversed. Check the reason before retrying.`,
        reply: `Hi ${firstName(s)}, your payment was sent and then reversed, and I want a payments specialist to check why before it's re-sent. I've escalated it and you'll hear back here within one business day.` });
    }
    if (s.brandWallet && s.brandWallet.availableCents < (sub.payCents || 0)) {
      return result({ rootCause: "brand_underfunded", queue: "customer_success", priority: "high", checks: [...checks, { tool: "get_wallet_balance (brand)", result: `${usd(s.brandWallet.availableCents)} available vs ${usd(sub.payCents)} owed` }], sources: src,
        summary: "Approved, but the brand wallet can't cover the payout. CS needs to get the brand to fund it.",
        internalNote: `Brand ${s.brandWallet.brandId} underfunded for approved submission ${sub.id}.`,
        reply: `Hi ${firstName(s)}, your video was approved and the payment is owed to you. It's waiting on the brand to top up their campaign budget, and our team is contacting them now. I'll update you here as soon as it's released.` });
    }
    return result({ rootCause: "payout_not_created", queue: "engineering", priority: "high", checks, sources: src,
      summary: "Approved, brand funded, yet no payout record exists. Likely a payout pipeline bug.",
      internalNote: `Submission ${sub.id} approved ${sub.approvedAt ? fmtDate(sub.approvedAt) : ""} with no payout. Check recalculate_payout output before running anything.`,
      reply: `Hi ${firstName(s)}, your video was approved, so you're owed this payment, but it hasn't been created on our side. That's our bug, and I've sent it to engineering with your submission details. I'll update you here within one business day.` });
  },

  content_rejected(s) {
    const sub = s.submission || {};
    const src = ["Terms B9.2 / C5.2: rejection must happen before publication, or within 48 hours of going live"];
    const checks = [{ tool: "get_contract_history", result: `posted ${sub.postedAt ? fmtDate(sub.postedAt) : "not posted"}, rejected ${sub.rejectedAt ? fmtDate(sub.rejectedAt) : "-"}${sub.reason ? `, reason: "${sub.reason}"` : ""}` }];
    if (!sub.postedAt) {
      return result({ rootCause: "rejected_before_posting", decision: "auto", checks, sources: src,
        summary: "Rejected before publication, which the Terms allow.",
        reply: `Hi ${firstName(s)}, the brand declined this video before it went live, which they're allowed to do during review.${sub.reason ? ` Their note was: "${sub.reason}".` : ""} If the campaign is still open, you can submit a revised version that addresses the note.` });
    }
    const hrs = daysBetween(sub.postedAt, sub.rejectedAt) * 24;
    checks.push({ tool: "rule check", result: `rejected ${hrs.toFixed(0)}h after going live (limit 48h)` });
    if (hrs <= 48) {
      return result({ rootCause: "rejected_within_48h", decision: "auto", checks, sources: src,
        summary: `Rejected ${hrs.toFixed(0)}h after going live, inside the 48-hour window.`,
        reply: `Hi ${firstName(s)}, I checked the timeline. Your video went live on ${fmtDate(sub.postedAt)} and the brand rejected it ${Math.round(hrs)} hours later, which is inside the 48-hour window our Terms give brands after a post goes live.${sub.reason ? ` Their reason was: "${sub.reason}".` : ""} If you think the rejection doesn't match the brief, reply with "dispute" and a short explanation, and a person on our team will review it.` });
    }
    return result({ rootCause: "rejected_outside_window", queue: "disputes", priority: "high", checks, sources: src,
      summary: `Rejected ${Math.round(hrs)}h after going live, outside the 48-hour window. Likely the creator is owed payment.`,
      internalNote: `Submission ${sub.id}: rejection at +${Math.round(hrs)}h, outside B9.2. Review for payout via resolve_dispute.`,
      reply: `Hi ${firstName(s)}, thanks for raising this. Your video was rejected ${Math.round(hrs / 24)} days after it went live, which is outside the 48-hour window in our Terms. I've opened a dispute review with our team so a person can make the call on your payment, and you'll hear back here.` });
  },

  campaign_removed(s) {
    const c = s.campaign || {};
    const checks = [{ tool: "get_campaign", result: `status ${c.status || "unknown"}${c.archivedBy ? `, archived by ${c.archivedBy}` : ""}` }, { tool: "get_payout_breakdown", result: `accrued ${usd(s.accruedCents)}` }];
    if (c.status === "archived" || c.status === "ended") {
      const bySS = c.archivedBy === "sideshift";
      return result({ rootCause: bySS ? "brand_suspended" : "brand_ended_campaign", decision: "auto", checks,
        sources: bySS ? ["Terms 16.4–16.5: on client suspension, campaigns may be archived; pay accrued before suspension may still be owed"] : ["Terms B6.3: when a client ends early, accrued or committed pay becomes immediately due"],
        summary: `Campaign was ${c.status}${c.archivedBy ? ` by ${c.archivedBy}` : ""}. Accrued pay: ${usd(s.accruedCents)}.`,
        reply: `Hi ${firstName(s)}, the campaign was ${bySS ? "closed by our team while we review the brand's account" : "ended by the brand"}, which is why it disappeared from your list.${s.accruedCents ? ` Work you completed before it closed still counts: ${usd(s.accruedCents)} is recorded as owed to you${bySS ? ", subject to the usual review" : ""}, and it will be paid to your wallet.` : " You had no completed work on it, so nothing is owed from this one."} There are new campaigns in Discover if you want to pick up another.`,
        productFix: "Notify every hired creator, with the reason category and what they're owed, the moment a campaign closes." });
    }
    return result({ rootCause: "campaign_visibility_issue", queue: "engineering", priority: "normal", checks,
      summary: "Campaign is still active, but the creator can't see it. Possibly a contract or app issue after the V3 update.",
      reply: `Hi ${firstName(s)}, the campaign is still active on our side, so it shouldn't have disappeared for you. Please update the app and log out and back in. I've also flagged it to engineering in case it's a display bug, and I'll follow up here.` });
  },

  wallet_fee(s) {
    const d = s.deposit;
    if (!d) return result({ rootCause: "deposit_not_found", queue: "billing", checks: [{ tool: "list_wallet_ledger", result: "no matching deposit" }], summary: "No deposit found to explain.", reply: `Hi ${firstName(s)}, I couldn't match a deposit on your account to this. Could you send the date and amount you funded? I'll look it up straight away.` });
    const pct = ((d.feeCents / d.amountCents) * 100).toFixed(1);
    return result({ rootCause: "processing_fee", decision: "auto", checks: [{ tool: "list_wallet_ledger", result: `deposit ${d.id}: charged ${usd(d.amountCents)}, fee ${usd(d.feeCents)}, credited ${usd(d.netAmountCents)}` }],
      sources: ["Connect guides: amountCents includes the payer-covered processing fee; netAmountCents reaches the wallet", "Terms B5.3, B6.1: deposit and processing fees are non-refundable"],
      summary: `Deposit fee ${usd(d.feeCents)} (${pct}%) is the payment processing fee on funding. Working as designed.`,
      reply: `Hi ${firstName(s)}, here's the breakdown of your deposit on ${fmtDate(d.createdAt)}: you were charged ${usd(d.amountCents)}, ${usd(d.feeCents)} of that was the payment processing fee for the funding method, and ${usd(d.netAmountCents)} was credited to your wallet for creator pay. Processing fees aren't refundable under our Terms. If you plan to fund regularly, our team can walk you through the lowest-fee way to do it for your plan.`,
      productFix: "Show the fee and the net credit on the funding screen before the brand confirms. This is a recurring 1-star review theme." });
  },

  wallet_withdraw(s) {
    const b = s.brand || {};
    const blockers = [];
    if (b.activeContracts) blockers.push(`${b.activeContracts} active creator contract(s)`);
    if (b.accruedCents) blockers.push(`${usd(b.accruedCents)} of accrued creator pay`);
    if (b.pendingBonuses) blockers.push(`${b.pendingBonuses} pending view bonus(es)`);
    if (b.openDisputes) blockers.push(`${b.openDisputes} open dispute(s)`);
    const checks = [{ tool: "get_wallet_summary", result: `available ${usd(b.availableCents)}; blockers: ${blockers.join(", ") || "none"}` }];
    const src = ["Terms B5.3: unused funds can be withdrawn only with no active contracts, accrued pay, pending bonuses, disputes or reversals", "Terms B5.4: committed funds are not withdrawable"];
    if (blockers.length) {
      return result({ rootCause: "blocked_by_commitments", decision: "auto", checks, sources: src,
        summary: `Withdrawal of unused funds is blocked by: ${blockers.join("; ")}.`,
        reply: `Hi ${firstName(s)}, you can take unused funds out of your wallet once nothing is still owed against them. Right now your account has ${blockers.join(", ")}. Once those are closed out (end or complete the contracts, and let bonuses and disputes settle), the remaining balance becomes withdrawable and our team can process it.` });
    }
    return result({ rootCause: "eligible_withdrawal", queue: "billing", priority: "normal", checks, sources: src,
      summary: `No blockers. ${usd(b.availableCents)} is eligible. Needs a human to run it (money-moving, may need risk review).`,
      internalNote: `Brand eligible for wallet withdrawal of ${usd(b.availableCents)}. transfer_wallet_balance is sensitive: human executes.`,
      reply: `Hi ${firstName(s)}, your account has no open commitments, so the ${usd(b.availableCents)} balance is eligible to withdraw. I've passed it to our billing team to process, and they'll confirm here once it's sent.` });
  },

  billing_charge(s) {
    const sub = s.subscription || {};
    const checks = [{ tool: "get_subscription", result: `status ${sub.status}${sub.canceledAt ? `, canceled ${fmtDate(sub.canceledAt)}` : ""}, period ends ${sub.periodEnd ? fmtDate(sub.periodEnd) : "-"}` }, { tool: "get_billing_history", result: `last charge ${sub.lastChargeAt ? fmtDate(sub.lastChargeAt) + " " + usd(sub.lastChargeCents) : "-"}` }];
    const src = ["Terms B4.3: 14-day trial converts unless canceled", "Terms B4.4: cancellation effective at period end, no proration", "Terms B8.1: report billing errors within 30 days"];
    if (sub.accountDeletedAt && sub.lastChargeAt && sub.lastChargeAt > sub.accountDeletedAt) {
      return result({ rootCause: "charged_after_deletion", queue: "billing", priority: "urgent", checks, sources: src,
        summary: `Charged ${usd(sub.lastChargeCents)} on ${fmtDate(sub.lastChargeAt)}, after the account was deleted on ${fmtDate(sub.accountDeletedAt)}. Billing error: refund review.`,
        internalNote: "Deleted account still billed: the subscription wasn't canceled on deletion. Refund and check how many other deleted accounts are still billed.",
        reply: `Hi ${firstName(s)}, you're right: you were charged ${usd(sub.lastChargeCents)} on ${fmtDate(sub.lastChargeAt)}, after your account was deleted. That shouldn't happen. I've sent it to billing as a priority refund review, with a request to stop any further charges. You'll get confirmation here.`,
        productFix: "Cancel the subscription and detach the card in the same transaction as account deletion. 'Charged after deleting' is a repeated 1-star review." });
    }
    if (sub.canceledAt && sub.lastChargeAt && sub.lastChargeAt > sub.periodEnd) {
      return result({ rootCause: "charged_after_cancel", queue: "billing", priority: "high", checks, sources: src,
        summary: "Charged after the canceled period ended. Billing error.",
        reply: `Hi ${firstName(s)}, you canceled on ${fmtDate(sub.canceledAt)} and your plan ended on ${fmtDate(sub.periodEnd)}, so the ${usd(sub.lastChargeCents)} charge on ${fmtDate(sub.lastChargeAt)} shouldn't have happened. I've sent it to billing for a refund review and you'll get confirmation here.` });
    }
    if (sub.canceledAt) {
      return result({ rootCause: "cancel_at_period_end", decision: "auto", checks, sources: src,
        summary: "Canceled mid-period. Access runs to period end; no prorated refund.",
        reply: `Hi ${firstName(s)}, your cancellation went through on ${fmtDate(sub.canceledAt)}. Plans run to the end of the paid period, so you keep full access until ${fmtDate(sub.periodEnd)}, and you won't be charged again. Under our Terms the current period isn't prorated, so the ${usd(sub.lastChargeCents)} charge on ${fmtDate(sub.lastChargeAt)} stands.` });
    }
    if (sub.trialEndedAt && sub.lastChargeAt && Math.abs(daysBetween(sub.trialEndedAt, sub.lastChargeAt)) <= 1) {
      return result({ rootCause: "trial_converted", decision: "auto", checks, sources: src,
        summary: "14-day trial converted to paid on schedule.",
        reply: `Hi ${firstName(s)}, your 14-day free trial ended on ${fmtDate(sub.trialEndedAt)} and converted to the paid plan, which is the charge you're seeing (${usd(sub.lastChargeCents)}). If you don't want to continue, you can cancel in Settings → Billing and you won't be charged again. If you'd like to talk through a refund, reply here and I'll bring in our billing team.`,
        productFix: "Email 3 days before trial conversion with the amount and a one-click cancel link." });
    }
    return result({ rootCause: "billing_unclear", queue: "billing", checks, sources: src,
      summary: "Charge doesn't match a known pattern. Billing needs to review.",
      reply: `Hi ${firstName(s)}, thanks for flagging this charge. I've asked our billing team to review it against your plan, and they'll reply here.` });
  },

  account_deletion(s) {
    const bal = s.wallet?.availableCents || 0;
    return result({ rootCause: "no_self_serve_deletion", queue: "privacy", priority: "normal", checks: [{ tool: "get_wallet_balance", result: `available ${usd(bal)}` }, { tool: "get_subscription", result: s.subscription?.status || "no subscription" }],
      sources: ["Public reviews: 3 of 14 Trustpilot reviews (sideshift.app) cite being unable to delete an account or disconnect TikTok"],
      summary: "Deletion and disconnection requests need a person (irreversible). The agent acknowledges and gathers what's needed.",
      internalNote: `Deletion request. Balance ${usd(bal)}. Cancel the subscription and detach the card before deleting.`,
      reply: `Hi ${firstName(s)}, I've logged your request to delete your account${s.wantsDisconnect ? ` and disconnect your ${s.wantsDisconnect}` : ""}. ${bal ? `Before we close it, you have ${usd(bal)} available. Please withdraw it first, or tell us if you want it handled another way. ` : ""}Our team will cancel any subscription, remove your saved card and confirm here once everything is deleted.`,
      productFix: "Add self-serve 'Delete account' and 'Disconnect social' in Settings. This is the single most repeated complaint in public reviews." });
  },

  guarantee_refund(s) {
    const g = s.guarantee || {};
    const day = g.firstSpendAt ? daysBetween(g.firstSpendAt, s.now) : null;
    return result({ rootCause: "guarantee_claim", queue: "founders_cs", priority: "high",
      checks: [{ tool: "get_analytics_kpis", result: `spend ${usd(g.spendCents)}, conversions ${g.conversions ?? "n/a"}` }, { tool: "get_billing_history", result: g.firstSpendAt ? `first spend ${fmtDate(g.firstSpendAt)} (day ${Math.floor(day)})` : "no spend" }],
      sources: ["V3 launch post (LinkedIn): refund if a brand doesn't get the conversions it wants in the first 30 days"],
      summary: `Guarantee claim at day ${day == null ? "?" : Math.floor(day)} of 30. Spend ${usd(g.spendCents)}, ${g.conversions ?? "unknown"} conversions. Refunds are a founder/CS decision; the agent pre-fills the case.`,
      internalNote: `Guarantee claim: first spend ${g.firstSpendAt ? fmtDate(g.firstSpendAt) : "?"}, spend ${usd(g.spendCents)}, conversions ${g.conversions}. ${day != null && day > 30 ? "Outside the 30-day window." : "Inside the 30-day window."}`,
      reply: `Hi ${firstName(s)}, thanks for telling us. I've pulled your campaign numbers (spend and conversions since ${g.firstSpendAt ? fmtDate(g.firstSpendAt) : "your first campaign"}) and passed your guarantee request to our team. Someone will reply here within one business day, and we'll also look at what's holding conversions back.` });
  },

  ad_launch(s) {
    const ac = s.adConnections || {};
    const platform = s.adPlatform || (ac.meta === false ? "meta" : ac.tiktok === false ? "tiktok" : "meta");
    const checks = [{ tool: "list_ad_connections", result: `meta: ${ac.meta ? "connected" : "not connected"}, tiktok: ${ac.tiktok ? "connected" : "not connected"}` }];
    if (!ac[platform]) {
      return result({ rootCause: "ad_account_not_connected", decision: "auto", checks, sources: ["SideShift V3: creator videos can run as Meta/TikTok ads without an ad code once the brand connects its ad account"],
        summary: `${platform === "meta" ? "Meta" : "TikTok"} ad account isn't connected, so the launch can't run.`,
        reply: `Hi ${firstName(s)}, you don't need an ad code from the creator anymore. SideShift can run their video as an ad directly, but first your ${platform === "meta" ? "Meta" : "TikTok"} ad account has to be connected. Go to Ads → Connections, connect ${platform === "meta" ? "Meta" : "TikTok"} with an admin login, then hit Launch on the video again.` });
    }
    const op = s.lastOperation;
    checks.push({ tool: "get_operation", result: op ? `${op.id}: ${op.status}${op.error ? ` (${op.error})` : ""}` : "none" });
    return result({ rootCause: "ad_launch_failed", queue: "engineering", priority: "high", checks,
      summary: `Ad account connected, but launch operation ${op?.id || "?"} failed${op?.error ? `: ${op.error}` : ""}.`,
      internalNote: `Launch failure on ${platform}. Operation ${op?.id}. Check platform permission scopes.`,
      reply: `Hi ${firstName(s)}, your ad account is connected correctly, so this failure is on our side or the platform's. I've sent the launch details to engineering, and I'll update you here today. The creator doesn't need to do anything.` });
  },

  connect_webhooks(s) {
    const t = s.webhookLogs ? triageWebhookLogs(s.webhookLogs) : null;
    const sig = s.signatureCheck;
    const checks = [];
    if (t) checks.push({ tool: "GET /api/embed/webhook-logs", result: `${t.events} events, ${t.lost.length} never delivered, ${t.recoveredAfterRetry} recovered by retry` });
    if (sig) checks.push({ tool: "signature check", result: sig.valid ? "valid" : `invalid: ${sig.matchedVariant || "secret mismatch"}` });
    const parts = [];
    if (sig && !sig.valid) parts.push(sig.reasons.at(-1));
    if (t) parts.push(...t.findings);
    const lost = t?.lost || [];
    return result({ rootCause: sig && !sig.valid ? `signature_${sig.matchedVariant || "secret_mismatch"}` : lost.length ? "events_not_delivered" : "processing_side", decision: "auto", checks,
      sources: ["Connect webhooks: HMAC-SHA256 over `${timestamp}.${rawBody}`; 3 attempts; replay via POST /api/embed/webhooks/{eventId}/replay", "Connect testing guide: reference verifiers pass the secret as-is, sign the received bytes, 300-second tolerance"],
      summary: parts[0] || "Webhook question with no logs attached.",
      reply: `Hi ${firstName(s)}, here's what I found:\n\n${parts.map((p) => `- ${p}`).join("\n") || "- No logs were attached. Send the output of GET /api/embed/webhook-logs?success=false and I'll pinpoint it."}${lost.length ? `\n\nTo recover the ${plural(lost.length, "missed event")} once your endpoint is fixed:\n${t.replayCommands.slice(0, 5).join("\n")}` : ""}\n\nReplays keep the same event ID, so deduplicate on X-Sideshift-Event-Id.`,
      productFix: "Add a 'failed deliveries' banner with one-click bulk replay in the Connect console." });
  },

  api_error(s, ticketText) {
    const codes = findErrorCodes(ticketText);
    const explained = codes.map((c) => ({ c, docs: explainError(c.code, c.status) })).filter((x) => x.docs);
    if (!explained.length) {
      return result({ rootCause: "unknown_error", queue: "engineering", checks: [{ tool: "error lookup", result: "no documented code found" }],
        summary: "API problem without a documented error code. Needs request IDs.",
        reply: `Hi ${firstName(s)}, to pinpoint this I need the full error body, including error.code and requestId, plus the endpoint and the time (UTC). Could you paste one failing response?` });
    }
    // One documented meaning: follow its escalate flag. Several (status unknown): escalate only if all of them need SideShift.
    const escalate = explained.some((x) => (x.docs.length === 1 ? x.docs[0].escalate : x.docs.every((d) => d.escalate)));
    const lines = explained.map(({ c, docs }) => {
      const d = docs.length === 1 ? docs[0] : null;
      if (d) return `${c.code} (${d.status}): ${d.cause} Fix: ${d.fix}`;
      return `${c.code} can mean ${docs.length} things depending on the HTTP status:\n${docs.map((x) => `  • ${x.status}: ${x.cause} Fix: ${x.fix}`).join("\n")}`;
    });
    return result({ rootCause: explained.map((x) => x.c.code).join("+"), decision: escalate ? "human" : "auto", queue: escalate ? "engineering" : null, priority: escalate ? "high" : "normal",
      checks: [{ tool: "Connect error reference", result: explained.map((x) => `${x.c.code}${x.c.status ? ` ${x.c.status}` : ""}`).join(", ") }],
      sources: ["docs.sideshift.app/connect/errors"],
      summary: lines[0].split("\n")[0],
      internalNote: escalate ? "Docs say this code needs SideShift action. Pull the requestId from logs." : undefined,
      reply: `Hi ${firstName(s)}, here's what that error means and how to fix it:\n\n${lines.map((l) => `- ${l}`).join("\n")}${escalate ? "\n\nThis one needs action on our side, so I've passed it to engineering. Please reply with the requestId from the error body." : ""}` });
  },
};

// ---------- orchestrator ----------
const MONEY_OR_IRREVERSIBLE = new Set(["eligible_withdrawal", "payout_reversed", "guarantee_claim", "charged_after_deletion", "charged_after_cancel", "rejected_outside_window", "risk_hold", "denied_risk", "no_self_serve_deletion"]);

export function handleTicket(ticket, state = {}) {
  const text = typeof ticket === "string" ? ticket : ticket.text;
  const cls = classify(text);
  const s = { now: new Date().toISOString(), ...state };
  if (cls.intent === "other") {
    return { ...cls, label: "Unclassified", rootCause: "unclassified", decision: "human", queue: "support", priority: "normal", checks: [], sources: [], summary: "No confident match. Route to a person, then add the resolved ticket to the eval set.", reply: `Hi ${firstName(s)}, thanks for reaching out. I've passed this to our support team so a person can look at it properly, and they'll reply here.` };
  }
  const d = DIAGNOSE[cls.intent](s, text);
  let decision = d.decision;
  const why = [];
  if (decision === "auto" && cls.confidence < AUTO_THRESHOLD) { decision = "human"; why.push(`classifier confidence ${cls.confidence} < ${AUTO_THRESHOLD}`); }
  if (MONEY_OR_IRREVERSIBLE.has(d.rootCause)) { decision = "human"; why.push("moves money, refunds, lifts a hold or deletes data"); }
  return { ...cls, label: INTENTS[cls.intent].label, ...d, decision, queue: decision === "human" ? d.queue || "support" : null, guardrail: why };
}
