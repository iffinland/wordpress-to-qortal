# Changelog

All release-facing changes to Qortal Migration Studio are recorded here. The
release contract requires a heading entry for the exact released version before
an artifact may be published.

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
