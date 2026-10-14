---
name: connect-webhook-debug
title: Debug Connect webhooks and API errors for integrators
description: Use when a Connect integrator reports missing webhook events, failing X-Sideshift-Signature checks, or a Connect API error code. Do not use for creators or brands using the app.
---
# Debug Connect webhooks and API errors for integrators

## Missing events
1. Pull `GET /api/embed/webhook-logs?success=false`.
2. Group by eventId. An event with no successful attempt is lost.
3. 5xx, 429 or timeouts: SideShift tried 3 times, 1s then 2s apart. Their endpoint was down. Tell them to acknowledge with 2xx first and process asynchronously.
4. Other 4xx: SideShift does not retry. Usually their signature check or body parser rejected the event.
5. Give them `POST /api/embed/webhooks/{eventId}/replay` for each lost event. Replays keep the event ID, so they must deduplicate on X-Sideshift-Event-Id.

## Signature failures
SideShift signs hex(HMAC-SHA256(secret, `${timestamp}.${rawBody}`)), timestamp in Unix seconds, secret = full `whsec_...` string. Re-sign their payload with each common mistake to find theirs:
- re-serialized JSON body (verify raw bytes before parsing)
- body signed without the timestamp prefix
- secret used without the `whsec_` prefix
- millisecond timestamp
- sandbox secret used for live events (or the reverse)

## Error codes
Look up the code and the HTTP status in docs.sideshift.app/connect/errors, since several codes mean different things per status (TRANSFER_FAILED has four). Escalate to Engineering for AUTH_ERROR, EMBED_NOT_ENABLED, ACCOUNT_NOT_FOUND (400), PAYMENT_ACC_CREATION_FAILED and BATCH_COMPENSATION_FAILED. Never tell anyone to retry TRANSFER_FAILED (202) with a new idempotency key: money may already have moved.
