# Changelog

All release-facing changes to Qortal Migration Studio are recorded here. The
release contract requires a heading entry for the exact released version before
an artifact may be published.

## Generic CMS 0.8.0-beta.5 — 2026-11-18

Component-only Generic CMS release. Desktop and Migration Publisher remain
**0.8.0-beta.1**; the QMS bundle tag remains **v0.8.0-beta.3**. Restores the
real-time publishing progress lines; replaces the Subwire backlink with plain
text plus the full visible CMS URL (no `?identifier=` query); keeps APP/WEBSITE
article links dynamic with the trailing slash; and verifies large VIDEO
resources only after READY/DOWNLOADED while reporting propagation as partial,
never ambiguous, and never resending a pending write. Includes the accepted
Android attachment, community-chat, owner-update, taxonomy and tagline fixes.
No GitHub release or QDN publication is part of this handoff.

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
