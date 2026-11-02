# The Corbett Report: WordPress to Qortal

This toolkit copies the public WordPress site at `https://corbettreport.com` into Qortal QDN and keeps it current.

The person using this repository does **not** need to understand Node.js or Qortal internals. Follow the instructions in order and copy the commands exactly.

## What this toolkit does

1. Reads posts, pages, categories, tags, and media from the WordPress REST API.
2. Converts the WordPress data into Qortal-friendly JSON resources.
3. Downloads same-site media and prepares a publish plan.
4. Builds one small batch folder on your computer.
5. Publishes the batch through the existing Migration Publisher Q-App.
6. Lets the existing Corbett Report CMS adopt the imported posts as drafts.

## What is already published

| Item | Qortal address | Notes |
| --- | --- | --- |
| Migration Publisher | `qortal://WEBSITE/Corbett` | Already published. Publishes import batches. |
| Website and CMS | `qortal://WEBSITE/CorbettReport` | Already published. Includes the public site and Author Backend. |
| Content and import name | `Corbett` | Posts, pages, indexes, and media are published under this name. |
| Migration manifest | `DOCUMENT/Corbett/cr-qdn-manifest` | The CMS reads this catalog. |

The CMS app is owned by `CorbettReport`. Migration content is published by `Corbett`. These are intentionally different Qortal names.

## Before the first batch

The current QDN catalog already contains an older Corbett Report archive. Run this once before preparing any new batch:

```bash
npm run batch:init -- --from-qdn
```

This records the existing QDN catalog locally. New batches then merge with it instead of replacing older posts and indexes.

## Start here

- `QUICKSTART.md` - one-page command list.
- `docs/ZORIN_LINUX_SETUP.md` - complete beginner walkthrough for Zorin OS / Ubuntu.
- `docs/CORBETT_MIGRATION_RUNBOOK.md` - what to do for every batch.
- `docs/QDN_RESOURCE_STRATEGY.md` - technical resource model and recovery notes.
- `docs/migration-studio/PHASE-1-ENGINE.md` - Qortal Migration Studio engine, storage, events, and CLI (Phase 1).
- `docs/migration-studio/PHASE-2-WORDPRESS-ADAPTER.md` - source adapters, the WordPress adapter, `qms-content@1`, discovery artifacts, and Corbett compatibility (Phase 2).
- `docs/migration-studio/PHASE-3-PLANNING-MEDIA-IDENTITY.md` - universal site identity, QDN namespaces, batch planning, disk protection, media downloads/dedupe and conflict handling (Phase 3).

## Where files go

```text
wordpress-to-qortal/                         project folder
├── .env                                     private WordPress and Qortal settings
├── wp-qortal-import/                        general local import folder
└── workspaces/corbettreport-batches/
    ├── state.json                           batch progress and cursors
    ├── baseline-qdn/                        snapshot of the existing QDN catalog
    └── batches/                             prepared batch folders
```

The terminal prints the exact batch folder to select in the Migration Publisher. It looks like this:

```text
workspaces/corbettreport-batches/batches/2026-10-26_14-30-00_batch-0001_posts-000001-000010
```

## Safety rules

- Never send or upload `.env`. It contains the WordPress password.
- Do not publish `wp-qortal-import` or a batch folder as a Qortal app.
- Keep `Skip already published` enabled in the Migration Publisher.
- Do not run `npm run batch:complete` until the batch is published, adopted in the CMS, and visible on the public site.
- Keep backups of the original WordPress data and the local batch folders until the batch is verified.

## Useful commands

```bash
npm run doctor          # Check Node.js, .env, Qortal node, and QDN catalog
npm run inspect         # Check WordPress API access
npm run batch:status    # Show migration progress
npm run batch:next      # Prepare the next batch
npm run batch:retry     # Resume a failed batch
npm run batch:complete  # Mark the current batch complete
npm run batch:cleanup   # Delete large local files from a completed batch
```

## Qortal Migration Studio engine (Phase 1)

The repository now also contains a headless, reusable migration engine in
`lib/engine/`. It manages independent projects, crash-safe state, and ordered
progress events. It is optional for the current Corbett workflow: no existing
command, profile, manifest, batch file, or QDN identifier changed.

```bash
npm run qms -- project create --name "Corbett Report" --profile corbettreport
npm run qms -- project list
npm run qms -- project validate <projectId>
npm run qms -- compat list
```

Projects live under `$XDG_DATA_HOME/qortal-migration-studio` (override with
`QMS_DATA_ROOT`). See `docs/migration-studio/PHASE-1-ENGINE.md` for the API,
storage format, locking rules, and test evidence.

## Qortal Migration Studio source adapters (Phase 2)

Phase 2 adds a versioned SourceAdapter contract, a WordPress REST adapter and a
deterministic `qms-content@1` model. Discovery writes verified batches to the
project's local artifacts directory. It does **not** download media, publish to
QDN, or change the existing Corbett pipeline.

```bash
npm run qms -- project create --name "Corbett Report" --profile corbettreport \
  --source-url https://corbettreport.com
npm run qms -- project update <projectId> --source-url https://corbettreport.com
npm run qms -- source capabilities --json
npm run qms -- source validate <projectId>
npm run qms -- source discover <projectId> --per-page 50
```

WordPress credentials are read only from environment variables
(`WORDPRESS_USERNAME`, `WORDPRESS_APP_PASSWORD`, `WORDPRESS_PASSWORD`,
`WORDPRESS_AUTH_MODE`) and are never written to project state or artifacts.

## Qortal Migration Studio planning, media and identity (Phase 3)

Phase 3 is the universal preparation layer. It gives every project an automatic
immutable `siteId` and a project-scoped QDN namespace, plans deterministic
batches (default 15), enforces disk reserves and download caps, and downloads
media into a SHA-256 content-addressed store with deduplication and reference
counts. It never publishes to QDN, signs transactions or deletes local data.

```bash
# Create a generic project with a target Qortal name and default batch size.
npm run qms -- project create --name "Synthetic Site" \
  --source-url https://example.test --qdn-name ExampleName --batch-size 15

npm run qms -- source discover <projectId> --per-page 50
npm run qms -- plan create <projectId> --batch-size 15 --json
npm run qms -- media download <projectId> --plan <planId> --json
npm run qms -- media inspect <projectId> --json
npm run qms -- identity show <projectId> --json
npm run qms -- disk check <projectId> --json
```

Target names, prefixes and batch sizes are project configuration, never
hardcoded example-site defaults. All downloaded files stay under the project
workspace; media URLs are restricted to HTTP(S) and secure defaults block local
files, private addresses and external media unless explicitly enabled. See
`docs/migration-studio/PHASE-3-PLANNING-MEDIA-IDENTITY.md` for the complete
identity, planning, media, disk and recovery contract.

Discovery artifacts live under
`<project>/artifacts/source/<adapter>/batches/<batchId>/`; only completed
batches are referenced by `latest.json`. See
`docs/migration-studio/PHASE-2-WORDPRESS-ADAPTER.md` for the contract, schema,
identity/hash rules, Corbett golden evidence, and limitations.
