# Corbett Report: Initial 10-Post Baseline

For the full 5000+ post migration, use the automated 15-post workflow in
`docs/CORBETT_BATCH_WORKFLOW.md`. The instructions below are retained only for
reconstructing or auditing the initial migration baseline.

After this 10-post batch is published and adopted, initialize the automated
workflow from it:

```bash
npm run corbettreport:batch:init -- --from=wp-qortal-import-smoke-10
```

This short workflow downloads the latest 10 WordPress posts with their selected
post media, prepares a QDN publish plan, publishes the batch through the
Migration Publisher, and adopts the posts through the Corbett Report CMS.

Run all terminal commands from the repository root.

## 1. Verify WordPress credentials

Keep the working Corbett Report credentials in the local `.env` file. Do not
commit that file.

Confirm access:

```bash
npm run inspect
```

Continue only when the posts, pages, categories, tags, and media checks succeed.

## 2. Choose a new batch directory

Use a unique directory for every test so an older import is not overwritten.
Replace the example date when needed:

```bash
export OUTPUT_DIR=./wp-qortal-import-smoke-10-2026-06-05
export LIMIT_POSTS=10
export MEDIA_SCOPE=selected_posts
export DOWNLOAD_MEDIA=true
export DOWNLOAD_MEDIA_TYPES=image,audio,video,document,file
export MIGRATION_PROFILE=corbettreport
```

These exports apply only to the current terminal session. WordPress credentials
are still read from `.env`.

## 3. Download and convert the batch

```bash
npm run prepare-import
```

This runs the WordPress dump, conversion, media planning, media download, and
basic validation steps.

Run strict media validation:

```bash
npm run validate:media
```

## 4. Prepare the QDN publish plan

For a batch published by `Corbett`, keep the default publisher:

```bash
export QORTAL_NAME=Corbett
npm run prepare-publish
```

To test a trusted coauthor publishing the raw migration batch, set the name that
belongs to the logged-in coauthor before preparing the plan:

```bash
export QORTAL_NAME=AgoristMarket
npm run prepare-publish
```

The selected Qortal account must own the configured `QORTAL_NAME`.

The final output should report 10 post resources and print these paths:

```text
<OUTPUT_DIR>/converted/qdn-manifest.json
<OUTPUT_DIR>/publish-log/publish-plan.json
```

All planned resource names must match the `QORTAL_NAME` selected for this batch.

## 5. Publish through the Migration Publisher

Open the latest Migration Publisher Q-App inside Qortal UI while logged in with
the Qortal name that owns the batch target.

Use this package when it needs to be republished:

```text
release/wordpress-to-qortal-migration-app-corbettreport-v0.1.5.zip
```

Inside the Migration Publisher:

1. Set `Default Qortal name` to the same value used in `QORTAL_NAME`.
2. Select the new `OUTPUT_DIR` folder from the computer.
3. Keep `Skip already published` enabled for normal publishing.
4. Publish `Full media`, or publish JSON and media types in smaller batches.
5. Approve the Qortal transaction request.

## 6. Load and adopt the batch in the CMS

Open the Corbett Report Q-App and enter `Author Backend`.

1. Open `Imported`.
2. Enter the batch publisher name in `Import source Qortal name`, for example
   `Corbett` or `AgoristMarket`.
3. Keep the manifest identifier as `cr-qdn-manifest`.
4. Select `Load imported content`.
5. Select the required posts and choose `Adopt selected`.
6. Open an adopted post, set its status to `Published`, and choose `Publish`.

Trusted coauthors use the same process. If another coauthor published the raw
migration batch, enter that coauthor's Qortal name as the import source. Their
CMS publish writes directly to their operator catalog; there is no submission
or owner approval queue.

## 7. Verify the public website

Select `Visit site` or reopen the Q-App. The public Corbett Report layout loads:

- canonical migration content from `Corbett/cr-qdn-manifest`;
- CMS content from `Corbett/cms-manifest`;
- trusted coauthor operator manifests configured in the CMS manifest.

Raw migration data published by another user becomes public after that batch is
adopted and published into the user's operator catalog through the CMS.

Only posts with CMS status `Published` appear publicly. Ordering uses the
original post publication timestamp.

## Historical note

Do not use repeated `LIMIT_POSTS=10` commands for the production migration. The
production batch workflow now maintains separate cursors for unseen new posts
and consecutive historical batches.
