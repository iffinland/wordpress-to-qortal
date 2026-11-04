# Phase 6 — Generic CMS and site template

| Field | Value |
| --- | --- |
| Document | Generic Qortal CMS/site template, catalog compatibility and acceptance evidence |
| Date | 2026-11-04 |
| Status | **IMPLEMENTED AND VERIFIED.** All AC6.1–AC6.8 have fixture, contract, integration or build evidence. No live QDN publish was performed. |
| Template path | templates/generic-cms |
| Base commit | 74b67454ce476d16e73935f5c0d2939cdb450c08 |
| Scope | Neutral CMS template, manifest compatibility, sanitized rendering, owner gating, accessibility, Q-App build |

## 1. Result in one paragraph

Phase 6 adds a standalone, neutral Qortal CMS at templates/generic-cms. It builds
a real React/Vite site with configurable title, tagline, navigation, colors and
typography; routes for home, posts, post, page, category, tag, archive, search
and admin/import; an honest catalog state machine; DOMPurify-based HTML and URL
sanitization; owner-only import/adoption gating based on verified QDN name
ownership; and an accessible, responsive default design. One read-only adapter
reads qms-cms-manifest@1, the Phase 5 qms-qdn-manifest@1 output, and the legacy
cr-qdn-manifest shape without rewriting resources. The production build is a
valid root-layout Q-App bundle with relative assets and no engine imports.

The Corbett Report clone is unchanged. Its golden conversion and route-rewriting
fixtures still pass, its branding and cr-* identifiers are pinned by regression
tests, its import/adoption UI markers are checked, and its production build
succeeds.

## 2. Implemented components

| Component | Path | Purpose |
| --- | --- | --- |
| Template config | templates/generic-cms/cms.config.json | Site identity, navigation, colors, typography and content identifiers |
| Config validator | templates/generic-cms/src/lib/config.js | Build-time and unit-tested validation, CSS variable mapping |
| Manifest adapter | templates/generic-cms/src/lib/manifest.js | qms-cms-manifest@1, qms-qdn-manifest@1 and cr-qdn-manifest normalization |
| Repository | templates/generic-cms/src/lib/repository.js | QDN/fixture reads, cache fallback, content loading |
| Sanitizer | templates/generic-cms/src/lib/sanitize.js | DOMPurify allowlist plus URL and post-processing policy |
| Media rewriter | templates/generic-cms/src/lib/media.js | Source URLs to QDN resource URLs before rendering |
| Ownership | templates/generic-cms/src/lib/ownership.js | Current-account name ownership and optional chain-record cross-check |
| Adoption | templates/generic-cms/src/lib/adoption.js | Owner-only local import/adoption queue |
| Routes | templates/generic-cms/src/lib/routes.js | Hash routes and href helpers |
| UI | templates/generic-cms/src | Layout, pages, state notices, accessible styles |
| Build | templates/generic-cms/scripts/build-template.mjs | Typecheck, Vite build, bundle validation and ZIP packaging |
| Fixtures | templates/generic-cms/fixtures | Generic, Phase 5 engine and legacy Corbett catalogs |

The template does not import lib/engine, lib/source, the Corbett CMS or any Node
module from browser source. The boundary is enforced by
test/phase6/engine-boundary.test.js and by the bundle validator.

## 3. Manifest compatibility

### 3.1 Supported shapes

| Shape | Detection | Use |
| --- | --- | --- |
| qms-cms-manifest@1 | schema equals qms-cms-manifest@1 | Generic CMS catalog with site metadata and named entrypoints |
| qms-qdn-manifest@1 | schema equals qms-qdn-manifest@1 | Phase 5 exact publication output |
| cr-qdn-manifest | profile_id, identifiers or posts_index entrypoint | Legacy Corbett-compatible catalog |

The adapter is read-only. It resolves entrypoints and content references but
never rewrites identifiers, resources or URLs. Legacy items preserve source_id,
old_url, file and public_author metadata.

### 3.2 Generic catalog shape

A minimal qms-cms-manifest@1 document is:

~~~json
{
  "schema": "qms-cms-manifest@1",
  "version": 1,
  "generated_at": "2026-10-30T12:00:00.000Z",
  "site": {
    "id": "site-example",
    "title": "Example Site",
    "tagline": "Independent publishing",
    "owner_name": "ExampleName",
    "public_author": "Example Editor"
  },
  "entrypoints": {
    "posts": { "service": "DOCUMENT", "name": "ExampleName", "identifier": "example-posts" },
    "pages": { "service": "DOCUMENT", "name": "ExampleName", "identifier": "example-pages" },
    "categories": { "service": "DOCUMENT", "name": "ExampleName", "identifier": "example-categories" },
    "tags": { "service": "DOCUMENT", "name": "ExampleName", "identifier": "example-tags" }
  },
  "resources": {
    "by_identifier": {
      "example-posts": { "service": "DOCUMENT", "name": "ExampleName", "identifier": "example-posts" }
    }
  },
  "counts": { "posts": 12, "pages": 3, "categories": 4, "tags": 9 }
}
~~~

