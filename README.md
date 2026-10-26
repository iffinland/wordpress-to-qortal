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
