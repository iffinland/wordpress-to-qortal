# Phase 0 Architecture Audit — Qortal Migration Studio

| Field | Value |
| --- | --- |
| Document | Phase 0 architecture audit |
| Product working name | Qortal Migration Studio |
| Executing agent | DeepSeek (`opencode-development` profile) |
| Audit date | 2026-11-02 |
| Repository | `/home/iffi/dev-workspace/projects/wordpress-to-qortal` |
| Base SHA | `f6eec4b655c3fb79c193cc6bd10562742dfe7bf1` |
| Workflow v3 branch | `agent/qortal-wordpress-to-qortal/20261102T163322Z-qortal-migration-studio-phase-0-dc71102e` |
| Status | **Audit complete — target product is not production ready** |

This document audits the current WordPress-to-Qortal toolkit and the Qortal
integration it relies on. It is an architecture input, not a release claim. The
companion documents are:

- [`PRODUCT-REQUIREMENTS.md`](PRODUCT-REQUIREMENTS.md)
- [`ARCHITECTURE.md`](ARCHITECTURE.md)
- [`IMPLEMENTATION-ROADMAP.md`](IMPLEMENTATION-ROADMAP.md)

## 1. Scope and method

### 1.1 In scope

- Repository review of the import/conversion engine, profiles, batch state,
  media handling, QDN preparation, Migration Publisher Q-App, Corbett Report CMS,
  tests, packaging scripts and documentation.
- Review of the Qortal QDN/bridge integration mechanisms used by this repository
  and the control-plane's pinned Qortal reference material.
- Gap analysis against the 20 product capabilities and the architecture
  decisions named in the job.
- Feasibility assessment for desktop-integrated QDN publishing and signing.
- A proposed target architecture, state model, adapter contract and phased
  roadmap.

### 1.2 Out of scope / not performed

- No application source, test or dependency changes.
- No package installation, builds used as release artifacts, content imports,
  QDN publication, wallet signing, transaction, CMS deployment or profile
  changes.
- No live Qortal host validation. The local runtime in this environment is a
  Qortium preview node; it was **not** treated as Qortal authority and no
  Qortium-specific behavior was transferred to Qortal.
- No claim that the current Corbett Report or AstuAeda migrations are complete,
  correct or reproducible from this checkout.

### 1.3 Evidence labels used in this audit

| Label | Meaning |
| --- | --- |
| **VERIFIED (repo)** | Observed directly in the current checkout at base SHA `f6eec4b`. |
| **VERIFIED (pinned Qortal reference)** | Traced to control-plane Qortal material pinned to Qortal Core 6.1.9 (`108bf191`) and Qortal Hub 3.0.3 (`12a573b`), as recorded in the platform pack. Not re-run against a live Qortal host during this audit. |
| **VERIFIED (command)** | Command output recorded during this audit. |
| **UNVERIFIED / ASSUMPTION** | Plausible but not proven in this checkout or runtime. |
| **PROPOSAL** | Target design recommended by this audit; not implemented. |
| **OWNER DECISION** | Product, policy or authorization choice the owner must make. |

## 2. Executive summary

The current toolkit is a working, Corbett-specific migration pipeline. It can
discover WordPress content, convert it to Qortal-friendly JSON, download media,
build cumulative catalogs, prepare QDN resources, and hand a batch folder to an
already-published Migration Publisher Q-App. A separate Corbett Report CMS can
load that catalog, preview imported posts, adopt them as drafts, and publish
CMS-native content.

It is **not** the target product. The current implementation has:

- one hard-coded default profile and one batch root;
- a CLI-first orchestration file that hard-codes Corbett identifiers, names and
  Qortal manifest identifiers;
- no independent project model, no persistent source-to-QDN database, no
  conflict/locking model, and no true modified-content synchronization;
- no enforced disk budget, no reference-counted shared-media cleanup and only a
  coarse completed-batch cleanup;
- no standalone signing or publication path: real publishing is delegated to a
  Qortal Hub-hosted Q-App, and the Node engine's `publish.js` is dry-run only;
- a Corbett-branded CMS rather than a generic CMS template;
- ZIP-based distribution and a Node/npm setup requirement, not a self-contained
  `.deb`.

The Qortal platform audit confirms an important product constraint: **a running
Qortal node does not provide wallet signing to a desktop application, and no
supported external signing API for third-party desktop apps was found in the
reviewed Qortal material.** Qortal Hub's `qortalRequest` bridge signs only inside
a Q-DApp render frame. The architecture must therefore either hand publication
off to a Hub-hosted publisher Q-App or use a Hub-mediated local development
surface with explicit owner approval. Collecting private keys in the desktop GUI
is neither necessary nor acceptable.

**Recommendation:** build the product as a reusable Node.js migration engine
behind a stable event/API boundary, with an Electron desktop shell for the first
Linux release, SQLite-backed project/state storage, a generic source-adapter and
content model, a Hub-mediated publisher boundary, and a separately versioned
generic CMS template. Preserve the current Corbett pipeline as a compatibility
profile and regression fixture.

## 3. Repository baseline

### 3.1 Shape