Index payloads use entries with id, type, title, slug, status, excerpt,
category_ids, tag_ids, dates and a content reference. The adapter also accepts
the Phase 5 index entries and content payloads without conversion.

### 3.3 Legacy Corbett compatibility

fixtures/legacy/cr-qdn-manifest.json mirrors the current cr-qdn-manifest shape.
The Phase 6 test suite proves that:

- The legacy catalog loads with source cr-qdn and the same post/page slugs.
- The legacy content refs remain cr-post-900 and cr-page-901.
- Source IDs, old URLs and category/tag IDs are preserved.
- The Corbett profile title, tagline, sysop names, coauthor names and
  cr-* identifiers are unchanged.
- The legacy golden HTML and route rewriting output remains byte-identical.
- The Corbett CMS import/adoption UI markers and batch limit are still present.
- The Corbett production build succeeds.

## 4. Routes

| Route | Example | Rendering |
| --- | --- | --- |
| Home | #/ | Site title, tagline, latest posts, categories and tags |
| Posts index | #/posts?page=2 | Paginated published posts |
| Post | #/posts/hello-qortal | Exact content resource, author, dates, terms and navigation |
| Page | #/pages/about | Exact content resource |
| Category | #/category/news | Posts for a normalized category term |
| Tag | #/tag/design | Posts for a normalized tag term |
| Archive | #/archive/2024/05 | Year/month archive with pagination |
| Search | #/search?q=design | Title, excerpt, category and tag search |
| Admin/import | #/admin | Catalog inspection, owner status and local adoption queue |
| Not found | any other route | Honest not-found page |

All routes are hash routes because the Q-App is served from a QDN root layout.
Route parsing and href generation are unit-tested, including encoded slugs and
invalid archive months.

## 5. Catalog states

The adapter distinguishes five non-loading states and never renders a failed
index as an empty site.

| State | Meaning | UI behavior |
| --- | --- | --- |
| ready | All required indexes loaded and counts agree | Normal rendering |
| empty | Indexes are readable and contain no published items | Explicit empty message |
| partial | One or more indexes failed, a count mismatched or taxonomy is missing | Warning plus available content; unavailable section says so |
| stale | The manifest generated_at exceeds the configured threshold or cache fallback was used | Warning plus content |
| error | Both core indexes are unavailable and no cache exists | Error message with retry; no empty claim |

Fixtures cover: missing pages index, failing categories index, both core indexes
failing, count mismatch, stale generated_at, explicit empty catalog and cache
fallback.

## 6. Sanitization

The template uses DOMPurify, a maintained library, with an explicit allowlist.
The policy removes scripts, event handlers, style attributes, forms, embedded
objects, SVG/MathML, data attributes and iframes. Links and media URLs are
validated independently:

- Allowed schemes: http, https, mailto, tel, hash, relative paths.
- Blocked schemes include javascript, vbscript, data, file, blob and about.
- Scheme detection removes whitespace and control characters, so obfuscated
  javascript URLs are rejected.
- External links receive rel='noopener noreferrer'.
- Images receive loading='lazy', decoding='async' and an alt attribute.
- Source media URLs are rewritten to QDN resource URLs before sanitization.

test/phase6/sanitize.test.js covers all of these cases.

## 7. Owner mode

Owner mode is not a name string comparison. The template requires:

1. GET_USER_ACCOUNT returns the signed-in account address.
2. GET_ACCOUNT_NAMES returns the configured QDN site name for that address.
3. If GET /names/<name> is reachable, its owner must equal the account address
   and its name must match the configured name.

A missing account, a name not in the account name list, a chain-record mismatch
or an unavailable required record leaves the page read-only. The admin route
shows the verification reason and the name-record status. The adoption functions
also enforce the same guard server-side in the component layer, so disabling
inputs is not the only protection.

test/phase6/ownership.test.js covers owner, non-owner, mismatch, missing-record,
persistence and Corbett identifier preservation cases.

## 8. Accessibility

The default design includes:

- Skip link, header/nav/main/footer landmarks, one h1 per route and ordered
  headings.
- Visible focus outlines, 44px minimum button targets, labelled search and admin
  controls, aria-current navigation state and live status regions.
- Responsive layout at narrow widths, reduced-motion support and forced-colors
  borders.
- No color-only status communication: every notice has a textual title.

The Vitest suite renders six primary flows (home, posts, single post, search,
admin owner, admin read-only) and runs axe-core WCAG 2.0/2.1 A and AA rules
(color-contrast is disabled because jsdom has no layout engine). All six flows
report zero violations. Static assertions also check the skip link, main
landmark, single h1, primary nav label and CSS focus/reduced-motion rules.

## 9. Build and packaging

Commands:

