# The Corbett Report: WordPress to Qortal

> **Qortal Migration Studio 0.6.0 — first public alpha.** The desktop
> application in `desktop/` and the engine in `lib/engine/` are the current
> product. Start with [docs/migration-studio/alpha/README.md](docs/migration-studio/alpha/README.md)
> for release notes, the first-run guide, the migration walkthrough, sync and
> recovery, known issues and feedback instructions. Install from
> `qortal-migration-studio_0.6.0_amd64.deb`; do not build from source unless
> you are developing QMS.
>
> The sections below describe the legacy Corbett Report command-line workflow.
> They remain supported for compatibility and are not the beginner path for the
> desktop alpha.

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
- `docs/migration-studio/PHASE-4-DESKTOP-GUI.md` - Linux desktop app, setup wizard, secure IPC, reserved-vs-published lifecycle correction, Debian packaging and verification (Phase 4).
- `docs/migration-studio/PHASE-5-QDN-PUBLISHING.md` - portable QDN handoff, universal Migration Publisher Q-App, controlled batches, exact read-back verification, receipts and desktop synchronization (Phase 5).
- `docs/migration-studio/PHASE-5-VARIANT-B-FEASIBILITY.md` - secure desktop-to-Hub transfer assessment (deferred).
- `docs/migration-studio/PHASE-6-GENERIC-CMS.md` - generic Qortal CMS template, manifest compatibility, sanitization, owner gating, accessibility and Q-App build (Phase 6).
- `docs/migration-studio/PHASE-7-INCREMENTAL-SYNC.md` - incremental scans, delta plans, conflicts, withdrawal policy and adoption (Phase 7).
- `docs/migration-studio/PHASE-8-RECOVERY-CLEANUP-HISTORY.md` - crash-safe recovery, two-phase cleanup, durable history and support bundles (Phase 8).
- `docs/migration-studio/PHASE-9-PRODUCTION-RELEASE.md` - self-contained `.deb`, reproducibility, SBOM/provenance, security review and install evidence (Phase 9).
- `docs/migration-studio/INSTALL-LINUX.md` - install, upgrade and uninstall for end users.
- `docs/migration-studio/USER-CONTENT-SUPPORT.md` - what content migrates, what unsupported plugin functionality is removed and how to review it.

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


## Qortal Migration Studio desktop app (Phase 9 release)

The desktop application lives in `desktop/`. It is an independent package
(`qortal-migration-studio`) and does not rename or replace the legacy toolkit.
It connects to the real engine over a local stdio JSON-RPC host, so domain logic
stays in the engine and the React renderer has no Node or filesystem access.

~~~bash
# From a clean checkout, with Node.js 20+ on the build machine only:
node scripts/release/build-deb.mjs
node scripts/release/validate-artifact.mjs

# Install on a Debian-based machine (end users need no Node, npm or Git):
sudo apt install ./desktop/release/qortal-migration-studio_0.6.0_amd64.deb
~~~

The version 0.6.0 artifact is an **unsigned alpha** release. It bundles Electron,
the engine, the locked engine runtime dependencies and the generic CMS template.
Project data lives in `$XDG_DATA_HOME/qortal-migration-studio` (default
`~/.local/share/qortal-migration-studio`), outside the installation directory,
and survives ordinary upgrades and uninstall. See
`docs/migration-studio/INSTALL-LINUX.md` for the end-user procedure and
`docs/migration-studio/PHASE-9-PRODUCTION-RELEASE.md` for signing status,
SBOM/provenance and install evidence.

Screens:

1. **Project dashboard** — create/open, source and destination, last activity,
   active/interrupted operations, reserved work, safe archive, history.
2. **Setup wizard** — source adapter capabilities, WordPress connection and
   validation, Qortal name/title/description with read-only generated identity,
   import/disk/media preferences, plan review from `qms-plan@1`.
3. **Preparation/progress** — structured engine events, persisted progress,
   cancellation, checkpoint/resume (pause is not advertised).
4. **History/diagnostics** — mapping publication states, plans, runs, media,
   disk, conflict resolution and metadata-only diagnostic export.

### Reserved is not published

