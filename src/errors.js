// SideShift Connect error codes, transcribed from docs.sideshift.app/connect/errors.
// `escalate` marks codes where the docs tell the integrator to contact support,
// or where money may be in an uncertain state, so a human must own the reply.

export const CONNECT_ERRORS = [
  { code: "API_KEY_MISSING", status: 401, cause: "No API key header was sent.", fix: "Send the key in the x-api-key header from your backend.", escalate: false },
  { code: "INVALID_API_KEY", status: 401, cause: "The key does not match an active key (revoked, mistyped, or wrong prefix).", fix: "Check the key value and that it has not been revoked. Connect keys start with sk_live_ or sk_test_.", escalate: false },
  { code: "AUTH_ERROR", status: 401, cause: "Internal authentication failure on PATCH /accounts/{id}.", fix: "Retry once. If it repeats, support needs the request ID and timestamp.", escalate: true },
  { code: "EMBED_NOT_ENABLED", status: 403, cause: "Connect is disabled for the company, or the integration has no widget-permission config.", fix: "SideShift has to enable Connect or the widget permission on the account.", escalate: true },
  { code: "DOMAIN_NOT_ALLOWED", status: 403, cause: "A browser request came from an origin that is not on the allowlist, or sent no origin.", fix: "Call the API from your backend, or add the domain to the embed allowlist.", escalate: false },
  { code: "DOMAIN_NOT_ALLOWED", status: 400, cause: "POST /auth/token could not bind a domain: the allowlist is empty and no origin was sent, or targetDomain is not listed.", fix: "Add a domain to the allowlist, or pass a targetDomain that is on it.", escalate: false },
  { code: "WIDGET_NOT_PERMITTED", status: 403, cause: "The widget is disabled for the integration, transfers are off because the payout widget is off, or the account was not created by this integration.", fix: "Use accounts your integration created, or ask SideShift to change the permission.", escalate: false },
  { code: "INSUFFICIENT_PERMISSIONS", status: 403, cause: "Updating an account you do not own, or detaching one you only link to.", fix: "Only accounts created by your integration can be updated or detached.", escalate: false },
  { code: "RATE_LIMITED", status: 429, cause: "Per-minute request, per-hour token or per-day transfer count limit exceeded.", fix: "Back off with jitter and honour the Retry-After header.", escalate: false },
  { code: "TOKEN_EXPIRED", status: 401, cause: "The widget session token has expired.", fix: "Mint a new widget token.", escalate: false },
  { code: "TOKEN_INVALID", status: 401, cause: "The widget session token does not verify.", fix: "Mint a new token. Check for truncated or double-encoded URLs.", escalate: false },
  { code: "WHOP_API_ERROR", status: 500, cause: "Upstream payment-provider failure on the widget session endpoint.", fix: "Reload and retry later.", escalate: false },
  { code: "VALIDATION_ERROR", status: 400, cause: "A field has the wrong shape or value (widget type, expiry range, filter, batch settings).", fix: "Correct the request body.", escalate: false },
  { code: "VALIDATION_ERROR", status: 403, cause: "POST /webhooks/test was called with a live key.", fix: "Use a sandbox key (sk_test_) for test events.", escalate: false },
  { code: "VALIDATION_ERROR", status: 404, cause: "Replay requested for an event with no prior delivery in this mode, or a logId that is not yours.", fix: "Look up valid IDs with GET /webhook-logs.", escalate: false },
  { code: "MISSING_REQUIRED_FIELD", status: 400, cause: "A required field is missing or invalid (email, account ID, amount, idempotency key under 8 characters, transfer ID).", fix: "Send the missing field. Idempotency keys need at least 8 characters.", escalate: false },
  { code: "INVALID_METADATA", status: 400, cause: "Metadata is not a flat object of strings, or exceeds the key or length limits.", fix: "Flatten and trim the metadata.", escalate: false },
  { code: "INVALID_EMAIL", status: 400, cause: "The email on account creation is not valid.", fix: "Fix the address.", escalate: false },
  { code: "AMOUNT_TOO_SMALL", status: 400, cause: "Amount is below 1 cent.", fix: "Send at least 1 cent.", escalate: false },
  { code: "AMOUNT_TOO_LARGE", status: 400, cause: "Amount exceeds the effective maximum, or is not a whole number of cents.", fix: "Split the payment, or send integer cents.", escalate: false },
  { code: "ESCROW_DESTINATION_INVALID", status: 400, cause: "The escrow company ID on POST /auth/token does not match a company.", fix: "Check escrowDestinationCompanyId.", escalate: false },
  { code: "ACCOUNT_NOT_FOUND", status: 404, cause: "The account does not exist or is not created by or linked to this integration (deliberate 404).", fix: "Verify the sideshiftAccountId, and that your integration created or linked it.", escalate: false },
  { code: "ACCOUNT_NOT_FOUND", status: 400, cause: "The account exists but has no payment account, and one could not be created.", fix: "SideShift has to provision the payment account.", escalate: true },
  { code: "EMAIL_ALREADY_EXISTS", status: 409, cause: "Every fallback email slot for this address is taken.", fix: "Send a stable externalId and store sideshiftAccountId; see the fallback emails guide.", escalate: false },
  { code: "EMAIL_IN_USE", status: 409, cause: "PATCH /accounts/{id} targets an email another account uses.", fix: "Use a different address.", escalate: false },
  { code: "PAYMENT_ACC_CREATION_FAILED", status: 500, cause: "The payment provider could not create an account after three fallback attempts.", fix: "Retry later with the same externalId; escalate if it persists.", escalate: true },
  { code: "VERIFICATION_NOT_FOUND", status: 404, cause: "Verification or account not found, or a sandbox key was used (sandbox creates no verification records).", fix: "Use a live key for verification reads.", escalate: false },
  { code: "VERIFICATION_SERVICE_ERROR", status: 502, cause: "The identity provider is temporarily down.", fix: "Retry later.", escalate: false },
  { code: "INSUFFICIENT_BALANCE", status: 400, cause: "The source cannot cover the amount (or the atomic batch total).", fix: "Fund the source first. Retrying unchanged will not help.", escalate: false },
  { code: "DAILY_LIMIT_EXCEEDED", status: 400, cause: "The daily transfer amount limit for the UTC day is reached.", fix: "Wait for the next UTC day, or request a higher limit.", escalate: false },
  { code: "DUPLICATE_TRANSFER", status: 409, cause: "Idempotency conflict, or another withdrawal from the same source is still settling (source_serialization).", fix: "Check details.blockingTransferId. For source_serialization, queue sends per source and retry; otherwise use a new key.", escalate: false },
  { code: "TRANSFER_RECONCILIATION_REQUIRED", status: 409, cause: "A prior attempt with this key is awaiting recovery.", fix: "Retry later with the same key.", escalate: false },
  { code: "TRANSFER_FAILED", status: 202, cause: "The provider accepted the payout but local records are not final. Money may already have arrived.", fix: "Treat as in progress. Poll GET /transfers/{transferId}. Never retry with a new key.", escalate: false },
  { code: "TRANSFER_FAILED", status: 409, cause: "Replay of a key whose original attempt failed on a path that no longer exists.", fix: "Retry with a new key.", escalate: false },
  { code: "TRANSFER_FAILED", status: 400, cause: "withdrawal-balance was called for an account that has not finished identity verification.", fix: "Have the user complete verification in the payout widget first.", escalate: false },
  { code: "TRANSFER_FAILED", status: 500, cause: "Unclassified failure. The source reservation was rolled back.", fix: "Retry with the same key after a delay.", escalate: false },
  { code: "TRANSFER_NOT_CANCELLABLE", status: 409, cause: "The transfer is completed, failed, cancelled, past the provider, or still settling.", fix: "Nothing to do. Only unsubmitted reservations can be cancelled.", escalate: false },
  { code: "BATCH_ABORTED", status: 409, cause: "An atomic batch stopped after money moved, and all settled items were reversed.", fix: "Nothing moved on net. Retry with new per-item keys and a new batch key.", escalate: false },
  { code: "BATCH_ABORTED", status: 500, cause: "Unexpected error during batch preflight. Nothing moved.", fix: "Retry with new keys.", escalate: false },
  { code: "BATCH_COMPENSATION_FAILED", status: 409, cause: "An atomic batch failed after some items settled, and not every item could be reversed.", fix: "Stop. Reconcile with GET /transfers. Engineering must review the batch.", escalate: true },
  { code: "WEBHOOK_NOT_CONFIGURED", status: 400, cause: "Replay requested, but no webhook URL is set for this mode, or it is disabled.", fix: "Configure the endpoint in the console.", escalate: false },
  { code: "WEBHOOK_DELIVERY_FAILED", status: 502, cause: "Your endpoint rejected a replay or test delivery.", fix: "Fix the endpoint, then replay again.", escalate: false },
  { code: "INTERNAL_ERROR", status: 500, cause: "Unexpected server error, including fund-reservation failures and checkout amounts outside 100 to 20,000,000 cents.", fix: "Retry with the same idempotency key after a delay. Validate checkout amounts client-side.", escalate: false },
];

/** Find the documented meaning of an error code, optionally narrowed by HTTP status. */
export function explainError(code, status) {
  const c = String(code || "").trim().toUpperCase();
  const matches = CONNECT_ERRORS.filter((e) => e.code === c);
  if (!matches.length) return null;
  if (status != null) {
    const exact = matches.find((e) => e.status === Number(status));
    if (exact) return [exact];
  }
  return matches;
}

/** Pull every documented error code (and a nearby HTTP status, if any) out of free text. */
export function findErrorCodes(text) {
  const t = String(text || "");
  const known = [...new Set(CONNECT_ERRORS.map((e) => e.code))];
  const found = [];
  for (const code of known) {
    const re = new RegExp(`\\b${code}\\b`, "i");
    const m = t.match(re);
    if (!m) continue;
    const window = t.slice(Math.max(0, m.index - 40), m.index + code.length + 40);
    const s = window.match(/\b(200|202|400|401|402|403|404|409|429|500|502)\b/);
    found.push({ code, status: s ? Number(s[1]) : null });
  }
  return found;
}