~~~bash
cd templates/generic-cms
npm install
npm run typecheck
npm run test
npm run build
npm run build -- --zip
~~~

Build result:

| Check | Result |
| --- | --- |
| TypeScript | Passed |
| Vite modules | 56 transformed |
| Bundle files | 3 |
| Bundle bytes | 249,312 |
| Root index.html | Present |
| Relative assets | Passed |
| Referenced assets exist | Passed |
| Engine markers | None |
| ZIP root layout | index.html and assets/ at archive root |
| ZIP path | release/qms-generic-cms-template-v0.1.5.zip |

A custom configuration can be supplied with CMS_TEMPLATE_CONFIG or
--config=<path>. The build validates configuration before compiling.

The dev/preview server serves the fixture catalog at /cms-fixture/. A smoke test
against vite preview returned HTTP 200 for both / and
/cms-fixture/qms-cms-manifest.json.

## 10. Acceptance criteria evidence

| Criteria | Evidence | Result |
| --- | --- | --- |
| AC6.1 Configurable neutral site | cms.config.json is valid, contains no Corbett branding, and config tests override title, tagline, navigation and colors; build succeeds with the neutral config | PASS |
| AC6.2 All routes render from a fixture manifest | templates/generic-cms/tests/render.test.tsx renders home, posts, post, page, category, tag, archive, search, admin and not-found from fixtures; route tests cover parsing | PASS |
| AC6.3 Honest loading, empty, partial, stale and error states | test/phase6/manifest.test.js covers all five states, cache fallback and count mismatch; UI notices are rendered per section | PASS |
| AC6.4 Sanitized HTML and URLs | DOMPurify policy plus 8 sanitizer tests covering scripts, handlers, schemes, embeds, styles, external rel and valid QDN URLs | PASS |
| AC6.5 Owner-only administrative actions | ownership and adoption tests cover verified owner, non-owner, chain mismatch and missing record; admin UI is disabled for readers | PASS |
| AC6.6 Corbett compatibility | Six Corbett regression tests cover profile branding, routes, adoption markers, byte-identical rewriting, legacy catalog mapping and cr-* refs; Corbett build succeeds | PASS |
| AC6.7 Valid root-layout Q-App bundle without engine imports | Bundle validator passes root layout, relative assets and engine-marker checks; engine-boundary test scans all browser source; zip root verified | PASS |
| AC6.8 Accessibility tests | Six axe-core WCAG A/AA flows report zero violations; static skip-link, landmark, heading and CSS checks pass | PASS |

## 11. Test and build results

| Suite | Result |
| --- | --- |
| Root node:test suite | 336/336 pass (290 pre-existing + 46 Phase 6) |
| Phase 6 subset | 46/46 pass |
| Template Vitest | 19/19 pass (2 repository, 9 render, 8 accessibility) |
| Template TypeScript | Passed |
| Corbett CMS build | Passed |
| Migration viewer build | Passed |
| Generic template build | Passed |
| Bundle validator | Passed |
| Preview smoke | HTTP 200 root and fixture |
| Q-App ZIP | Valid root layout |

## 12. Limitations and honest boundaries

- No live QDN read of a production catalog was performed in this environment.
  The adapter is proven against fixtures in the exact qms-cms-manifest@1,
  qms-qdn-manifest@1 and cr-qdn-manifest shapes, and against the real Corbett
  profile and golden fixtures. A live read is a deployment check, not a claim of
  this phase.
- No QDN publication, transaction or signing occurred.
- Accessibility evidence is automated axe-core plus static markup/CSS checks in
  jsdom. It is not a manual screen-reader session on macOS, Windows or Android.
- Iframe embeds are stripped rather than rewritten. Imported YouTube/Vimeo
  embeds are lost in the generic template; direct video/audio elements remain.
- Owner mode relies on GET_ACCOUNT_NAMES when GET /names/<name> is unavailable.
  The chain record is a cross-check when reachable, not the only ownership
  signal. A Qortal UI context that blocks both node HTTP access and account
  requests remains read-only.
- The fixture source is a development/preview feature. It is not bundled into
  production assets.
- The admin/import route stages a local adoption queue only. It does not publish,
  sign or rewrite QDN resources.
- Joomla, Wix, Windows, localization and template marketplace work remain out of
  scope.

## 13. Phase 7 readiness

Phase 7 can build on the generic template because:

- The catalog adapter treats manifests and indexes as derived data and exposes
  partial/stale/error states instead of false emptiness.
- Content identity, legacy identifiers and cr-* references remain stable.
- The template does not embed publication logic, so incremental sync,
  withdrawal and conflict decisions stay in the engine.
- The admin/import route already has a read-only catalog view and an
  owner-gated adoption queue that Phase 7 can extend with real sync actions.

Phase 7 still needs the engine-side modified watermark, deletion detection,
withdrawal policy, conflict queue and delta publication. Those are not claimed
by Phase 6.
