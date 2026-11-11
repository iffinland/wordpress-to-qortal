# Qortal Migration Studio 0.8.0 alpha

<!-- qms-release-version: 0.8.0-rc.6 -->

## 0.8.0 rc.6 — canonical CMS catalog loading candidate (not published)

Desktop/engine `0.8.0-rc.6` and Generic CMS `0.8.0-alpha.10` correct the
canonical Qortal APP/WEBSITE deployment contract. Publisher remains
`0.8.0-alpha.3`. This candidate is not a GitHub release, tag, auto-update or
QDN deployment.

- QMS now packages each site shell at identifier `default`. Qortal Hub resolves
  `qortal://APP/<registered-name>/` (and the WEBSITE equivalent) to that
  canonical resource, so no internal identifier belongs in the public address.
- The generated `qms-cms-config.json` remains bound to that exact hosting
  triple, site identity and project-specific manifest. Existing content,
  indexes, media, manifests, receipts and cache data are not rewritten.
- Generic CMS now fails closed with a visible diagnostic when its project
  configuration is missing, malformed or for a different host. It never falls
  back to `qms-cms-manifest` or `cr-qdn-manifest` for a hosted site.
- Explicit diagnostics retain support for the correct Hub selector form,
  `qortal://APP/<registered-name>/?identifier=<identifier>`; a slash followed
  by an identifier is an application path, not an APP resource selector.

The Telegram.EE live read-only check confirmed its existing custom APP ZIP,
embedded config and project manifest are intact. The required owner action is
one new APP-only publication to `default`; do not republish its 25 verified
content resources.

## 0.8.0 rc.5 — BUG-06 handoff continuation candidate (not published)

Desktop/engine `0.8.0-rc.5` fixes BUG-06 without changing the Publisher
(`0.8.0-alpha.3`) or Generic CMS (`0.8.0-alpha.9`) artifacts. This candidate
is not a GitHub release, tag, auto-update or QDN deployment.

- A handoff is now equivalent only when its canonical selected content
  identities/hashes **and** its CMS declaration and normalized bundle match.
  A legacy rc.3 content-only handoff can never masquerade as an rc.5 Generic
  CMS package.
- A partial or ambiguous predecessor remains immutable. QMS gives the owner an
  actionable read-only reconciliation instruction and never re-exports,
  resubmits or deletes its receipts, cache or history.
- Once every predecessor resource has exact remote verification, QMS may make a
  CMS-only successor. It contains just the already verified manifest and the
  CMS APP/WEBSITE bundle; no old content, media or index write is present. The
  Publisher rechecks the manifest and skips it when the exact bytes are already
  served before the CMS dependency can be submitted.
- For the reported NASA handoff with 17 confirmed and 17 pending/ambiguous
  records, this candidate remains correctly blocked until the 17 uncertain
  resources are reconciled by exact read-back. It does not claim a complete
  migration and does not bypass the guard.

See [BUG-06-HANDOFF-CONTINUATION.md](BUG-06-HANDOFF-CONTINUATION.md) for the
owner workflow and validation boundary.

## 0.8.0 rc.4 — local beta-blocker candidate (not published)

This candidate is deliberately **not** a GitHub release, tag, auto-update or
QDN deployment. It contains all three locally-built artifacts because all three
components changed: Desktop/engine `0.8.0-rc.4`, Publisher `0.8.0-alpha.3`,
and Generic CMS `0.8.0-alpha.9`.

- **BUG-05:** a CMS dataset cache is now bound to the authoritative hosted
  APP/WEBSITE service, name and identifier, plus manifest identifier and site
  identity. Legacy or mismatched caches, runtime configuration, catalog
  manifests and QDN references fail closed; another site's posts are never
  shown as an offline fallback.
- **BUG-04:** the engine recognizes the legacy `desktopWizard.website` setting
  when canonical website settings are absent. Generic CMS selection now either
  adds a site bundle after the manifest or aborts export. The handoff declares
  `generic-cms` versus `content-only`, and Publisher validates the embedded
  `qms-cms-config.json` against the precise APP/WEBSITE and manifest resources.
- Existing project data, receipts and remote QDN state are not rewritten. The
  owner must perform the controlled live retest described in the implementation
  report; no automatic resubmission is permitted.