| Area | Current path | What it contains |
| --- | --- | --- |
| WordPress client | `src/wpClient.js` | REST client, pagination, application-password and session auth |
| Configuration | `src/config.js` | Environment/profile merge, limits, Qortal names, media policy |
| Profiles | `src/profile.js`, `profiles/corbettreport/profile.json` | One `corbettreport` profile and QDN identifier generation |
| Raw dump | `src/dump.js` | Posts/pages/categories/tags/media acquisition |
| Conversion | `src/convert.js`, `src/convertRaw.js` | Normalized WordPress content, media/URL maps, index files |
| Media planning | `src/planMedia.js` | HEAD-based size estimation and download plan |
| Media download | `src/downloadMedia.js` | Streaming downloads, SHA-256, retry, resumable skip |
| Validation | `src/validate.js` | Structural checks over raw/converted output |
| QDN preparation | `src/preparePublish.js` | Services, identifiers, manifest and publish plan |
| QDN dry-run | `src/publish.js` | Dry-run validation only; no real publication |
| Manifest merge | `src/mergeQdnManifests.js` | Multi-publisher cumulative catalog merge |
| Batch orchestration | `scripts/runCorbettBatch.js` | `state.json`, init/next/retry/complete/cleanup/catalog |
| Setup/diagnostics | `scripts/doctor.js`, `scripts/setup-linux.sh` | Environment and node checks |
| Migration Publisher Q-App | `viewer/src/publisher/PublisherPage.tsx` | Browser folder picker, publish modes, Hub bridge publishing |
| Corbett CMS Q-App | `corbettreport/` | Public site, author backend, imported-content adoption |
| Tests | `test/*.test.js` | 15 unit tests |
| Packaging | `scripts/create*.js` | ZIP/release bundles, no `.deb` |
| Documentation | `README.md`, `docs/`, `corbettreport/docs/` | Operational runbooks and resource strategy |

The root package is ESM (`"type": "module"`), requires Node.js `>=20`, and has
only two runtime dependencies: `cheerio` and `dotenv`
(`package.json`). `viewer` and `corbettreport` are separate Vite/React
packages. `corbettreport` is not a root workspace, so root `npm install` does
not install its dependencies.

### 3.2 Verified command evidence

The following was run during this audit without source changes:

```text
npm test        -> 15 tests, 15 pass, 0 fail
npm run check   -> tests pass; viewer production build succeeds;
                   corbettreport production build succeeds
```

`git status --porcelain` remained clean after the builds. The build outputs are
ignored (`viewer/dist/`, `corbettreport/dist/`). This proves the current
documented check succeeds; it does not prove migration correctness, QDN
publication, host behavior or production readiness.

## 4. Verified existing capabilities

### 4.1 WordPress discovery and connection checks

**VERIFIED (repo):**

- `WordPressClient` supports `application_password` and `session` authentication
  (`src/wpClient.js`).
- Application-password auth is a Basic authorization header. Session auth fetches
  the login form, copies form fields and cookies, posts credentials, and checks
  for a `wordpress_logged_in_` cookie (`src/wpClient.js`).
- Collection reads use `per_page`, `page` or `offset`, `X-WP-TotalPages`, and a
  guard for `rest_post_invalid_page_number` (`src/wpClient.js`).
- Posts can be read by offset/date (`before`, `after`, `order`, `orderby=date`)
  (`src/wpClient.js`).
- `src/inspect.js` checks the REST root, posts, pages, categories, tags and media
  and reports authentication hints.
- `scripts/doctor.js` checks Node version, `.env`, WordPress URL/login presence,
  selected Qortal name, node reachability/sync, readable `cr-qdn-manifest` and
  `cms-manifest`, output folder writability and free disk (warning below 10 GB).
- Tests cover descending offset pagination, date cursors, new-post cursors and a
  filtered short/empty page (`test/wp-client.test.js`).

**Limits:**

- The client has no retry/backoff, rate-limit handling or explicit timeout for
  WordPress requests.
- Session login is HTML-scraping of `#loginform` and is inherently brittle.
- `src/inspect.js` is a CLI, not a reusable connection-check API.
- The client does not discover WordPress capabilities/plugins, custom post types,
  menus, users, comments, revisions or redirects.

### 4.2 Profiles and configuration

**VERIFIED (repo):**

- `loadProfile()` reads `profiles/<id>/profile.json`, validates `id` and
  `resource_prefix`, and derives identifiers (`src/profile.js`).
- The only current profile is `profiles/corbettreport/profile.json` (`cr` prefix,
  `Corbett` content/site name, `CorbettReport` sysop, coauthors
  `AgoristMarket,iffi`).
- `.env.example` explicitly states that the Corbett profile is the only supported
  profile.
- `loadConfig()` merges `.env`, profile `.env`, profile JSON and environment
  variables; validates auth mode, media scope and positive integers; exposes
  Qortal names, node URL and API key (`src/config.js`).
- Identifier generation produces:
  `cr-qdn-manifest`, `cr-posts-index`, `cr-pages-index`, `cr-categories`,
  `cr-tags`, `cr-media-map`, `cr-url-map`, `cr-import-manifest`
  (`src/profile.js`).
- Tests assert the default profile and its names (`test/profile.test.js`).

**Limits:** profile loading is relative to the process working directory; there
is no project-level profile selection in a GUI, no profile schema version, and
the profile schema is undocumented beyond the example.

### 4.3 Content acquisition, conversion and common fields

**VERIFIED (repo):**

- `src/dump.js` writes raw posts/pages/categories/tags/media and a
  `dump-manifest.json` with limits, counts, source IDs and errors. It merges
  historical and recent posts by `id` and sorts by date.
- `src/convert.js` normalizes posts, pages, categories, tags and media into
  JSON with source identity, URLs, titles, dates, status, excerpt, HTML, plain
  text, summary, terms, featured media, attachments, extracted media, links and
  import metadata.
- `src/convert.js` extracts images/audio/video/documents/embeds and internal vs
  external links from HTML.
- `src/convertRaw.js` resets converted post/page directories, writes one JSON
  file per item, preserves downloaded-media fields, builds `posts-index.json`,
  `pages-index.json`, `categories.json`, `tags.json`, `media-map.json`,
  `url-map.json` and `import-manifest.json`, and rewrites internal links.
- Internal WordPress links become hash routes such as `#/posts/<slug>`,
  `#/pages/<slug>`, `#/category/<slug>` and `#/tag/<slug>`
  (`src/utils/html.js`, tests in `test/convert.test.js`).
- Content filenames include `--wp-<source_id>` so colliding slugs remain unique
  (`src/convert.js`, tested).
