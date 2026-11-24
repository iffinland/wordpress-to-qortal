# Changelog


## Generic CMS 0.9.0-beta.4 — 2026-11-24

- Resolve captured video bytes before rewriting Q-Tube identifiers; include each file once in the same approved publication batch.
- Save attachment Blobs and posters in owner/deployment-scoped IndexedDB, restore them with local drafts, and warn when storage is unavailable or full.
- Check all attachments before approval; support remote attachments, changing posters without the original video and adopting existing QDN videos into Q-Tube with verified downloads.
- Preserve the publication timestamp across failed/unconfirmed retries. Stream hash verification for fixed Q-Tube video coordinates instead of accepting an older READY video.
- Deduplicate repeated attachment nodes, keep captures after cancelled/failed attempts, and refuse silent loss of a missing local featured image.
- Owner runtime test passed for RC.1. Publish the byte-identical accepted ZIP as CMS 0.9.0-beta.4; no tests are repeated during finalization. Publisher and Desktop DEB are unchanged.


## Generic CMS 0.9.0-beta.3 — 2026-11-23

- RC.2: explicitly request `mode=ALL` on direct and Hub metadata search; avoid hiding older import catalogs behind newer settings documents. Reproduced against the reported owner's public QDN metadata; add default-mode-collapse and Hub-fallback regression tests.
- Discover owner-published import catalogs without a bundled project configuration; support CMS-before-import and import-before-CMS deployment.
- Share content connections across APP and WEBSITE under the same Qortal name and deployment identifier. Never guess between several imported projects.
- Add owner-only Content connection selection and refresh, with an optional public `qms-cms-connection@1` document and exact read-back verification.
- Preserve CMS-first native posts when an import is connected; retain imported text/image edits through the existing overlay contract. Keep custom-template visual defaults separate from content binding.
- Fix empty-tagline configuration validation and remount the editor when the connected site changes.
- Owner runtime test passed for RC.2. Publish its byte-identical ZIP as the independent CMS 0.9.0-beta.3 release. Publisher and Desktop DEB are unchanged.

## Publisher 0.8.0-beta.2 — 2026-11-23

- Automatic active-account and package-name ownership checks; refresh before signing.
- Modern responsive publication workspace with scrolling resource panel, search, filters, bounded rendering and expandable technical details.
- Transitive dependency selection and safe ordering; pending-upload protection persists across repeated attempts and recovery.
- Honest first-run upload/verification summaries, read-only reconciliation, separate receipt timestamps, locked in-progress controls and reset approvals.
- Structured partial Hub responses, exact remote checks and size-aware confirmation waits.
- ZIP metadata limits before decompression, nested CMS compatibility and worker-based import.
- Grouped Hub requests retain the 20-resource cap and dependency boundaries. Hub controls session permissions; a single window for every package is not promised.
- Owner runtime test passed for RC.1. Publish the byte-identical accepted ZIP as `publisher-v0.8.0-beta.2`; Desktop DEB and CMS remain unchanged, with strict component checks and public download verification.


## Generic CMS 0.9.0-beta.2 — 2026-11-23

Publish the runtime-accepted post quick actions in all eight templates: QDN likes with one resource per name and post, canonical link copying and on-demand plain-text comments with author editing. Preserve failed drafts and retry identities, validate resource authors and isolate site/post scopes. Add a CMS-only publication workflow with immutable assets and public checksum verification. Desktop 0.8.0-beta.2 and Publisher 0.8.0-beta.1 remain unchanged at v0.8.0-beta.4.

## 0.8.0-beta.4 — Desktop 0.8.0-beta.2 — 2026-11-23

Publish the runtime-accepted guided Desktop beta.2 from clean committed source, with verified DEB downloads, checksums and release evidence. Publisher 0.8.0-beta.1 and Generic CMS 0.9.0-beta.1 are reused byte-identically. Add a GitHub Actions publication workflow, keeping all existing release gates blocking. Preserve typed errors across Electron context isolation so stale project locks offer recovery after restart.

## Desktop 0.8.0-beta.2 — runtime accepted 2026-11-23 (unpublished package)

- Add a guided URL-first workflow with durable local preparation, automatic ZIP export and publication receipt verification.
- Continue larger selections in publication-safe groups and retain existing project identities.
- Add text/picture previews, download controls, project backup/restore, accessible small-screen layout and in-app help.
- Repair pause/cancel controls, preview invalidation, approved plan persistence, node configuration and credential timeouts.
- Stream ZIP export, bound QDN response reads, and update Electron/build tooling.
- Repair DEB component-version handling and explicitly separate unpublished test builds from public release documentation.
- Owner runtime test passed on 2026-11-23; main integration and GitHub follow-up are approved. The accepted DEB remains byte-identical; public download links are updated only after release publication and hash verification.



All release-facing changes to Qortal Migration Studio are recorded here. The
release contract requires a heading entry for the exact released version before
an artifact may be published.

## Generic CMS 0.9.0-beta.1 — 2026-11-18

Generic CMS template-system source and handoff release. Desktop and Migration
Publisher remain **0.8.0-beta.1**; their code and artifacts are unchanged. This
entry records the approved CMS template developments; no GitHub release, tag or
QDN publication is created by it.