## 0.8.0 rc.3 — current (published GitHub prerelease)

Desktop/engine repair; Publisher and Generic CMS product bytes are unchanged.
The primary acceptance is the bounded production-reader catalog contract, also
passed against the actual extracted .deb engine using bundled Node 20.18.3,
not a full checkpoint matrix. See [CUMULATIVE-CATALOG.md](CUMULATIVE-CATALOG.md).

- One site's A15 → B15 catalog retains all 30 imported posts; an A3 update
  replaces one logical entry. Native posts and owner edit overlays survive.
- New site versus Continue existing site is explicit. Continuation reopens the
  original project, retaining its immutable identity and namespace.
- Only exact read-back promotes a published revision; pending plans/receipts
  cannot replace the last verified catalog. Verification automatically derives
  the durable published catalog through the existing Phase 7 service.
- Unchanged content, shared media and the deployed CMS APP are reused. Stale
  handoffs cannot export a replacing catalog; unresolved batches are sequential.
- Existing project identity, namespace and QDN identifiers remain unchanged.
  No automatic remote-only identity recovery, QDN write or signing is added.

The specific reported 122-resource owner runtime has not been diagnosed from
live evidence; its same/different site relationship remains unknown. No live QDN publication is claimed. The rc.3 desktop is published at
<https://github.com/iffinland/wordpress-to-qortal/releases/tag/v0.8.0-rc.3>.
The actual unauthenticated GitHub download was checked: filename
`qortal-migration-studio_0.8.0-rc.3_amd64.deb`, 108539962 bytes, SHA-256
`47eecd4ffe2e30423e780c94fd60e8661ed6a5d7a318dcd254006a35387503a2`.
Its release tag points to build-source commit `548d91f5530bbbe29ed6cbb1df0490ed40caf477`.
No product rebuild was required for publication.

## 0.8.0 rc.2 — previous published GitHub prerelease

Fixes two owner-reported defects found in the 0.8.0-rc.1 private candidate.
Published as GitHub prerelease `v0.8.0-rc.2` from source commit `2c61ba7`; the packaged
acceptance matrix (A–J plus the QDN handoff control H) passed against the exact published
`.deb` (SHA-256 `344941454765132e99331818e1043594d2cf5ad9d220490de96459a3f2693cd7`).

- **BUG-005 — duplicate `plan.create` when entering Plan Review.** Step 5 was
  started twice: once by the step effect and once by the Continue handler. The
  engine refused the second overlapping run with *"Another plan.create
  operation is starting in this engine."*, while the first run's ready plan
  still rendered. The renderer now has exactly one trigger and a single-flight
  request with an epoch; a successful preview also clears an older error.
- **NASA Quick Scan requested 3, indexed 1.** NASA's REST API returns fewer
  rows than `per_page` (measured: `per_page=3` returns 1, `per_page=100`
  returns 45, while `X-WP-Total` still advertises 35,600). Quick scan now asks
  for a full 100-item page and keeps only the requested number, so the window is
  filled. If a source still returns fewer items than requested, the report and
  UI state the source short page with requested/scanned/available counts instead
  of leaving "indexed" ambiguous.

Verified with the packaged Electron app: control I asserts exactly one
`plan.create`, a ready plan and no `Another plan.create` text; control J runs
a NASA-shaped short-page fixture and asserts three indexed posts from one
`per_page=100` request.

## 0.8.0 alpha.13

Bounded source discovery for very large sites. The wizard now defaults to
**Quick scan — selected batch** and fetches one bounded content page (maximum
100 items) plus only the taxonomy terms and media records those items
reference. It never enumerates the whole media library, every term or all
history before a small import. **Full site inventory** remains available as an
explicit, confirmed choice.

- **Bounded discovery:** a three-post quick scan is about six REST requests on
a 35,600-post / 250,279-media / 2,094-term source. Full inventory is ~2,892
pages and stays explicitly resumable at term/asset/content page boundaries.
- **Continue no longer starts a crawl:** it shows the mode, item limit,
filters and worst-case page count and requires confirmation. Full inventory
requires a separate acknowledgement checkbox.
- **Pause / resume / cancel:** separate controls. Pause aborts at a safe
boundary and keeps the checkpoint; resume reuses the same batch without
re-fetching completed pages; cancel keeps the project, imports and verified
assets. A single-flight guard refuses overlapping discovery runs.
- **Recovery correctness:** startup reconciles checkpoint files that still say
`running` against the run ledger, so terminal runs are not offered for resume.
Legacy checkpoints without durable batch state are refused instead of silently
repeating a huge crawl.
- **Progress:** phase, mode, items scanned/requested, API pages, media
dependencies, referenced terms, bytes transferred and the last checkpoint are
reported from real counters; no percentage is invented for an unknown total.

