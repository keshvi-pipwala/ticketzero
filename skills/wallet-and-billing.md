---
name: wallet-and-billing
title: Explain brand wallet fees, unused funds and subscription charges
description: Use when a brand asks about the fee on a wallet deposit, wants unused wallet funds back, or questions a subscription, trial or post-cancellation charge. Do not use for creator payouts.
---
# Explain brand wallet fees, unused funds and subscription charges

## Deposit fee
`list_wallet_ledger`: find the deposit. Show three numbers: charged (amountCents), processing fee (feeCents), credited (netAmountCents). Deposit and processing fees are non-refundable (Terms B5.3, B6.1). Resolve.

## Unused funds
`get_wallet_summary`. Funds are withdrawable only with no active contracts, accrued creator pay, pending bonuses, disputes or reversals (Terms B5.3). Committed funds are never withdrawable (B5.4).
- Any blocker: list each one and what closes it. Resolve.
- No blockers: escalate to Billing to run the withdrawal. `transfer_wallet_balance` is human-only.

## Subscription charges
`get_subscription` and `get_billing_history`.
- Charged **after account deletion:** billing error. Escalate to Billing as urgent, and flag it as a possible pattern across deleted accounts.
- Charged **after a canceled period ended:** billing error. Escalate to Billing.
- Canceled mid-period: access runs to period end, no proration (B4.4). Resolve.
- Trial converted: 14-day trial converts unless canceled (B4.3). Explain and show how to cancel. Resolve, and offer a Billing review if they ask for a refund.
- Billing errors must be reported within 30 days (B8.1). Ask brands to contact us before a chargeback (B8.2).

## 30-day conversion guarantee (V3 launch)
Always escalate to the founders / CS. Pre-fill first spend date, spend and conversions from `get_analytics_kpis`.