- Timestamps normalize WordPress GMT values to explicit ISO values with `Z`
  (`src/convert.js`, tested).

**Limits:** the model is WordPress-shaped (`source: 'wordpress'`,
WordPress numeric IDs, WordPress HTML), not a platform-neutral content model. It
has no explicit content schema version, no per-field provenance, no stable
content hash, no deletion/withdrawal state and no adapter boundary.

### 4.4 Media planning, download and validation

**VERIFIED (repo):**

- `src/planMedia.js` uses concurrent HEAD requests (6 workers) to classify media
  as included/skipped, capture `content-length`/content type, and write
  `logs/media-plan.json`.
- It defaults to same-site media; external media is included only when
  `DOWNLOAD_EXTERNAL_MEDIA=true`.
- `src/downloadMedia.js` streams to a `.part` file, hashes SHA-256 while
  streaming, renames atomically, retries with backoff, skips already-downloaded
  entries, rejects HTML responses, and checkpoints `media-map.json` after each
  item. Concurrency/attempt/delay are env-configurable.
- Existing non-empty files are re-hashed and recovered rather than re-downloaded.
- `src/validate.js` checks required raw/converted files, index fields, duplicate
  content paths, missing category/tag IDs, media URL/service consistency and
  expected downloads (`--require-media`, `--allow-missing-media`). It writes
  `logs/validation.json`.
- `scripts/doctor.js` uses `statfs` and warns when free space is below 10 GB.

**Limits:** no pre-download free-space enforcement, no per-run byte cap, no
per-file cap, no disk reservation, no symlink/path hardening, no content-hash
dedupe across batches, no shared-media reference counting, and no reserve for
the Qortal tmp/upload path.

### 4.5 QDN resource preparation

**VERIFIED (repo):**

- `src/preparePublish.js` chooses QDN services:
  - posts/pages/indexes/manifests → `DOCUMENT`
  - images → `IMAGE`
  - audio → `AUDIO`
  - video → `VIDEO`
  - documents/other → `FILE`
- Identifiers are `<prefix>-<type>-<slug>-<sha256(source)_10>` or index
  identifiers, capped at 64 characters.
- It emits `converted/qdn-manifest.json` with:
  - entrypoints;
  - `resources.by_path`;
  - `resources.by_identifier`;
  - `resources.by_source_url`;
  - linked-only media;
  - publisher/coauthor/public author metadata.
- It emits `publish-log/publish-plan.json`, empty `published-resources.json` and
  empty `errors.json`.
- `src/mergeQdnManifests.js` merges multiple publisher manifests; later sources
  intentionally override media source URLs; content paths stay canonical.
- `src/publish.js` validates resources, identifiers (≤64), local files, duplicate
  identifiers and optional node `/admin/status` + `/arbitrary/check/tmp` checks,
  then writes a dry-run log.

**Limits:** the manifest is a derived index and has no schema version beyond
`version: '0.1.5'`; generated identifiers are not written back into
`media-map.json`; there is no source-ID keyed identity index; there is no
per-resource content hash in the manifest; and `publish.js` explicitly refuses
real publication (`Real QDN publishing is not implemented yet`).

### 4.6 Batch state, retry, completion and cleanup

**VERIFIED (repo):**

- `scripts/runCorbettBatch.js` stores `workspaces/corbettreport-batches/state.json`
  with `version: 2`, `batch_size`, `next_offset`, `next_before`,
  `latest_seen_after`, `historical_exhausted`, `baseline` and `batches`.
- Batch statuses observed: `building`, `failed`, `prepared`, `completed`;
  cleanup adds `cleaned_at` and `receipt_dir`.
- `batch:init --from-qdn` downloads `cr-qdn-manifest`, indexes and media map into
  `baseline-qdn/converted/` and derives cursors from post dates.
- `batch:init --from=<batch>` records an existing batch as baseline.
- `batch:next`:
  - refuses without a baseline;
  - refuses if a prepared or unfinished batch exists;
  - sets `OUTPUT_DIR`, `LIMIT_POSTS`, `LIMIT_RECENT_POSTS`, `POSTS_OFFSET`,
    `POSTS_BEFORE`, `POSTS_AFTER`, `FETCH_HISTORICAL_POSTS`, `MEDIA_SCOPE`,
    `DOWNLOAD_MEDIA`, `DOWNLOAD_MEDIA_TYPES` and `MIGRATION_PROFILE`;
  - runs `dump`, `convert`, `plan-media`, `download-media`, `validate`,
    optional media validation, `prepare-publish`;
  - rebuilds a cumulative catalog from baseline/previous batches/receipts.
- `batch:retry` resumes the failed batch and re-runs download/validate/prepare.
- `batch:complete` advances the historical and recent cursors and marks the batch
  completed.
- `batch:cleanup` copies a small receipt set, deletes the whole batch directory
  and records `receipt_dir`.
- Defaults are 50 historical posts and 100 recent posts; `CORBETT_BATCH_SIZE` and
  `CORBETT_RECENT_LIMIT` can override per invocation. The runbook recommends 10
  for the first batch. A value of 15 is supported by the env-driven code path but
  is not a first-class product setting.
- `batch:catalog` rebuilds the cumulative catalog for a prepared/completed batch.

**Limits:** this is a single-project workflow hard-coded to Corbett. There is no
lock, no per-step journal, no atomic state write, no state schema migration, no
run history beyond the batch array, and no verification that QDN publication or
CMS adoption actually happened before `batch:complete` or `batch:cleanup`.

### 4.7 Migration Publisher Q-App

**VERIFIED (repo):**

- `viewer/src/publisher/PublisherPage.tsx` reads `publish-plan.json` or
  `catalog-publish-plan.json` from a selected folder or bundled content.
- It offers modes: Demo, CMS JSON, Merged catalog, Images, Documents, Audio,
  Video, Selected media, Full media.
