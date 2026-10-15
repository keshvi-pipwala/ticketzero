---
name: guarantee-save
title: Save a brand at risk of a 30-day guarantee refund
description: Use when a brand in its first 30 days on V3 is behind on conversions, asks about the money-back guarantee, or appears on the guarantee-watch query. Do not use to approve or deny a refund.
---
# Save a brand at risk of a 30-day guarantee refund

V3 promises a full refund if a brand doesn't get the conversions it wants in its first 30 days. Every brand that reaches day 30 behind pace is a likely refund. The cheapest refund is the one the brand never needs to claim.

## 1. Find out why conversions lag
1. `get_analytics_kpis` and `get_analytics_videos` for the brand: spend, views, conversions, top posts.
2. Not enough content live: compare `list_posts` against the campaign plan in `list_campaigns`. Fewer than planned means a sourcing or delivery problem, not a creative one.
3. Views but no conversions: check `get_ad_link_settings`. A broken or missing tracking link makes real sales invisible.
4. Winners not amplified: `list_promoted_ads`. A breakout organic video with no paid spend behind it is the fastest lever V3 has.
5. Weak creative: run the built-in `grill-my-brief` skill on the brief.

## 2. Hand Customer Success a save plan
Send three actions, each tied to one finding above, with the day of the 30-day window and the spend so far. Example: "Day 18 of 30, $3,200 spent. Tracking link missing on 2 of 3 campaigns. Fix the links, boost the top video, and add 10 creators to the fitness campaign."

## 3. Guardrails
- Never promise or deny a refund. Refunds are a founder and Customer Success decision.
- `refund_invoice` and every money-moving tool are human-only.
- Run this before a brand asks, from the guarantee-watch query (`sql/support_queries.sql`, query 7), not after a claim arrives.
