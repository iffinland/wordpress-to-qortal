# Corbett Report Production Migration Workflow

Use this workflow for the full Corbett Report migration. It processes WordPress
content through two synchronized queues in every batch:

- every new post published after the last completed batch;
- the next 15 older posts from the historical archive.

The workflow creates a timestamped directory automatically and stores separate
date cursors for the live and historical queues.

Run commands from the repository root.

## 1. Check the current state

```bash
npm run corbettreport:batch:status
```

State and batch directories are stored under:

```text
workspaces/corbettreport-batches/
```

This directory is excluded from git.

### Initialize from the existing 10-post test

Run this once before creating the first automated batch if the existing
`wp-qortal-import-smoke-10` posts have already been published and adopted:

```bash
npm run corbettreport:batch:init -- --from=wp-qortal-import-smoke-10
```

The command records the existing post IDs, newest timestamp, and oldest
timestamp. The first production batch then loads posts newer than the baseline
and the next 15 posts older than the baseline.

Skip this initialization only when starting the migration from the newest post
with an empty CMS catalog.

## 2. Prepare the next production batch

```bash
npm run corbettreport:batch:next
```

The command automatically:

1. Creates a timestamped batch directory.
2. Loads all unseen recent posts after the live cursor.
3. Loads the next 15 older posts before the historical cursor.
4. Merges both queues by WordPress post ID and removes duplicates.
5. Downloads images, audio, video, documents, and files linked to those posts.
6. Converts and validates the batch.
7. Creates the QDN publish plan.
8. Prints the directory to select in the Migration Publisher.

Example directory:

```text
workspaces/corbettreport-batches/batches/
2026-06-05_14-30-00_batch-0001_posts-000001-000015/
```

The command refuses to prepare another batch while the current batch is still
marked `prepared`. This prevents `cr-qdn-manifest` from being overwritten before
the current batch is adopted into the CMS.

If a media connection is terminated, the batch is retained and can be resumed:

```bash
npm run corbettreport:batch:retry
```

The retry command automatically finds the failed batch, skips files already
downloaded, retries only missing same-site media, validates the result, and
finishes the QDN publish plan. Individual downloads use three attempts by
default.

The recent queue is fetched in ascending order. If its configured safety limit
is ever reached, the next run continues from the newest recent post actually
completed, so newer unseen posts are not skipped.

The historical cursor uses the oldest publication timestamp from the completed
historical subset. New Web2 posts never shift or skip the historical sequence.

## 3. Publish and adopt the prepared batch

In the Migration Publisher:

1. Select the printed batch directory.
2. Confirm the correct `Default Qortal name`.
3. Keep `Skip already published` enabled.
4. Publish the JSON resources and full media.

In the Corbett Report CMS:

1. Open `Author Backend` and then `Imported`.
2. Enter the Qortal name that published the batch.
3. Load `cr-qdn-manifest`.
4. Adopt the posts.
5. Publish the required posts.
6. Verify them on the public Corbett Report layout.

## 4. Mark the batch completed

Only after QDN publishing, CMS adoption, and public-site verification:

```bash
npm run corbettreport:batch:complete
```

This advances both saved cursors only after QDN publishing, CMS adoption, and
public verification. The next `batch:next` command again checks live posts and
continues the historical archive.

When the historical archive is complete, the same command remains useful: it
continues to prepare recent-only batches whenever new posts appear.

## 5. Delete completed local batch data

After the completed batch is verified, its large local files can be removed:

```bash
npm run corbettreport:batch:cleanup
```

The cleanup command:

- only removes a batch marked `completed`;
- keeps small manifest and validation receipts;
- deletes the large raw, converted, and media files from the batch directory;
- does not delete any QDN resource or Qortal Core data.

After cleanup, the local media files cannot be republished from that directory.
Keep an external backup if future republishing may be required.

## Optional settings

Change the automatic batch size for one terminal command:

```bash
CORBETT_BATCH_SIZE=20 npm run corbettreport:batch:next
```

Change the maximum number of recent posts processed in one batch:

```bash
CORBETT_RECENT_LIMIT=200 npm run corbettreport:batch:next
```

The recent limit is a safety and workload limit, not a skip limit. Additional
recent posts continue in the following completed batch.

Change the local batch root:

```bash
CORBETT_BATCH_ROOT=/path/to/storage npm run corbettreport:batch:next
```

For production migration, keep the default historical batch size of 15 unless
QDN upload or CMS adoption shows that a different workload is more practical.

## Operating rule

Do not run `batch:complete` until the prepared resources are published, adopted,
published from the CMS, and visible on the public site. Cursors advance only on
completion, which makes an interrupted batch safe to retry.