- It detects the Qortal bridge (`viewer/src/qortalClient.ts`), supports
  `FETCH_QDN_RESOURCE` existence checks and `PUBLISH_MULTIPLE_QDN_RESOURCES`.
- It keeps a localStorage publish history keyed by
  `name:service:identifier`, skips already-published resources by default, and
  always re-publishes mutable catalog resources.
- On a thrown publish error it re-checks each resource and distinguishes
  pre-existing, newly confirmed and missing resources.
- It hydrates the manifest publisher name before publishing.
- It blocks resources whose target name differs from the active name.

**Limits:**

- It sends all selected resources in one `PUBLISH_MULTIPLE_QDN_RESOURCES` call.
  The Qortal reference advises batches of at most 20 and warns about the 26th
  unconfirmed transaction limit. No chunking or unconfirmed-transaction polling
  exists.
- Existence is checked with a full `FETCH_QDN_RESOURCE`; it does not use
  `GET_QDN_RESOURCE_STATUS` or metadata search, and it does not verify the
  intended revision/content hash.
- It can mark a resource published from local history without a fresh read-back.
- It does not normalize a **resolved** response containing
  `error.unsuccessfulPublishes`; it only handles thrown errors and then re-checks.
- It relies on `window.parent`/`window.top` bridge probing. The control-plane
  Qortal reference says current Core injects the function into the app's own
  window and parent probing is not the verified mechanism.
- It has no test suite; `viewer` has only build scripts.

### 4.8 Corbett Report CMS

**VERIFIED (repo):**

- `corbettreport/src/cms/cmsRepository.ts` defines a CMS dataset with a manifest,
  posts/pages indexes, categories, tags, media, comments and local posts.
- It publishes/reads `cms-manifest`, `cms-posts-index`, `cms-pages-index`,
  `cms-categories`, `cms-tags`, `cms-media-index` and `cms-comments-index`.
- It resolves the viewer account through `GET_USER_ACCOUNT`, names through
  `GET_ACCOUNT_NAMES`/`GET_PRIMARY_NAME`, and supports sysop/coauthor roles.
- It loads the migration manifest `cr-qdn-manifest` and imported post indexes;
  `CmsBackendApp.loadImportedManifest()` (`corbettreport/src/cms/CmsBackendApp.tsx:1395`)
  loads manifest, posts, categories, tags and media map.
- It previews imported posts, builds CMS drafts (`buildCmsPostFromImported`,
  line 1612), and adopts one or up to 10 selected posts
  (`adoptImportedPost`, line 1702; `adoptSelectedImportedPosts`, line 1764).
- Adopted posts use `id: wp-<source_id>` (line ~1640), which is the current
  duplicate-prevention key inside the CMS.
- It rewrites imported HTML media links to QDN references, handles featured
  images and videos, and publishes CMS resources through the Hub bridge.
- It supports trusted coauthor/operator manifests and merges them when
  `canonical_site_name` matches the site (`cmsRepository.ts`).
- It has no sanitizer dependency; imported HTML is parsed/rewritten with
  `DOMParser` and rendered as HTML. This is a security gap for untrusted or
  compromised source content.

**Limits:** the app is Corbett-specific (branding, routes, identifiers and
`cr-qdn-manifest` defaults). There is no generic site template, no template
contract, no localization framework and no test suite.

### 4.9 Packaging, documentation and conventions

**VERIFIED (repo):**

- `scripts/setup-linux.sh` requires Node.js 20+ and npm, runs `npm install`,
  creates `.env` from `.env.example` with mode `600`, and creates
  `wp-qortal-import`.
- Packaging scripts create ZIPs for the toolkit, migration Q-App, CMS Q-App and
  tester bundle. `scripts/createMigrationPackage.js` excludes `node_modules`,
  `dist`, `workspaces`, `.env`, `wp-qortal-import` and some build-only scripts.
- `README.md`, `QUICKSTART.md`, `docs/ZORIN_LINUX_SETUP.md`,
  `docs/CORBETT_MIGRATION_RUNBOOK.md` and `docs/QDN_RESOURCE_STRATEGY.md`
  document the current operational flow: local preparation, Hub-hosted
  publishing, CMS adoption, completion and cleanup.
- `corbettreport/docs/ARCHITECTURE.md` documents the CMS content layers,
  operator manifests, name roles and internal-link rule.
- `.env` and `profiles/*/.env` are gitignored. `.env.example` is tracked and
  contains no secrets.
- No `.deb`, app metadata, update channel, signing key, SBOM or reproducible
  release process exists.

### 4.10 Historical generic prior art

**VERIFIED (repo history):** commit `f6eec4b` ("Refocus toolkit on Corbett
Report migration") removed a former generic profile directory (`wpq` prefix,
empty site names), a former generic qortal-cms application and a generic profile
README. The
current tree retains only the Corbett profile. This is useful prior art for the
generic product but is **not** a current capability and must not be presented as
supported. Any reuse must be re-audited rather than restored blindly.

## 5. Qortal platform and integration audit

### 5.1 Verified Qortal facts relevant to this product

