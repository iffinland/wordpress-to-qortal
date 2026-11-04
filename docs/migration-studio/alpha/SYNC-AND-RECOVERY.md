# Sync, recovery and cleanup guide

Synchronization is manual. QMS does not run timers, background scans or
automatic publication.

## Check for WordPress updates

Open the project and choose **Sync**, then **Check for updates**.

- A full scan proves site coverage and may reconcile missing source items.
- An incremental scan uses the stored watermark and is the normal update path.
- Scoped scans (search, date, category/tag, content-type subset, item limit)
  are for review only. They never withdraw items and never advance the
  watermark.
- A failed, interrupted or truncated scan is never reported as “no changes”.

Review the scan summary: new, modified, unchanged, conflicts and withdrawals.
Then prepare the delta plan. The delta plan is a normal `qms-plan@1` record;
**Continue to Hub publication** opens Publishing with it preselected.

## Conflicts

A conflict means the source identity no longer maps cleanly to the stored QDN
identity, for example because a slug/route changed or an existing mapping is
already reserved.

- Review the conflict description and both identities.
- Choose the resolution QMS offers: skip, alternate route, or abort.
- Resolving a conflict never overwrites a published resource silently.

## Withdrawals and tombstones

A withdrawal is **local**. When a source item disappears from a full-coverage
scan, QMS can mark the local mapping withdrawn and prepare a tombstone.

- Published QDN data is **not** deleted. QDN has no on-chain delete.
- A scoped or incomplete scan cannot trigger a withdrawal.
- Review the withdrawal list before applying the policy.

## Resume an interrupted task

If the application closes, the machine loses power or a task is cancelled,
reopen the project and choose **Recovery**.

- QMS lists interrupted runs with their kind and resumability.
- **Resume** continues from the last checkpoint. Do not start a duplicate run
  first.
- If a run is not resumable, QMS explains why and leaves the prior state
  available.
- A killed process never leaves a half-written project that looks complete.

## Clean up local files

**Recovery & cleanup** shows a preview before anything moves.

- Only verified or explicitly eligible files can be cleaned.
- Unverified, partial or failed publications are refused.
- Media shared with unverified content is protected.
- Quarantine can be restored until purge.
- Purge is explicit, forceable only by an operator, and recorded in history.

## History and diagnostics

**History & diagnostics** shows the durable timeline: scans, plans, downloads,
handoffs, receipts, verifications, conflicts, withdrawals, cleanups and
recoveries.

Export a history snapshot for an audit. Export a support bundle for a bug
report. The bundle is metadata-only and redacted: it does not include
credentials, cookies, wallet material or content bodies.