See [BOUNDED-SOURCE-SCANS.md](BOUNDED-SOURCE-SCANS.md).

## 0.8.0 alpha.12

Follow-up to the owner's diagnostics for the blank window. The handoff
directory is generated by "Generate handoff package"; the Publisher ZIP is a
separate export step and lands in `<workspace>/exports/`, never inside the
handoff directory. Desktop 0.8.0-alpha.12 adds a **Package existing handoff
(.zip)** recovery action for users who already have a complete handoff
directory without a ZIP. It packages the existing bytes only: no regeneration,
no duplicate identities, deterministic ZIP.

The packaged-Electron acceptance test now reproduces the owner's shape (29
resources, 19 media, ~8.7 MiB), verifies every payload hash in the handoff
directory, exports the ZIP, deletes the ZIP, restarts the app, packages the
existing handoff and requires byte-identical ZIP output.

## 0.8.0 alpha.11

Desktop acceptance fix release after the first real MX Linux test of the
installed `.deb`. The desktop component changes; the Publisher (0.8.0-alpha.2)
and CMS (0.8.0-alpha.8) components are unchanged and keep their artifacts.

- **BUG-001:** an existing project could not be saved between wizard steps
  ("persisted value type is not allowed.") because the autosave stored an
  `undefined` discovery value and the IPC validator rejected undefined. The
  validator now follows JSON semantics and wizard schema v3 migrates legacy
  scalar types in place. No project data is deleted.
- **BUG-002:** "Generate handoff package" appeared to blank the window. The
  handoff had been written and validated; the resource table then dereferenced
  a missing `status` and React unmounted the tree. Resources now accept
  `status` or `state`, a top-level error boundary keeps a recovery screen,
  renderer failures are logged redacted, and preparation shows real phases and
  counts.
- **AUDIT-001:** unreferenced WordPress media-library attachments no longer
  become required media dependencies. A 600-attachment fixture used to need
  601+ files; it now needs only the 3 displayed images. Opt-in remains in
  Advanced settings.
- UX: honest progress bars, batch-size and selected/scanned/discovered
  explanations, simpler auth and advanced configuration, persisted
  90/100/115/130/150% text size, custom Qortal node configuration with a
  read-only connectivity test, and human-readable skipped-content-type
  reporting.

See [ACCEPTANCE-FIXES-0.8.0-ALPHA.md](ACCEPTANCE-FIXES-0.8.0-ALPHA.md) for
root causes, evidence and limitations.

## 0.8.0 alpha.10

This unsigned alpha prerelease supersedes v0.8.0-alpha.9. It adds optional
featured images to the Generic CMS editor and hardens the slug fix so a stale
deployment cannot silently reproduce the one-character slug.

### Featured images

Every CMS-authored and WordPress-imported post/page now has an optional
featured-image field: select an existing QDN image, upload a local image,
preview it, replace it or remove it, and see exactly which image will be used
before publishing. Resolution is deterministic: explicit selection, then a
preserved WordPress featured image, then the first suitable image in the post
body, then none. Tracking pixels, spacer pixels, icons, SVG placeholders,
video thumbnails, data:/blob: URLs and broken references are skipped. The
chosen image is persisted in the native index, the qms-qdn-content@1
media.featured document and the WordPress edit overlay; identical bytes are
reused from QDN; a new local image joins the owner-guarded fee, collision and
read-back plan (four resources). The image renders on home cards, post lists,
post detail and search results. Imported WordPress resources are never
modified.

### Slug robustness and stale deployments

The live WEBSITE developer iffi served assets/index-boCGirRd.js with build
marker 0.8.0-alpha.5, which still contained the old one-time latch
slug: o.slug || dt(value). The current build produced
assets/index-DO0Igp7n.js at 0.8.0-alpha.7 baseline. The live native index
therefore contained one published item with slug t (Teine postitus) created by
the stale bundle; none of the five imported posts had a truncated slug.