| Fact | Evidence label | Consequence for the product |
| --- | --- | --- |
| QDN resources are addressed by `(service, name, identifier)`; republishing the same triple overwrites it. | VERIFIED (pinned Qortal reference) | Stable source→QDN identity is possible and updates can overwrite the same resource. |
| Publishing requires current ownership of the registered name; authority can transfer. | VERIFIED (pinned Qortal reference) | Resolve ownership per session; never hard-code owner names; show name ownership errors clearly. |
| QDN has no on-chain delete. Hosted-data deletion removes only local hosted data; the network record remains. Tombstone/overwrite-and-filter is an app convention. | VERIFIED (pinned Qortal reference) | Product deletion policy must be "withdraw/hide", not "delete from network". |
| Services include `DOCUMENT`, `JSON`, `IMAGE`, `THUMBNAIL`, `VIDEO`, `AUDIO`, `FILE`, `APP`, `WEBSITE`, with different limits and validation. | VERIFIED (pinned Qortal reference) | Current `DOCUMENT` use for JSON is valid but the consumer must schema-validate; `JSON` (25 KB) is an option for small records. |
| Identifiers are limited to 64 characters. | VERIFIED (repo `IDENTIFIER_MAX_LENGTH`; pinned reference) | Current generator enforces this; the new identity layer must too. |
| The Qortal Hub bridge (`qortalRequest`) is injected into a rendered Q-App frame and mediates account/auth and signed writes with approval. | VERIFIED (pinned Qortal reference) | A desktop app outside the frame cannot use it as-is. |
| `GET_USER_ACCOUNT` returns `{address, publicKey}`, not a name; names are separate. | VERIFIED (pinned Qortal reference) | Identity UI must resolve names separately and verify ownership. |
| `qortalRequest` is a lexical global; `window.qortalRequest`/`globalThis.qortalRequest` may be undefined inside a real host. | VERIFIED (pinned Qortal reference) | Bridge detection must use a `typeof` guard on the bare identifier; current viewer's parent/top probing is unverified legacy behavior. |
| `PUBLISH_QDN_RESOURCE` / `PUBLISH_MULTIPLE_QDN_RESOURCES` are host-approved signed writes; the latter is one approval over independent transactions with partial success. | VERIFIED (pinned Qortal reference) | Publication is resumable per resource; batch results need per-resource status and `error.unsuccessfulPublishes` handling. |
| Multi-publish should be ≤20 resources; Core refuses the 26th unconfirmed transaction per account. | VERIFIED (pinned Qortal reference) | Chunk publication and poll unconfirmed transactions; current publisher does neither. |
| QDN publish fee is 0.01 QORT per resource; multi-publish is n transactions. | VERIFIED (pinned Qortal reference) | Show cost and balance; never publish automatically. |
| `FETCH_QDN_RESOURCE` may return a parsed object/array or a string, depending on body. | VERIFIED (pinned Qortal reference) | Normalize at the transport boundary; current viewer does a version of this. |
| `GET_QDN_RESOURCE_STATUS` reports resource readiness/status; `READY` is not proof of a newly submitted revision. | VERIFIED (pinned Qortal reference) | Verification must compare served content/hash/revision, not just status. |
| Render CSP is restrictive and Q-App assets must be same-origin/local; Hub Dev Mode proxy differs and is not production evidence. | VERIFIED (pinned Qortal reference) | Desktop-integrated publishing via a browser frame must be designed around CSP and host contexts. |
| Qortal Core default ports are 12391 (mainnet) and 62391 (testnet), but ports are configurable. | VERIFIED (pinned Qortal reference) | Do not hard-code a network/port; record the environment. |

### 5.2 What the current repository actually uses

**VERIFIED (repo):**

- Read-only node calls:
  - `GET /admin/status` and `GET /arbitrary/check/tmp` in `src/publish.js` and
    `scripts/doctor.js`.
  - `GET /arbitrary/DOCUMENT/<name>/<identifier>` in
    `scripts/runCorbettBatch.js` (`fetchQdnJson`) and
    `corbettreport/src/cms/qortalClient.ts`.
- Hub bridge calls:
  - `FETCH_QDN_RESOURCE`, `PUBLISH_MULTIPLE_QDN_RESOURCES`, `GET_USER_ACCOUNT`,
    `GET_ACCOUNT_NAMES`, `GET_PRIMARY_NAME`, `GET_QDN_RESOURCE_STATUS`,
    `GET_QDN_RESOURCE_URL`, `PUBLISH_QDN_RESOURCE` (CMS media helper).
- The Node engine itself does **not** sign or publish. `src/publish.js` is
  explicitly dry-run only. The only real publication path is the Hub-hosted
  Q-App.

### 5.3 Does a running Qortal node provide wallet signing?

**No, not in the reviewed evidence.**

- The Node engine reads the node over HTTP. `QORTAL_API_KEY` is used only for the
  optional `/arbitrary/check/tmp` check; it is an API-access credential, not a
  wallet key and not a signing capability.
- Qortal Core's documented public/admin API surface in the reviewed references
  exposes chain/resource reads and some raw-transaction decode/build helpers, but
  no wallet-unlock or remote-signing service for third-party desktop apps.
- Qortal Hub's signing boundary is the host-mediated `qortalRequest` bridge; the
  host performs signing after approval, and the app never sees keys.
- **No supported external signing API for a standalone desktop process was found
  in the reviewed Qortal material.** This is a "not found / not verified"
  negative, not a proof that no private/undocumented API exists. The product must
  not invent one.

### 5.4 Is standalone desktop QDN publishing supported?

**Not as a fully standalone, key-free desktop feature.**

The feasible configurations are:

| Option | Description | Feasibility | Security | Recommendation |
| --- | --- | --- | --- | --- |
| A. Hub-hosted publisher handoff | Desktop prepares and verifies a batch; user opens a published Migration Publisher Q-App in Qortal Hub and selects the batch folder. Hub signs each publish. | **Verified operational pattern** (current toolkit) | No keys in desktop; host approval; batch folder must be selected manually | **Default for v1** |
| B. Hub Dev Mode local server | Desktop starts a loopback-only publisher UI/server; user adds it in Hub Dev Mode → Server; Hub injects `qortalRequest` and signs. | **Feasible in principle** from documented Dev Mode; not validated for this product | Loopback server, origin/CSP, token, path allowlist, dev-mode-only; not a production host contract | Optional advanced mode, owner decision |
| C. Desktop collects private key/seed | Sign locally with a key stored by the desktop app. | Technically possible but **prohibited** by requirement 15 and the job boundaries | Unacceptable key custody and blast radius | **Rejected** |
| D. Undocumented Hub/Core external API | Desktop calls a private signing endpoint. | **Not found / not verified** | Would be unsupported and fragile | **Do not implement** |
| E. Remote signing service | Send unsigned payload to a third-party signer. | Not part of Qortal's reviewed model | New trust/authorization boundary | **Not proposed** |

