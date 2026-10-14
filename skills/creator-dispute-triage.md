---
name: creator-dispute-triage
title: Triage a rejected video or removed campaign
description: Use when a creator's video was rejected or declined, or a campaign they were hired on disappeared or ended. Do not use for payout delays or brand billing.
---
# Triage a rejected video or removed campaign

## Rejected video
1. `get_contract_history`: postedAt, rejectedAt, rejection reason.
2. Rejected **before posting:** allowed. Share the brand's note and invite a revised submission if the campaign is open. Resolve.
3. Rejected **within 48 hours of going live:** allowed by Terms B9.2. Share the reason. Offer a human review if the creator believes it matches the brief. Resolve.
4. Rejected **more than 48 hours after going live:** outside the window. Open a dispute review (`list_disputes`, then a human runs `resolve_dispute`). High priority. The creator is likely owed payment.

## Campaign removed
1. `get_campaign`: status and who archived it. `get_payout_breakdown`: accrued pay.
2. Ended or archived **by the brand:** accrued or committed pay is due (Terms B6.3). Tell the creator the amount owed.
3. Archived **by SideShift** (brand under review): pay accrued before the suspension may still be owed, subject to review (Terms 16.4–16.5).
4. Still **active** but invisible to the creator: likely a display bug after the V3 update. Escalate to Engineering.

Always state the amount owed, or say clearly that nothing is owed and why.
