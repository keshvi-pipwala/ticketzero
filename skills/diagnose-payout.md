---
name: diagnose-payout
title: Diagnose a creator payout or withdrawal
description: Use when a creator says a withdrawal or payout is late, missing, failed, canceled, denied, on hold, "in reserve", or the Withdraw button is blocked. Do not use for brand billing, wallet funding fees or content rejections.
---
# Diagnose a creator payout or withdrawal

Goal: tell the creator exactly where their money is and what happens next, in one reply. Never move money.

## 1. Find the money
1. `get_wallet_balance` for the creator: note available vs pending.
2. `list_wallet_ledger` (last 30 days): find the most recent withdrawal and its status.
3. `get_verification`: identity status.

## 2. Decide by status
| What you see | Root cause | Action |
|---|---|---|
| No withdrawal, balance available | Never requested | Explain how to withdraw from Wallet. Resolve. |
| requested / awaiting_payment / in_transit, before estimatedAvailability (+1 day) | In flight | Give the arrival date and traceCode. Resolve. |
| Same statuses, past estimatedAvailability | Stuck | Escalate to Payments with withdrawal ID, traceCode, ETA. Promise an update within one business day. |
| completed | Left SideShift | Give completion date and traceCode for the bank. Resolve. |
| failed + bank/account/name error | Bad payout details | Funds return to wallet. Ask to fix payout method and retry. Resolve. |
| failed, any other error | Unknown failure | Escalate to Payments. |
| canceled | Returned to wallet | Explain the funds are back in the wallet. Resolve. |
| denied, or account.risk_flagged | Risk review | Escalate to Trust & Safety. Neutral holding reply. Never mention risk signals. |
| Verification not verified | Missing KYC | Send to Wallet → Verify identity. Resolve. If verification failed, escalate. |
| Another withdrawal still settling (DUPLICATE_TRANSFER source_serialization) | One at a time | Explain the earlier withdrawal must complete first. Resolve. |
| Available = 0, pending > 0 | Still in review window | Explain pending vs available. Resolve. |

## 3. Reply rules
- First line answers "where is my money".
- Always include a date: arrival date, completion date, or when they will hear back.
- Never promise a payout date you did not read from the ledger.
- Sensitive tools (`execute_payouts`, `quick_pay`, `retry_reversed_payout`, `transfer_wallet_balance`) are for humans only.

Sources: Connect withdrawal statuses and errors (docs.sideshift.app/connect), Terms C9.1–C9.2 (payout holds).