Phase 4 corrects a Phase 3 lifecycle issue: a reserved QDN mapping is no longer
classified as `unchanged` on repeated planning. Repeated plans count reserved
items separately, keep their identifiers stable and keep them recoverable with
`--include-reserved` (or the wizard's recovery toggle). Work becomes
`remote_verified`/`published` only after future Phase 5 read-back; identical
hashes or local files never imply publication.

### Security boundary

- Electron: `contextIsolation: true`, `nodeIntegration: false`, sandboxed
  renderer, no webviews, controlled navigation and a fixed preload API.
- Every IPC request is validated against a strict allowlist in the main process;
  unknown channels and malformed payloads are rejected.
- WordPress credentials are memory-only unless the user opts into libsecret
  storage and a keyring is available; there is no plaintext fallback.
- Wallet seeds, private keys and wallet passwords are never requested.
- Diagnostics exclude credentials, auth headers, cookies, wallet material and
  content bodies.

See `docs/migration-studio/PHASE-4-DESKTOP-GUI.md` for the architecture,
package layout, verification evidence, limitations and MX Linux validation plan.

## Generic Qortal CMS template (Phase 6)

The neutral CMS template lives in `templates/generic-cms/`. It is a separate
Vite/React package that reads `qms-cms-manifest@1`, the Phase 5
`qms-qdn-manifest@1` output or the legacy `cr-qdn-manifest` catalog. It is not
the Corbett clone and imports no engine, Corbett or Node code into the browser.

~~~bash
cd templates/generic-cms
npm install
npm test                 # 19 repository/render/accessibility tests
npm run build            # typecheck, build and validate the Q-App bundle
npm run build -- --zip    # also write release/qms-generic-cms-template-v0.1.5.zip
~~~

Routes: home, posts, post, page, category, tag, archive, search and
admin/import. The admin route stages imported items in a local adoption queue
only; it does not sign or publish. Owner mode requires the signed-in account to
own the configured QDN name, with an optional on-chain name-record cross-check.
See `docs/migration-studio/PHASE-6-GENERIC-CMS.md` for the manifest contract,
state model, sanitization policy, acceptance evidence and limitations.

From the repository root, `npm run test:phase6` runs the 46 Phase 6 contract
tests and `npm run check:phase6` runs the Phase 6 tests plus the template test
and build.

## Incremental synchronization (Phase 7)

The desktop app now has a manual **Sync** view. Open a project, choose
**Check for updates**, review the explicit delta counts and conflicts, prepare a
delta publication plan, then continue through the existing Phase 5 Hub handoff.
There is no scheduled background sync and no signing in the app.

The engine performs a normal source discovery batch and classifies it against
the persistent identity mappings and the last successful scan watermark. It
never treats a failed or truncated scan as “no changes”. Incremental scans use
a 48-hour overlap window and a modified-date watermark; a complete full
reconciliation is available and is the only mode that infers source deletions.

- New/modified content is planned with stable QDN identities and only changed
  resources are packaged.
- Deletions or unpublished source content become local withdrawals. A withdrawal
  hides the mapping from the visible catalog, preserves its triple and evidence,
  and never claims that published QDN data was deleted. Missing-item withdrawal
  requires a complete, exhaustive full-site scan; filtered, subset, item-limited
  or truncated scans never withdraw and never advance the watermark.
- External QDN changes, withdrawal conflicts and source changes are persisted
  with source/local/QDN evidence and require an audited resolution. An external
  resource is not overwritten until the operator selects **Authorize source
  overwrite** (take_source).
- Optional tombstones are local preparation only (published: false,
  networkDeleted: false).
- Existing Phase 3–6 projects can be adopted without changing verified QDN
  identities; adoption reports remain after restart.
- Scans write crash-safe checkpoints. Interrupted classification can be resumed;
  a scan left running by a crash is reopened as interrupted, never successful.
- Import is content-only. Unsupported forms, carts, logins, plugin scripts and
  embedded apps are removed before hashing; editorial text, links, images and
  supported media survive. See
  `docs/migration-studio/USER-CONTENT-SUPPORT.md`.

    npm run test:phase7   # Phase 7 synchronization tests
    npm run check:phase7  # phase 7 tests, desktop typecheck and desktop tests

See docs/migration-studio/PHASE-7-INCREMENTAL-SYNC.md for the state model,
API surface, acceptance evidence and remaining alpha blockers.

## Recovery, cleanup, history and diagnostics (Phase 8)

The desktop app has a **Recovery** view (also reachable from each project card).
It exposes every Phase 8 operation, so no engine feature is unreachable:

- **Interrupted operations** — the list shows the operation, phase, durable
  checkpoint and whether it is resumable. **Resume** re-runs the step
  idempotently; **Dismiss** abandons it. A killed process never leaves a silent
  "running" run.
- **Ambiguous publications** — if a submission result is unknown, the resource
  is ambiguous, never retried automatically. Enter a read-only Qortal node URL
  and **Reconcile read-back**; the engine only performs an exact hash read-back.
- **Two-phase cleanup** — **Preview cleanup** lists eligible, protected and
  unsafe files with reasons and recoverable bytes. **Quarantine eligible files**
  moves them to a restorable quarantine with a sealed receipt and history
  snapshot written first. **Restore** works for the retention window (default
  14 days). **Purge** is a separate, irreversible action that reports measured
  reclaimed bytes and the filesystem delta.
- **Migration history** — publication evidence, tx signatures, SHA-256 hashes,
  status transitions, recovery and cleanup records, filterable by type and
  exportable as a sealed snapshot. The hash-chained audit ledger survives media
  cleanup.
- **Support bundle** — metadata-only JSON with credentials, cookies, wallet
  material, addresses and content bodies redacted; the bundle is refused if a
  secret pattern or canary remains.

Engine modules: `lib/engine/recovery.js`, `lib/engine/cleanup.js`,
`lib/engine/history.js`, `lib/engine/diagnostics.js`. State store version 5 adds
`qms-recovery-state@1` with a forward migration from version 4.

    npm run test:phase8   # Phase 8 recovery, cleanup, history and diagnostics tests
    npm run check:phase8  # phase 8 tests, desktop typecheck and desktop tests

See docs/migration-studio/PHASE-8-RECOVERY-CLEANUP-HISTORY.md for contracts,
crash-test evidence, safety rules and known limitations.