This release makes the state visible and prevents a repeat in the new build:
the Admin toolbar and footer show the template version, and Admin states that
an older version means a stale Q-App/WEBSITE bundle. Save draft and Publish
refuse an untouched one-character automatic slug derived from a longer title,
while legitimate short titles, manually chosen slugs and locked published
slugs remain valid. Existing published slugs are never renamed automatically.

Also fixed: the media-map normalizer treated an array under entries as an
object, producing the URL "0" for catalog media.

Desktop is 0.8.0-alpha.10 (rebuilt with CMS 0.8.0-alpha.8), CMS is
0.8.0-alpha.8, and Publisher stays 0.8.0-alpha.2 with byte-identical bytes.

| Component | Version | Artifact |
| --- | --- | --- |
| Desktop (Linux amd64) | 0.8.0-alpha.10 | qortal-migration-studio_0.8.0-alpha.10_amd64.deb |
| Migration Publisher (Q-App) | 0.8.0-alpha.2 | qortal-migration-publisher-v0.8.0-alpha.2.zip |
| Generic CMS (Q-App) | 0.8.0-alpha.8 | qortal-migration-generic-cms-v0.8.0-alpha.8.zip |

## 0.8.0 alpha.9 — previous

This unsigned alpha prerelease supersedes `v0.8.0-alpha.8`. It corrects two
defects found while verifying alpha.8.

1. **Fee quote.** Both editing paths write three resources (content, native
   index or edit overlay, search index), but alpha.8 quoted four. The label now
   matches the actual signatures. Hub still shows the final fee before signing.
2. **Accept upstream search cleanup.** Removing a local edit removed the overlay
   entry but left the local search entry, so search could keep the old local
   title. Accepting upstream now also removes that CMS search entry and verifies
   the write.
3. **Deep links** to published CMS items (`#/admin/editor/<id>`) open the item
   again.

Everything else from 0.8.0-alpha.8 is unchanged: complete-title slug generation
with Estonian/Unicode transliteration, published-slug locking with aliases,
conflict-aware editing of WordPress-imported posts, gallery caption/alt/order
editing, draft/preview/cancel states and unsaved-change guards.

Desktop is 0.8.0-alpha.9 (rebuilt with CMS 0.8.0-alpha.7), CMS is
0.8.0-alpha.7, and Publisher stays 0.8.0-alpha.2 with byte-identical bytes.

| Component | Version | Artifact |
| --- | --- | --- |
| Desktop (Linux amd64) | 0.8.0-alpha.9 | `qortal-migration-studio_0.8.0-alpha.9_amd64.deb` |
| Migration Publisher (Q-App) | 0.8.0-alpha.2 | `qortal-migration-publisher-v0.8.0-alpha.2.zip` |
| Generic CMS (Q-App) | 0.8.0-alpha.7 | `qortal-migration-generic-cms-v0.8.0-alpha.7.zip` |

## 0.8.0 alpha.8 — previous

This unsigned alpha prerelease supersedes `v0.8.0-alpha.7`. It makes the Generic
CMS a real editor for every catalog item and fixes the live slug defect that
produced one-character slugs.

### Slug fix (root cause)

Typing `Teine test post` produced the slug `t`. The title handler used
`slug: draft.slug || slugify(event.target.value)`: the first keystroke created
`t`, which was then truthy forever, so the fallback never ran again. The same
one-time latch existed in the gallery editor, and the slug field called
`slugify()` on every keystroke, making hyphens untypeable.

The editor now uses a pure reducer that regenerates the slug from the complete
title on every change while the slug is untouched, stops at the first manual
edit, offers **Regenerate slug**, shows the final slug before publish and locks
published slugs. Estonian and other Latin diacritics are transliterated
consistently (`Põhja-Tallinn õäöüšž` → `pohja-tallinn-oaousz`); empty or
invalid slugs are rejected. Duplicate titles get deterministic suffixes across
imported and CMS-authored content. Changing a published slug is an explicit
advanced action that preserves the old URL as an alias and keeps the old QDN
resource. See `docs/migration-studio/CMS-EDITING-AND-SLUGS.md`.

### Editing imported WordPress posts

