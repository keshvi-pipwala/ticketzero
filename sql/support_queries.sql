-- Proactive support queries: find the tickets before customers file them.
-- Written against an ASSUMED schema (SideShift's real tables are not public). Table and column
-- names mirror the public API objects: withdrawals/transfers, submissions, payouts, subscriptions.
-- Postgres syntax.

-- 1. Withdrawals past their estimated arrival date. Message these creators first, with the trace code.
SELECT w.id, w.account_id, w.amount_cents, w.status, w.estimated_availability, w.trace_code,
       now()::date - w.estimated_availability::date AS days_late
FROM withdrawals w
WHERE w.status IN ('requested', 'awaiting_payment', 'in_transit')
  AND w.estimated_availability < now() - interval '1 day'
ORDER BY days_late DESC, w.amount_cents DESC;

-- 2. Submissions past the 5-day review window with no decision and no payout (Terms B9.1 / C5.2).
--    Each row is a creator who is owed money under the Terms and has not been paid.
SELECT s.id, s.creator_id, s.campaign_id, s.submitted_at, s.pay_cents
FROM submissions s
LEFT JOIN payouts p ON p.submission_id = s.id
WHERE s.status = 'pending_review'
  AND s.submitted_at < now() - interval '5 days'
  AND p.id IS NULL
ORDER BY s.submitted_at;

-- 3. Approved work with no payout, split by whether the brand wallet can cover it.
SELECT s.id, s.creator_id, c.brand_id, s.pay_cents, bw.available_cents,
       CASE WHEN bw.available_cents < s.pay_cents THEN 'brand_underfunded' ELSE 'payout_not_created' END AS root_cause
FROM submissions s
JOIN campaigns c ON c.id = s.campaign_id
JOIN brand_wallets bw ON bw.brand_id = c.brand_id
LEFT JOIN payouts p ON p.submission_id = s.id
WHERE s.status = 'approved' AND p.id IS NULL
  AND s.approved_at < now() - interval '2 days';

-- 4. Deleted accounts that are still being billed. One row here is one future chargeback.
SELECT a.id, a.deleted_at, sub.status, sub.last_charge_at, sub.last_charge_cents
FROM accounts a
JOIN subscriptions sub ON sub.account_id = a.id
WHERE a.deleted_at IS NOT NULL
  AND sub.status <> 'canceled'
  AND sub.last_charge_at > a.deleted_at;

-- 5. Rejections after the 48-hour post-publication window (Terms B9.2). Likely disputes.
SELECT s.id, s.creator_id, s.posted_at, s.rejected_at,
       round(extract(epoch FROM s.rejected_at - s.posted_at) / 3600) AS hours_after_live
FROM submissions s
WHERE s.status = 'rejected'
  AND s.posted_at IS NOT NULL
  AND s.rejected_at > s.posted_at + interval '48 hours';

-- 6. Weekly ticket mix by root cause, to pick what engineering should delete next.
SELECT date_trunc('week', t.created_at) AS week, t.intent, t.root_cause,
       count(*) AS tickets,
       round(avg(CASE WHEN t.decision = 'auto' THEN 1 ELSE 0 END) * 100) AS pct_auto_resolved
FROM support_tickets t
WHERE t.created_at > now() - interval '8 weeks'
GROUP BY 1, 2, 3
ORDER BY week DESC, tickets DESC;
