---
name: unpaid-creator-work
title: Resolve "I did the work but wasn't paid"
description: Use when a creator says submitted, approved or posted content has not been paid, or a brand never reviewed their video. Do not use when the money already reached the wallet and they cannot withdraw (use diagnose-payout).
---
# Resolve "I did the work but wasn't paid"

## 1. Check the submission
`list_video_submissions` for the creator and campaign. Note status, submittedAt, approvedAt, postedAt.

## 2. Apply the Terms
- **Pending review, under 5 calendar days:** the brand is inside its review window (Terms B9.1 / C5.2). Give the creator the exact date the window ends and tell them silence counts as acceptance. Resolve.
- **Pending review, 5+ days:** the submission is accepted by the Terms, so a payout should exist. If `list_payouts` shows none, escalate to Payments: the auto-acceptance job may have missed it. High priority.
- **Approved, payout scheduled:** give the scheduled date. Resolve.
- **Approved, payout paid:** the money is in the SideShift wallet, not the bank. Explain Wallet → Withdraw. Resolve.
- **Approved, payout reversed:** escalate to Payments. Do not retry the payout yourself.
- **Approved, no payout, brand wallet short:** escalate to Customer Success to get the brand to fund the campaign. Tell the creator the payment is owed and waiting on the brand.
- **Approved, no payout, brand funded:** product bug. Escalate to Engineering with the submission ID.
- **Rejected:** switch to creator-dispute-triage.

## 3. Note the claim window
Nonpayment claims must be filed within 30 days of the latest qualifying event (Terms C8.2). If the ticket is close to that, file the claim for the creator in the escalation.