Imported posts and pages now have a real Edit action. Edits are published to a
new versioned `qms-cms-edit-overlay@1` document plus a CMS-owned
`qms-qdn-content@1` resource. The imported manifest, indexes, content and
original URL metadata are never modified. An unchanged WordPress source never
erases local edits; a changed source shows a conflict with **Keep my edits** and
**Accept upstream**. Incremental sync and catalog rebuilds preserve the overlay.
The editor also reports local draft, modified-unpublished, awaiting approval,
pending confirmation, published+verified, partial and ambiguous states
explicitly; a local draft is never called published.

### Also in this release

- Gallery editing: title, description, per-image caption and alt text, image
  order and membership, with duplicate-safe slugs.
- Unsaved-change guards in the post/page editor and site settings; site
  settings can be reverted to the last published values.
- Slug health report detects suspicious one-character drafts and published
  items. It never renames published resources automatically.

Desktop is 0.8.0-alpha.8 (rebuilt with CMS 0.8.0-alpha.6), CMS is
0.8.0-alpha.6, and Publisher stays 0.8.0-alpha.2 with byte-identical bytes.

| Component | Version | Artifact |
| --- | --- | --- |
| Desktop (Linux amd64) | 0.8.0-alpha.8 | `qortal-migration-studio_0.8.0-alpha.8_amd64.deb` |
| Migration Publisher (Q-App) | 0.8.0-alpha.2 | `qortal-migration-publisher-v0.8.0-alpha.2.zip` |
| Generic CMS (Q-App) | 0.8.0-alpha.6 | `qortal-migration-generic-cms-v0.8.0-alpha.6.zip` |

## 0.8.0 alpha.7 — previous

This unsigned alpha prerelease supersedes `v0.8.0-alpha.6`. It contains one CMS
correction: the pre-publication fee quote now counts three resources (content,
native catalog index and search index) instead of two. Hub has always shown the
final fee before signing; this makes the QMS label accurate.

Desktop is 0.8.0-alpha.7 (rebuilt with the corrected CMS), CMS is
0.8.0-alpha.5, and Publisher stays 0.8.0-alpha.2 with byte-identical bytes. All
publishing, link, search, attribution and notification behaviour from alpha.6 is
unchanged.

| Component | Version | Artifact |
| --- | --- | --- |
| Desktop (Linux amd64) | 0.8.0-alpha.7 | `qortal-migration-studio_0.8.0-alpha.7_amd64.deb` |
| Migration Publisher (Q-App) | 0.8.0-alpha.2 | `qortal-migration-publisher-v0.8.0-alpha.2.zip` |
| Generic CMS (Q-App) | 0.8.0-alpha.5 | `qortal-migration-generic-cms-v0.8.0-alpha.5.zip` |

## 0.8.0 alpha.6 — previous

This is an unsigned alpha prerelease. It supersedes `v0.8.0-alpha.5` and fixes
the live Generic CMS defect where a CMS-authored post was published but never
appeared publicly. It also adds first-class qortal:// links, https copy-with-badge
behaviour, live full-text search and the footer/header attribution fixes.

### Why the CMS post disappeared

The editor created every draft with `status: 'draft'` and published that value
into `qms-cms-native-index`. Catalog merging still merged the native term
definitions, so categories and tags appeared, but `publishedPosts()` filtered the
entry out of Posts, Latest posts, term pages and the detail route. The editor now
publishes with `status: 'published'` and records an explicit state machine:
draft → pending-approval → pending-confirmation → published, with partial,
failed and ambiguous kept distinct. A verified post whose search-index write is
not confirmed is reported as partial, never as full success.

### Added and fixed

- **qortal:// links** are accepted by the editor, preserved byte-for-byte by the
  sanitizer (including `developer%20iffi` encodings) and opened through the Hub
  `OPEN_NEW_TAB` bridge. Outside Hub the page copies the link and explains why.
- **https links copy instead of navigating**, show `Link copied.` next to the
  clicked link for about 2 seconds and show an explicit error when clipboard
  access fails. Mouse, touch and keyboard (Enter/Space) work.
- **Full-text search** searches titles, excerpts and bodies through a versioned
  `qms-cms-search-index@1`. CMS publishing and QMS imports both write it. The UI
  debounces input (220 ms), caches the index, highlights terms with safe text
  nodes and handles missing/stale indexes honestly.