The CMS now has a reusable presentation registry with eight selectable templates:
**Default** (the original appearance), **Magazine / News**, **Portfolio**,
**Documentation / Knowledge Base**, **Photography / Gallery**, **Business /
Services**, **Video / Media** and **Personal Journal**. Owners choose the template
in **Admin → Site settings → Appearance**; switching templates preserves posts,
pages, media, links, navigation and all publishing behaviour. CMS data,
sanitization, search, owner verification and publication stay in the shared core.

Verification for this source state: 44 template test files / 420 tests passed,
typecheck passed, and the root-layout Q-App bundle validator passed (7 files).

## 0.8.0-beta.3 — 2026-11-17

Generic CMS **0.8.0-beta.4** artifact release. Desktop and Publisher remain **0.8.0-beta.1**. Adds an optional
Qortal community-chat navigation destination using the documented
`qortal://use-group/action-join/groupid-127` Hub link with a copyable fallback;
a compact accessible Back to Top control; owner-only deletion of CMS-authored
posts with explicit confirmation, stable-identifier tombstone, index/search/
sections cleanup and honest non-erasure wording; taxonomy suggestions while
editing and owner-side category/tag rename and delete for CMS-authored content;
the configured tagline in the compact mobile header; and a post-editor author
default from the configured public author with preserved overrides. Desktop and
Publisher are unchanged. No tag, release or QDN publication accompanies this
entry.

## 0.8.0-beta.3 (previous code release) — 2026-11-17

Generic CMS **0.8.0-beta.3** source release. Desktop and Migration Publisher
remain **0.8.0-beta.1**; their artifacts are unchanged. The QMS bundle version
and tag remain **0.8.0-beta.2**. Adds the hamburger header and menu reorder,
subpages/sections, one combined Hub confirmation, lazy admin chunk, text colors,
attachments with text/PDF preview, optional Q-Tube/SubWire/Quitter
cross-publication (public and permanent content, Markdown losses, WebP cover,
Q-Tube video once), and per-account isolation of local drafts. Known limitations
are listed in `RELEASE-0.8.0-BETA.3.md`. The three-artifact gate was not run for
this code release because the unchanged desktop beta.1 evidence files are not in
this checkout.

## 0.8.0-beta.2 — 2026-11-15

Generic CMS **0.8.0-beta.2**. Desktop and Migration Publisher remain
**0.8.0-beta.1** (unchanged). This release includes the approved cumulative CMS
fixes: Android featured-image publication (BUG-01), native catalog loading and
duplicate homepage title removal (BUG-02), canonical/legacy native-index
identity and public navigation during catalog errors (BUG-03), removal of
non-blocking public warning banners (BUG-04), and removal of the unused
Adoption interface from Admin Overview. Existing browser-local adoption records
and QDN content are untouched.

Release assets and hashes are published with tag `v0.8.0-beta.2`.

## 0.8.0-beta.1 — 2026-11-11

Public unsigned beta release. Qortal Migration Studio Desktop, Migration
Publisher and Generic CMS are each versioned `0.8.0-beta.1`. This delivery
does not alter product behavior, interfaces, data contracts, or QDN workflow;
it publishes refreshed package identities and separate practical end-user
manuals for the Desktop, Publisher and Generic CMS.

## 0.8.0-rc.7 — 2026-11-11

Unsigned amd64 release candidate. Imported WordPress post cards now project a
verified QDN image into the shared Generic CMS posts index: the explicit
WordPress featured image wins, otherwise the first resolved article-body image
is used, otherwise the card has no image. The index never falls back to an
external source URL and does not create another media resource. This shared
index drives both the Home and Posts card surfaces.

Desktop/engine is `0.8.0-rc.7`; the bundled Migration Publisher remains
`0.8.0-alpha.3` and Generic CMS remains `0.8.0-alpha.10`. Exact release asset
hashes, provenance and SBOM are published with tag `v0.8.0-rc.7`.

## 0.8.0-rc.2 — 2026-11-08

Private unsigned release candidate. Fixes:

- **BUG-005 plan race:** entering Plan Review from Import preferences now runs a
  single-flight `plan.create` preview with a request epoch. One trigger produces
  one run, and a successful preview clears any stale planning error.
- **NASA quick-scan undercount:** a quick scan requests one full 100-row REST
  page while indexing only the requested window. Sources with short REST pages
  no longer look like local index loss; a genuine short page is reported as
  `SOURCE_UNDER_RETURNED` with requested/scanned/available counts.
- **BUG-004 IPC allowlist:** the shared IPC validator preserves the explicit
  scan mode, bounded selection, `includeTerms`, `includeAssets` and
  `progressEvery` fields instead of silently dropping them.

Documentation and evidence: packaged controls A–J and the H handoff gate passed
against `qortal-migration-studio_0.8.0-rc.2_amd64.deb` (SHA-256
`344941454765132e99331818e1043594d2cf5ad9d220490de96459a3f2693cd7`), built from
commit `2c61ba7b80b0cbf6d3d90f274346b93c78e90c13`.

## 0.8.0-rc.1 — 2026-11-08

Private unsigned acceptance candidate. Fixed the source-scan IPC allowlist
(BUG-004) so Quick scan and Full inventory can start, and rebuilt the Debian
package. Superseded by rc.2.

## 0.8.0-alpha.13 — 2026-11-08

Private alpha. Bounded discovery, packaged functional acceptance, Publisher
handoff/receipt verification, generic CMS featured images and slug integrity.

## 0.8.0-alpha.12 and earlier

See the release notes under `docs/migration-studio/` and the corresponding
GitHub prereleases.
