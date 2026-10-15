---
name: ad-launch-triage
title: Triage a creator video that won't launch as an ad
description: Use when a brand can't run a creator's video as a Meta or TikTok ad, is asked for an ad or spark code, or a launch failed. Do not use for organic campaign or payout questions.
---
# Triage a creator video that won't launch as an ad

Since V3, a brand can run a creator's video as a paid ad without asking the creator for a code, once the brand's own ad account is connected.

## 1. Check the connection first
`list_ad_connections`. Most "it keeps asking for an ad code" tickets are a brand whose Meta or TikTok ad account was never connected.
- Not connected: send them to Ads → Connections, connect with an admin login, then launch again. Resolve.

## 2. Connected, but the launch failed
1. `list_promoted_ads` for the video, then `get_operation` on the failed launch. Note the error text.
2. `get_ad_post_statuses` to confirm the post is still live and public. A deleted or private post can't run.
3. Permission or identity errors (for example a missing ads_management scope, or an identity not authorized for spark ads): escalate to Engineering with the operation ID and the platform. The creator does not need to do anything.
4. Budget errors: `get_meta_campaign_budget`, and tell the brand which limit blocked it.

## 3. Guardrails
`launch_ad`, `launch_meta_partnership_ad`, `launch_tiktok_ad`, `pause_promoted_ad` and `update_promoted_ad_budget` are sensitive and spend the brand's money: a person runs them, never the agent.