- **Footer attribution** now reads **Qortal Migration Studio CMS**, links to
  `qortal://WEBSITE/Qortal%20Web%20Builders/` and no longer renders a
  `QDN name:` label. Owner footer text stays separate.
- **Header branding**: the hardcoded `Qortal QDN publication` eyebrow is removed.

Nothing is signed or published to QDN by this release.

### Components

| Component | Version | Artifact |
| --- | --- | --- |
| Desktop (Linux amd64) | 0.8.0-alpha.6 | `qortal-migration-studio_0.8.0-alpha.6_amd64.deb` |
| Migration Publisher (Q-App) | 0.8.0-alpha.2 | `qortal-migration-publisher-v0.8.0-alpha.2.zip` |
| Generic CMS (Q-App) | 0.8.0-alpha.4 | `qortal-migration-generic-cms-v0.8.0-alpha.4.zip` |

The Publisher sources are unchanged; its ZIP is byte-identical to
0.8.0-alpha.2. Desktop is rebuilt because it bundles the CMS template. The CMS
ZIP changes to 0.8.0-alpha.4.

```bash
sudo apt install ./qortal-migration-studio_0.8.0-alpha.6_amd64.deb
dpkg-query -W -f='${Version}\n' qortal-migration-studio
# expected: 0.8.0~alpha.6
```

## 0.8.0 alpha.5 — previous

This is an unsigned alpha prerelease. It supersedes `v0.8.0-alpha.4` and fixes
two blocking defects found in the first real graphical test on MX Linux, plus
the date-filter, capability-rendering and destination-safety defects that
surfaced with them.

### What was broken

1. **Wizard state validation blocked every save.** The renderer persisted
   `completedSteps` as numeric indexes, while desktop IPC validation required
   strings. The wizard showed a permanent red banner:
   `wizard.completedSteps[0] must be a string.`
2. **The wizard never ran source discovery.** It tested the WordPress
   connection, then called `plan.create` against an empty index. Planning failed
   with `SOURCE_DISCOVERY_REQUIRED` and the UI reduced it to "The plan did not
   become ready".
3. **Date filters could silently exclude everything.** The `before` date was
   serialized as the start of the selected day, so the whole final day was
   outside the range. Nothing explained an empty result.
4. **Unsupported capabilities rendered as `[object Object]`.** The connection
   report's `unsupported` array was iterated as an object.
5. **Empty plans could be approved**, advancing the wizard with zero selected
   items.

### What changed

- **Canonical step ids with a real migration.** `completedSteps` now stores
  `source | connection | destination | preferences | plan`. Existing numeric
  arrays (and mixed arrays) are mapped on load, deduplicated, sorted and saved
  once as `wizardVersion: 2`. The migration is idempotent and preserves every
  setting. Existing projects do not need to be deleted or recreated.
- **The wizard discovers the source.** Step 4 has an explicit scan action and
  Continue/Plan preview runs discovery automatically when no completed batch
  exists. Progress is streamed from engine events.
- **Plan failures are visible.** The UI shows the engine error code, message and
  technical details, and disables approval when no ready, non-empty plan exists.
- **Empty plans explain themselves.** The engine records per-filter exclusion
  counts and the UI shows the applied range plus how many items were excluded
  by content type, missing dates or the lower/upper published bound.
- **Date ranges are inclusive and explicit.** `before` is stored as
  `23:59:59.999Z`; the applied range is displayed in UTC. Legacy midnight end
  dates are migrated once to the end of that day.
- **Media sizes recover from HEAD-unsupported servers.** When HEAD is rejected
  or omits `Content-Length`, media estimation sends a one-byte ranged GET and
  reads the total from `Content-Range`. Unknown sizes remain explicitly
  unknown; they are never treated as zero.
- **Capabilities are readable.** Unsupported features render as names,
  descriptions and counts; no renderer path stringifies a capability object.
- **APP vs WEBSITE safety.** The destination step explains that APP and WEBSITE
  are separate deployments under one name, that switching service creates a
  second deployment, and that QMS never overwrites a different identifier. The
  Publishing view repeats the warning before preparing a handoff.
- **Packaged-engine vertical proof.** `release:engine-wizard` extracts the
  built .deb and drives `project.create → source.discover → plan.create` over
  the same stdio JSON-RPC surface the desktop uses.