**Conclusion:** integrated QDN publication is feasible only through a
Hub-mediated Q-App surface. The desktop GUI can own discovery, conversion,
planning, media, state, verification and retry; Hub must own approval and
signing. Requirement 13 ("integrated QDN publication where technically
feasible") should be interpreted as **integrated preparation + guided Hub
publication + read-back verification**, not autonomous desktop signing.

## 6. Confirmed gaps against the target product

Severity is relative to the target product, not to the current Corbett workflow.

| # | Gap | Evidence | Severity | Required change |
| --- | --- | --- | --- | --- |
| G1 | No multi-project model | single `workspaces/corbettreport-batches/state.json`; `MIGRATION_PROFILE=corbettreport` hard-coded in batch env | Blocker | Project registry, per-project roots, project-scoped config/state/secrets |
| G2 | Single hard-coded profile and identifiers | `profiles/corbettreport/profile.json`; `runCorbettBatch.js` hard-codes `cr-*` | Blocker | Generic project config + adapter; profile preserved as compatibility |
| G3 | No common content model | WordPress-shaped JSON in `src/convert.js` | Blocker | Versioned normalized model and adapter contract |
| G4 | No persistent source→QDN identity database | mappings live in generated manifests/receipts; media map lacks QDN IDs | Blocker | Transactional identity table with source ID, content hash, QDN triple, revision/tx |
| G5 | No real modified-content sync | only `POSTS_AFTER` + historical `before` cursors; modified older posts are not revisited | High | Modified watermark + overlap + full reconciliation; content-hash comparison |
| G6 | No deletion/withdrawal policy | no deletion state in model or workflow | High | Withdrawal/tombstone policy and CMS hide semantics; never claim network delete |
| G7 | No duplicate/conflict protection | no lock; no compare-and-swap; CMS key is only `wp-<source_id>` | High | Project lock, idempotency keys, conflict records, UI resolution |
| G8 | No enforced disk budget | HEAD sizes and `statfs` warning only | High | Reservation, projected-size check, per-run/file caps, streaming guard |
| G9 | Cleanup is coarse and weakly verified | `batch:cleanup` deletes accepted `completed` batch directory after copying receipts; no publication proof or shared-media ref count | High | Verified-publish gate, reference counting, two-phase cleanup, quarantine/undo |
| G10 | No integrated publication from engine | `src/publish.js` dry-run only | High | Publisher adapter with Hub handoff/dev-server modes and verification |
| G11 | No read-back publication verification | publisher uses existence check/history; no intended-revision comparison | High | Per-resource content-hash/status/tx verification and truthful states |
| G12 | Publisher batch limits unhandled | one multi-publish for all selected resources | High | Chunk ≤20, poll unconfirmed, per-resource partial handling |
| G13 | Corbett-specific CMS | `corbettreport/`, hard-coded branding/routes/manifest | Blocker | Generic CMS template + custom clone mechanism |
| G14 | No source-adapter abstraction | direct WordPress code in engine | Blocker | Adapter contract + capability declarations + conformance suite |
| G15 | No self-contained Linux install | setup requires Node 20/npm; ZIP distribution | High | Electron/Tauri bundle + `.deb`; no external Node/npm/Git |
| G16 | No schema/version migration framework | `state.version = 2`, manifest `version: 0.1.5` string | High | Versioned schemas and explicit migrations |
| G17 | No crash-safe state writes/lock | `writeState` writes JSON directly; no fsync/lock | High | SQLite/WAL or atomic snapshot+journal; single-writer lock |
| G18 | No secret storage beyond `.env`/file mode 600 | `.env`, `QORTAL_API_KEY_FILE` | High | OS keyring (`safeStorage`/libsecret), secret references, redaction |
| G19 | Imported HTML not sanitized | CMS rewrites with `DOMParser`, renders HTML | High | Maintained sanitizer / safe document model with regression fixtures |
| G20 | No automated integration/contract tests | 15 unit tests only | High | Adapter conformance, fake Hub/WP/media, crash/disk fault tests |
| G21 | No i18n framework | English strings embedded in React | Medium | Message catalog, locale-aware formatting, English default |
| G22 | Windows not addressed | Linux shell setup only | Medium | Platform abstraction and later packaging plan |
| G23 | No update/release provenance | ZIP scripts only; no signatures/SBOM | Medium | Signed builds, checksums, release manifest |
| G24 | Accessibility/responsiveness unverified | no a11y tests | Medium | Keyboard/focus/labels/reduced-motion acceptance tests |

## 7. Architecture decisions investigated

### 7.1 Electron versus Tauri

| Criterion | Electron | Tauri | Assessment |
| --- | --- | --- | --- |
| Reuse existing Node engine | Native main process | Requires Node sidecar/bridge | Electron is lower integration risk |
| Linux `.deb` | Mature tooling | Needs distro packaging + WebKitGTK | Electron is faster to first release |
| Chromium folder picker | Built in | WebView differences | Electron matches current Q-App publisher behavior |
| Package size | Large | Small | Tauri wins on size |
| Security updates | Chromium cadence; needs discipline | System WebKitGTK | Both need hardening |
| Windows future | Strong | Strong | Comparable |
| Hub integration | No difference: neither can sign outside Hub | No difference | Qortal constraint dominates |
| Team/implementation | Existing JS/Node | Rust + JS | Electron is lower risk |

**PROPOSAL:** use Electron for the first Linux release, with the engine isolated
behind an IPC/API boundary so a Tauri shell can be evaluated later. Do not make
the desktop shell own domain logic. The shell choice is reversible; the engine
boundary is not.

### 7.2 Reusable engine API versus direct CLI execution

**PROPOSAL:** expose the engine as pure ESM modules plus a stable host protocol
(JSON-RPC-like over `stdio` or Electron IPC). Keep the current CLI as a thin
compatibility wrapper. Rationale:

- the GUI needs structured progress, cancellation, pause/resume and typed errors;
- spawning `npm run ...` per phase loses state and produces unstructured logs;
- tests can call the engine without a GUI;
- future headless/server/CLI use is possible;
- the current `spawnSync('npm', ...)` orchestration is unsuitable for a
  long-running desktop app.

### 7.3 Structured progress and error events

**PROPOSAL:** one event envelope with:

```json
{
  "schema": "qms-event@1",
  "seq": 42,
  "timestamp": "2026-11-02T16:33:24Z",
  "project_id": "prj_...",
  "run_id": "run_...",
  "item_id": "src_post_123",
  "phase": "media.download",
  "type": "progress",
  "level": "info",
  "code": "MEDIA_DOWNLOADED",
  "message": "Downloaded 1 of 4 files",
  "progress": { "completed": 1, "total": 4, "bytes": 1048576 },
  "retryable": false,
  "details": {}
}
```

Events must never include credentials, cookies, seeds, private keys, full
signed payloads or unnecessary personal data. Errors must carry a stable code,
safe message, retryability and a correlation ID.

### 7.4 Persistent state and versioned formats

**PROPOSAL:** SQLite (WAL, foreign keys, single-writer lock) for project,
source-item, asset, mapping, run, publication, conflict, event and cleanup
records, with JSON export for portability. If native SQLite packaging proves
problematic, use an append-only JSONL journal plus atomic snapshots behind the
same repository interface. Either way:

- every schema has an explicit version;
- migrations are forward-only and tested;
- content files stay on disk with hashes; the database stores metadata and
  mappings;
- backups export both database and file manifest.

### 7.5 Qortal Core API and Hub signing integration

**VERIFIED:** use the node for read-only discovery/status/verification; use Hub
for signing inside a Q-App frame. **PROPOSAL:** a `PublisherAdapter` with modes:

- `dry-run` — plan/validate only;
- `hub-handoff` — write a batch + publisher instructions; verify after the user
  publishes in Hub;
- `hub-devserver` — optional loopback publisher UI surfaced through Hub Dev Mode;
- `disabled` — no publication.

The adapter exposes capabilities so the GUI can say "publishing requires Qortal
Hub" instead of failing late.

### 7.6 Generic CMS and templates

**PROPOSAL:** a versioned CMS template contract separate from the migration
engine. The default template is a neutral Qortal site with posts/pages, terms,
media, search, archive, a minimal author backend and an import/adoption view.
Corbett becomes a custom template/profile clone that preserves current names and
identifiers. The engine must not contain template branding.

### 7.7 Content updates, deletion and conflicts

**PROPOSAL:** treat the source as authoritative only when the user says so.
Classify every item as new, modified, unchanged, source-withdrawn, conflict or
error. Republish a modified item to the same stable QDN triple only after a
content-hash comparison and conflict policy. Withdrawal defaults to a local
`withdrawn` state and CMS hide; a tombstone/republish is an explicit owner policy,
because QDN has no delete.

### 7.8 QDN publication verification and completion

**PROPOSAL:** completion requires per-resource evidence:

1. submission result (tx signature if available);
2. node/bridge status `READY`/available;
3. exact `(service, name, identifier)` read-back;
4. content hash/schema match to the intended resource;
5. derived indexes verified after content;
6. no unresolved partial failures.

A publish approval, a `READY` status or a local history entry alone is not
completion. `PUBLISH_MULTIPLE_QDN_RESOURCES` partial results must be normalized
from both thrown and resolved shapes.

### 7.9 Disk cleanup and shared media

**PROPOSAL:** reference-count media by content hash and source identity; never
delete an asset referenced by a pending/failed batch or an unverified item.
Cleanup is two-phase (mark/quarantine, then delete), only for verified completed
runs, with receipts retaining manifests, hashes, mappings, publish evidence and
error summaries. Protect against path traversal and symlinks; never delete
outside the project root.

### 7.10 Linux packaging, testing and release automation

**PROPOSAL:** Electron + `electron-builder` (or equivalent) to produce a `.deb`
that bundles the engine and Node runtime. Build in a clean environment, run the
full check, produce checksums/SBOM, sign artifacts, and publish release notes.
No `sudo`, system packages, Node/npm/Git or network service required at runtime.
Windows support is a later shell/packaging phase, not a rewrite.

### 7.11 Security boundaries

**PROPOSAL:** Electron `contextIsolation: true`, `nodeIntegration: false`,
sandboxed renderer, narrow preload API, no remote module, strict CSP, validated
IPC, loopback-only local services with random tokens, OS keyring for secrets,
path allowlists/realpath checks, HTML sanitization, SSRF controls for source and
media URLs, and no private-key collection. WordPress credentials are
project-scoped secrets; Qortal signing remains in Hub.

## 8. Feasibility assessment summary

| Capability | Current state | Target feasibility | Notes |
| --- | --- | --- | --- |
| WordPress discovery/checks | Working CLI | High | Extract reusable adapter/API |
| Full WordPress migration | Working Corbett pipeline | High | Generalize model and profiles |
| Incremental new content | Partial | High | Current recent cursor works for new posts |
| Modified content sync | Missing | Medium | Requires modified watermark, hashes, conflicts |
| Persistent identity mapping | Implicit in manifests | High | Add database |
| Duplicate prevention | Cursor + CMS `wp-<id>` + QDN identifiers | Medium | Add idempotency and locks |
| Configurable batch size 15 | Env-supported | High | First-class setting + validation |
| Download/disk protection | Partial warning only | High | Enforce preflight and caps |
| Safe cleanup | Coarse | Medium | Ref counting, verification, quarantine |
| History after cleanup | Receipts only | High | Database + receipts |
| Crash recovery | Batch-level retry | Medium | Journal/lock/atomic state |
| Integrated QDN publishing | Hub Q-App only | Medium | Hub dependency; no standalone signer |
| Secure signing/no keys | Hub-mediated; no keys collected | High (with Hub) | Requirement 15 satisfied by design |
| Default generic CMS | Missing (Corbett only) | High | Build template; preserve custom clone |
| Future adapters | Missing | High | Adapter contract + conformance suite |
| Self-contained Linux install | Missing | High | Bundle runtime, `.deb` |
| English + future localization | English hard-coded | High | i18n framework |
| Windows future | Not addressed | Medium | Shell abstraction first |

## 9. Risks and blockers

### 9.1 Blocking risks

1. **Standalone signing does not exist in the reviewed Qortal model.** A product
   promise of "publish from the desktop without Hub" would be false. Owner must
   accept a Hub-mediated publication boundary or explicitly authorize a different
   supported mechanism after new evidence.
2. **Generic CMS is a product, not a refactor.** The current CMS is tightly
   coupled to Corbett routes, branding, identifiers and import flow. A generic
   template needs its own design and acceptance tests.
3. **Current state model is single-project and not crash-safe.** Building the GUI
   on top of `state.json` and `spawnSync` would encode the wrong architecture.

### 9.2 High risks

- Partial/ambiguous QDN publication can create false "success" states; fees and
  unconfirmed transaction limits make retries expensive.
- Imported HTML is rendered without a sanitizer; source compromise could execute
  in the CMS/Q-App.
- Disk exhaustion during large media imports can corrupt local state if not
  guarded.
- Cleanup can delete the only local copy of media referenced by another batch or
  a retry.
- QDN derived indexes can lag, be partial or be unreadable; the UI must not show
  false emptiness.

### 9.3 Medium risks

- WordPress session login is brittle and may trigger security plugins.
- Node/Electron native module packaging (SQLite) can break `.deb` builds.
- Windows path, filesystem and credential-store differences.
- Qortal Hub version drift and bridge response changes.
- Localization and accessibility debt.

## 10. Reusable architectural findings

These are candidates for a later capability-harvest step; this job did not
create or modify a control-plane skill.

1. **Hub-mediated publication boundary.** For desktop tools, separate
   *preparation/verification* from *signing*. The reusable pattern is a publisher
   adapter that emits a portable batch, hands off to a host Q-App, then verifies
   exact resources. Do not build a desktop signing path without a supported
   external signer.
2. **Stable source identity → stable QDN identity.** Use source adapter ID +
   content hash + stable QDN identifier. Persist the mapping independently of
   local batch cleanup.
3. **Derived index is not authority.** The QDN manifest/index should be
   rebuildable and must not be the only source of truth for what exists.
4. **Publication completion is read-back evidence.** Submission, status,
   intended-revision content match and index verification are distinct.
5. **Batch cleanup is a data-integrity operation.** Require verified completion,
   shared-media reference counting and retained receipts.
6. **Generic engine, local presentation.** The durable abstraction is the
   adapter/content/plan/publish contract; branding, routes and templates belong
   to a template package.

## 11. Open questions requiring owner decisions

1. Is Hub-mediated publication acceptable as the v1 publishing model, or must
   the product wait for a supported external signer?
2. If Hub-mediated, is option B (Hub Dev Mode loopback server) acceptable as an
   advanced integrated mode, or should v1 only hand off to a published Q-App?
3. Which Qortal network(s) and names are in scope for development and acceptance
   (testnet vs mainnet), and who authorizes any live publish?
4. What is the default generic CMS identity (name, branding, identifier prefix,
   routes, license), and how are custom clones distributed?
5. Should imported content be served directly from the migration catalog, adopted
   into the CMS, or both? What is the default?
6. What is the deletion/withdrawal policy: local hide only, tombstone republish,
   or both with an audit trail?
7. What are the default disk reserve, per-run download cap, per-file cap and
   retention period?
8. What is the initial import scope: published posts/pages only, or drafts,
   private content, users, comments, menus, custom post types, redirects, SEO?
9. Are WordPress application passwords required, or must session login remain a
   supported fallback?
10. Is telemetry/crash reporting allowed? If yes, what data and where?
11. What is the Windows target timeline and minimum OS version?
12. Which languages are required after English, and in what order?
13. What is the signing/update trust model for `.deb` and future Windows builds?
14. Must the existing Corbett and AstuAeda identifiers/behaviors remain
    byte-compatible? (Corbett is represented in the tree; AstuAeda is not.)
15. Who owns product naming, trademark, website and support channels?

## 12. Audit conclusion

The current toolkit is a strong, real-world proof of the core migration flow and
a valuable regression baseline. It is not yet a universal product:

- its architecture is Corbett-specific and single-project;
- its state and cleanup model is not strong enough for multiple projects or
  untrusted long-running desktop use;
- its publication path depends on a Hub-hosted Q-App, and no supported
  standalone desktop signer was found;
- its CMS is a custom app, not a generic template;
- its distribution is a ZIP plus a Node/npm prerequisite, not a `.deb`.

The proposed architecture in [`ARCHITECTURE.md`](ARCHITECTURE.md) and the phased
plan in [`IMPLEMENTATION-ROADMAP.md`](IMPLEMENTATION-ROADMAP.md) address these
gaps without discarding the proven Corbett flow. The next implementation phase
should be the engine/project foundation, not UI polish or autonomous publishing.

**This audit does not establish production readiness.** It establishes a
verified baseline, a constrained publication model, and a concrete plan for
Phase 1.