No signing, wallet, broker or QDN transaction behavior changed. Nothing is
published to QDN by this release.

### Components

| Component | Version | Artifact |
| --- | --- | --- |
| Desktop (Linux amd64) | 0.8.0-alpha.5 | `qortal-migration-studio_0.8.0-alpha.5_amd64.deb` |
| Migration Publisher (Q-App) | 0.8.0-alpha.2 | `qortal-migration-publisher-v0.8.0-alpha.2.zip` |
| Generic CMS (Q-App) | 0.8.0-alpha.3 | `qortal-migration-generic-cms-v0.8.0-alpha.3.zip` |

The Publisher and Generic CMS sources did not change in alpha.5. Their artifacts
were byte-identical to the alpha.4 release; only the desktop package version moved.

### Upgrade an existing installation

~~~bash
sudo apt install ./qortal-migration-studio_0.8.0-alpha.5_amd64.deb
~~~

Open the existing project normally. QMS migrates the wizard record on load; do
not delete the project or its workspace. Projects, media, handoffs and history
under `~/.local/share/qortal-migration-studio` are preserved.

Confirm the installed version:

~~~bash
dpkg-query -W -f='${Version}\n' qortal-migration-studio
# expected: 0.8.0~alpha.5 (alpha.6 installs as 0.8.0~alpha.6)
~~~

## 0.8.0 alpha.4 — previous

The 0.8.0-alpha.3 release fixed a live Generic CMS owner Admin regression in
Qortal Hub on Android. Its desktop .deb is affected by the engine dependency
defect above; use 0.8.0-alpha.5 instead.

The CMS now reads the on-chain name record from the node that serves the page.
A build-time `http://localhost:12391` default made Android devices query their
own loopback, fail the ownership check and hide Admin from the real owner. The
CMS also adds **Connect owner account** and **Retry verification** recovery
actions. They re-run the complete fail-closed check; they never grant owner mode
themselves.

The component versions in that release were desktop 0.8.0-alpha.3, Publisher
0.8.0-alpha.2 and CMS 0.8.0-alpha.3.

## Registry publication status

The update registry document is regenerated for this release but is intentionally
**not** published by this GitHub release. Publishing it requires a separate
owner-approved QDN transaction. Until that transaction is approved, the
applications report that updates cannot be checked and continue to work normally.
See `docs/migration-studio/UPDATE-REGISTRY.md`.

## Install

### Desktop (Debian 12/13, MX Linux 23)

```bash
sha256sum qortal-migration-studio_0.8.0-alpha.10_amd64.deb
sudo apt install ./qortal-migration-studio_0.8.0-alpha.10_amd64.deb
```

Verify the hash against the release assets. The package is unsigned.

### Migration Publisher

Download `qortal-migration-publisher-v0.8.0-alpha.2.zip`, verify its SHA-256,
and republish it as an APP under your own Qortal name. Downloading the ZIP is not
publishing it to QDN. The Publisher artifact is unchanged in this release.

### Generic CMS

Download `qortal-migration-generic-cms-v0.8.0-alpha.8.zip`, verify its SHA-256,
and republish the APP or WEBSITE under the site's existing Qortal name. Preserve
`qms-cms-config.json` and any custom assets; do not overwrite a customized CMS
with the generic ZIP. The site must show `Template v0.8.0-alpha.8` in the footer
and Admin; if it shows an older version, the deployed bundle is stale. After
deployment, open the site in Qortal Hub and use **Connect owner account** if
Admin is still not shown.

## Known limitations

- The desktop package is unsigned.
- No automatic updater is provided for any component. Every update is a manual,
  owner-approved deployment.
- Qortal Hub may block external HTTPS tabs. The update views always show a
  copyable release URL as the fallback.
- The registry is published only after the owner approves the Publisher handoff.
  A GitHub release alone never advertises an update.
- Engine dependency completeness is verified on the build host from an extracted
  .deb. The gate does not install the .deb into a full graphical MX Linux
  desktop session; the isolated Debian rootfs install test remains separate.

## Verification

All artifacts are covered by `SHA256SUMS`; the SBOM and provenance files record
the shipped components and the source commit. Release publication downloads every
asset without authentication and rechecks its exact size and SHA-256.
