# Phase 2 — Universal WordPress adapter and content model

| Field | Value |
| --- | --- |
| Document | Phase 2 implementation and developer guide |
| Date | 2026-11-02 |
| Status | Implemented on a dedicated agent branch; no QDN publication or live migration |
| Scope | SourceAdapter contract, adapter registry, WordPress adapter, <code>qms-content@1</code>, discovery artifacts, Corbett compatibility, engine/CLI/host integration |
| Phase 1 baseline | commit <code>e71c404a6fc795185c8ef205f77dc101418e5e3c</code> |
| Companion documents | [Architecture](ARCHITECTURE.md), [Phase 1](PHASE-1-ENGINE.md), [Requirements](PRODUCT-REQUIREMENTS.md), [Roadmap](IMPLEMENTATION-ROADMAP.md) |

This document describes what Phase 2 actually implements and what it does not.
It is evidence-oriented: every capability below has a corresponding test file and
command in section 12.

## 1. Outcome

Phase 2 adds a source-adapter boundary and a universal content model to the
Phase 1 engine. It can:

- register source adapters behind a versioned contract and add future adapters
  without changing the engine, content model or (future) publisher;
- connect to a WordPress REST API with public, application-password or session
  authentication;
- discover posts, pages, categories, tags and media with bounded page sizes;
- normalize WordPress content into deterministic <code>qms-content@1</code> documents;
- write a verified discovery batch with an index, report, latest pointer and
  sync history under the project's local artifacts;
- emit ordered <code>qms-event@1</code> events through the Phase 1 run service, including
  cancellation, failures and progress reconstruction after restart;
- adapt normalized content back into the exact legacy Corbett record shape for
  posts and pages, while leaving every existing Corbett command untouched.

Phase 2 does **not** download media, plan publication, publish to QDN, implement
cleanup, provide a GUI or implement Phase 3+ functionality.

## 2. Module map

| Path | Responsibility |
| --- | --- |
| <code>lib/model/content.js</code> | <code>qms-content@1</code> constants, canonical HTML, deterministic hash, validation |
| <code>lib/source/contract.js</code> | Versioned adapter/session contract, capability normalization, validation |
| <code>lib/source/errors.js</code> | Structured source errors, HTTP classification, cancellation |
| <code>lib/source/registry.js</code> | Adapter registry; no adapter-id branching in engine code |
| <code>lib/source/builtin.js</code> | Registers the built-in WordPress adapter |
| <code>lib/source/wordpress/client.js</code> | WordPress REST client: auth, timeout, pagination, errors |
| <code>lib/source/wordpress/extract.js</code> | HTML media/link extraction and legacy-inspection bridge |
| <code>lib/source/wordpress/normalize.js</code> | WordPress raw records → <code>qms-content@1</code> |
| <code>lib/source/wordpress/adapter.js</code> | Capabilities, session, discovery iterators, unsupported reporting |
| <code>lib/source/wordpress/index.js</code> | Public adapter exports |
| <code>lib/engine/source.js</code> | Engine run integration for <code>source.validate</code> / <code>source.discover</code> |
| <code>lib/engine/source-batch.js</code> | Batch directories, streaming index, latest pointer, sync history |
| <code>lib/compat/corbett.js</code> | Read-only legacy Corbett view and route rewriting adapter |
| <code>bin/qms.js</code> | <code>qms source capabilities|validate|discover</code> commands |
| <code>lib/engine/host/server.js</code> | <code>source.list|capabilities|validate|discover</code> host methods |
| <code>test-support/wordpress/fixtureServer.js</code> | Deterministic WordPress REST fixture server |
| <code>fixtures/corbett/golden-post.json</code> | Golden legacy post conversion and route-rewriting fixture |
| <code>fixtures/corbett/golden-page.json</code> | Golden legacy page conversion fixture |

No module under <code>lib/source</code> or <code>lib/model</code> imports Qortal/QDN publishing code,
Electron, the desktop UI or a CMS template. The WordPress adapter imports the
legacy HTML/text helpers only to keep Corbett output comparable.

## 3. SourceAdapter contract

### 3.1 Versioned contract

<code>SOURCE_ADAPTER_CONTRACT = 'qms-source-adapter@1'</code> and
<code>SOURCE_ADAPTER_CONTRACT_VERSION = 1</code>.

An adapter object must provide:

| Member | Type | Meaning |
| --- | --- | --- |
| <code>id</code> | string | Stable adapter id, e.g. <code>wordpress</code>; must match <code>^[a-z0-9][a-z0-9-]{1,31}$</code> |
| <code>displayName</code> | string | Human-readable name |
| <code>version</code> | string | Adapter implementation version |
| <code>contractVersion</code> | integer | Must equal 1 |
| <code>getCapabilities()</code> | function | Returns a capability report |
| <code>createSession({config, auth, signal, client?})</code> | async function | Returns a session bound to one source configuration |

A session must implement:

| Method | Purpose |
| --- | --- |
| <code>validate({signal})</code> | Validate site/auth; return site info, counts, warnings, unsupported entries |
| <code>listContent({contentTypes, perPage, page, offset, query, signal})</code> | Async iterator of raw content records |
| <code>listTerms({taxonomies, perPage, page, offset, signal})</code> | Async iterator of raw taxonomy records |
| <code>listAssets({perPage, page, offset, signal})</code> | Async iterator of raw media/asset records |
| <code>normalizeContent(item, context)</code> | Return a validated <code>qms-content@1</code> document |
| <code>normalizeTerm(item, context)</code> | Return a <code>qms-content@1</code> term document |
| <code>normalizeAsset(item, context)</code> | Return a <code>qms-content@1</code> media document |
| <code>close()</code> | Release adapter-local resources |

The registry validates the adapter shape at registration. A fake non-WordPress
adapter is registered and run end-to-end in
<code>test/source/future-adapter.test.js</code>, proving that no engine change is needed
for a Joomla/Wix-style adapter.

### 3.2 Capability report

<code>normalizeCapabilities()</code> produces a stable shape:

~~~json
{
  "contract": "qms-source-adapter@1",
  "contractVersion": 1,
  "contentTypes": ["post", "page"],
  "terms": ["category", "tag"],
  "assets": { "images": true, "audio": true, "video": true, "documents": true, "embeds": true },
  "states": ["publish", "draft", "pending", "private", "future", "inherit", "unknown"],
  "incremental": { "new": true, "modified": true, "deleted": false, "cursor": "date" },
  "authentication": ["none", "application_password", "session"],
  "limits": {
    "maxPageSize": 100,
    "supportsDateFilters": true,
    "supportsModifiedFilters": true,
    "supportsOffset": true,
    "boundedMemory": true
  },
  "unsupported": {
    "customPostTypes": "reported-with-counts",
    "comments": "reported-not-migrated",
    "users": "reported-not-migrated",
    "menus": "reported-not-migrated",
    "widgets": "reported-not-migrated",
    "reusableBlocks": "reported-not-migrated"
  }
}
~~~

The UI must read these values, never infer support from an adapter id.

### 3.3 Errors and cancellation

Source failures are <code>SourceError</code> instances with stable codes:

| Code | Meaning | Retryable |
| --- | --- | --- |
| <code>SOURCE_INVALID_CONFIG</code> | Bad base URL/config | no |
| <code>SOURCE_INVALID_RESPONSE</code> | Non-JSON or wrong shape | no |
| <code>SOURCE_AUTH_REQUIRED</code> | Missing credentials | no |
| <code>SOURCE_AUTH_FAILED</code> | Wrong credentials (401) | no |
| <code>SOURCE_UNSUPPORTED_AUTH</code> | Unknown auth mode | no |
| <code>SOURCE_TIMEOUT</code> | Request timeout / 408 / 504 | yes |
| <code>SOURCE_NETWORK_ERROR</code> | DNS/connect/reset | yes |
| <code>SOURCE_RATE_LIMITED</code> | HTTP 429, carries <code>retryAfterMs</code> | yes |
| <code>SOURCE_HTTP_ERROR</code> | 5xx / other HTTP | 5xx yes |
| <code>SOURCE_NOT_FOUND</code> | 404 | no |
| <code>SOURCE_UNSUPPORTED_CAPABILITY</code> | Adapter cannot serve the request | no |
| <code>SOURCE_CANCELLED</code> | Abort signal | yes |
| <code>SOURCE_ADAPTER_NOT_FOUND</code> | Registry lookup failed | no |
| <code>SOURCE_CONTRACT_VIOLATION</code> | Adapter/session shape invalid | no |

The engine maps these codes into <code>QmsError</code>, so host/CLI clients see the same
code plus retryability. The WordPress client already exposes
<code>retryAfterMs</code> and <code>maxRetries</code>; Phase 2 defaults to zero retries and leaves
the policy decision to the engine run model.

## 4. WordPress adapter

### 4.1 Endpoints used

| Purpose | Endpoint |
| --- | --- |
| Site validation | <code>GET /wp-json/</code> |
| Content types (including custom) | <code>GET /wp-json/wp/v2/types</code> |
| Posts | <code>GET /wp-json/wp/v2/posts</code> |
| Pages | <code>GET /wp-json/wp/v2/pages</code> |
| Categories | <code>GET /wp-json/wp/v2/categories</code> |
| Tags | <code>GET /wp-json/wp/v2/tags</code> |
| Media library | <code>GET /wp-json/wp/v2/media</code> |
| One media item | <code>GET /wp-json/wp/v2/media/{id}</code> |

Pagination uses <code>per_page</code> (clamped to 1–100) and either <code>page</code> or <code>offset</code>.
<code>X-WP-Total</code> and <code>X-WP-TotalPages</code> are read when present; a <code>Link rel=next</code>
header is used as a fallback. A <code>400 rest_post_invalid_page_number</code> response is
treated as end-of-collection. Empty middle pages are not treated as
end-of-collection when <code>X-WP-TotalPages</code> says more pages exist.

### 4.2 Authentication

- <code>none</code>: public REST access; WordPress returns published content by default.
- <code>application_password</code>: HTTP Basic with username + application password.
- <code>session</code>: GET the WordPress login form, POST credentials, retain the
  <code>wordpress_logged_in_*</code> cookie. This is isolated in the client and documented
  as the brittle fallback. Credentials are not persisted.
- Unknown modes fail with <code>SOURCE_UNSUPPORTED_AUTH</code>; missing secrets fail with
  <code>SOURCE_AUTH_REQUIRED</code>.

Credentials are passed per call to <code>createSession</code>. They are never written to
<code>project.json</code>, the state store, events, reports, indexes or item files. A test
scans every file under the project root and the event stream for the fixture
username, password and <code>Authorization</code> text.

### 4.3 Discovery behavior

- <code>validate()</code> returns site name/URL/namespaces, auth mode, counts for posts,
  pages, categories, tags and media, capabilities and unsupported entries.
- <code>listContent()</code> yields posts and pages with the featured-media record attached
  when accessible. It supports <code>after</code>, <code>before</code>, <code>modified_after</code>,
  <code>modified_before</code>, <code>order</code>, <code>orderby</code>, <code>status</code> and <code>search</code>.
- <code>listTerms()</code> yields categories and tags.
- <code>listAssets()</code> yields the media library.
- Featured media that is missing or inaccessible produces an explicit
  <code>FEATURED_MEDIA_UNAVAILABLE</code> warning; it is never silently dropped.
- Custom post types are listed with best-effort counts from
  <code>/wp-json/wp/v2/types</code> and reported as <code>UNSUPPORTED_CONTENT_TYPE</code>. Known
  non-content features (comments, users, menus, widgets, reusable blocks) are
  reported as <code>UNSUPPORTED_SOURCE_FEATURE</code>.
- Requesting an unsupported content type or taxonomy throws
  <code>SOURCE_UNSUPPORTED_CAPABILITY</code> instead of returning an empty result.

### 4.4 HTML/media extraction

<code>extractHtmlResources()</code> collects:

- <code>img</code> <code>src</code>, <code>data-src</code>, <code>data-lazy-src</code>, <code>data-original</code>;
- <code>srcset</code>, <code>data-srcset</code>, <code>imagesrcset</code> (all candidates are kept);
- <code>audio</code>, <code>video</code> and <code>source</code> <code>src</code>;
- linked image/audio/video/document files;
- <code>iframe</code>/<code>embed</code>/<code>object</code> embeds;
- internal links, external links and external media links.

Every URL is resolved against the WordPress base URL. Relative, absolute and
external media remain distinguishable through <code>role</code> and <code>external</code> fields.
The extraction also computes the exact legacy <code>inspectPostHtml()</code> result and
stores it under <code>source.extra.wordpress.legacy_html_inspection</code>. This is what
makes the Corbett compatibility view byte-identical without rewriting the
legacy rules.

## 5. <code>qms-content@1</code>

### 5.1 Shape

~~~json
{
  "schema": "qms-content@1",
  "version": 1,
  "id": "src_wordpress_post-101",
  "source": {
    "adapter": "wordpress",
    "platform": "wordpress",
    "key": "post:101",
    "type": "post",
    "site": "https://example.test",
    "extra": { "wordpress": { "...": "isolated source metadata" } }
  },
  "content_type": "post",
  "identity": {
    "source_id": "101",
    "slug": "example-post",
    "old_url": "https://example.test/example-post/",
    "canonical_url": "https://example.test/example-post/",
    "parent_key": null,
    "menu_order": null
  },
  "publication_status": "publish",
  "title": "Example post",
  "body": {
    "format": "html",
    "html": "<p>Original rendered HTML…</p>",
    "text": "Plain text…",
    "excerpt_html": "<p>Excerpt…</p>",
    "excerpt_text": "Excerpt…",
    "summary": "Short summary…",
    "hash": "sha256:…"
  },
  "dates": {
    "created_at": "2024-01-02T03:04:05.000Z",
    "modified_at": "2024-02-03T04:05:06.000Z",
    "published_at": "2024-01-02T03:04:05.000Z"
  },
  "authors": [{ "role": "source", "name": null, "source_id": "7" }],
  "terms": {
    "categories": [{ "key": "category:1", "source_id": "1", "slug": "news", "name": "News" }],
    "tags": []
  },
  "media": {
    "featured": { "key": "media:301", "source_id": "301", "url": "…", "resolved_url": "…", "role": "featured", "mime_type": "image/jpeg" },
    "images": [], "audio": [], "video": [], "documents": [], "embeds": [], "attachments": []
  },
  "links": { "internal": [], "external": [], "external_media": [] },
  "unsupported": [],
  "warnings": [],
  "content_hash": "sha256:…",
  "provenance": {
    "adapter_id": "wordpress",
    "adapter_version": "1.0.0",
    "contract_version": 1,
    "html_canonicalization": "qms-html@1",
    "hash_algorithm": "qms-content-hash@1",
    "fetched_at": "2026-11-02T22:00:00.000Z",
    "raw_hash": "sha256:…"
  }
}
~~~

Terms and media are also represented as <code>qms-content@1</code> documents with
<code>content_type</code> <code>category</code>, <code>tag</code> and <code>media</code>. This keeps one versioned model
for every discovered entity and avoids a premature second schema. Phase 3 may
split identity/asset tables without changing this document contract.

### 5.2 Source-specific metadata

Everything WordPress-specific lives under <code>source.extra.wordpress</code>: raw ids,
author id, post format, featured-media id, raw term id arrays, GUID, raw dates,
legacy HTML inspection, legacy attachment summary and raw <code>_links</code>. Engine,
model and publisher code never read these fields.

### 5.3 Identity rules

- <code>source.adapter</code> + <code>source.key</code> is the stable external identity.
  WordPress keys are <code>post:101</code>, <code>page:201</code>, <code>category:1</code>, <code>tag:10</code>,
  <code>media:301</code>.
- <code>id</code> is derived only from adapter id and source key:
  <code>src_wordpress_post-101</code>, <code>src_wordpress_category-1</code>, etc.
- A slug rename changes <code>identity.slug</code> and <code>identity.old_url</code> but not <code>id</code>
  and not <code>source.key</code>.
- Duplicate slugs remain distinct items because ids derive from source keys.
- Repeated imports of the same source item produce the same id.

### 5.4 Hashing rules

<code>content_hash</code> is <code>sha256:</code> over a canonical JSON projection
(<code>qms-content-hash@1</code>, projection version 1). The projection contains:

- schema/version and content type;
- canonical title and body HTML/text/excerpt/summary;
- publication status and published timestamp;
- source authors;
- categories and tags (key, source id, slug, name);
- featured/inline/audio/video/document/embed/attachment media entries;
- internal, external and external-media links.

The projection deliberately excludes:

- <code>source.extra</code> and raw source metadata;
- <code>identity</code> (slug, parent, URL) — a rename is not a content revision;
- <code>provenance</code> (<code>fetched_at</code>, <code>raw_hash</code>);
- <code>dates.modified_at</code> — a modified-date bump with identical content is not a
  revision;
- <code>unsupported</code> and <code>warnings</code> reports.

Canonical HTML (<code>qms-html@1</code>) decodes entities, resolves relative URLs against
the source site, removes comments, normalizes line endings and collapses
inter-tag whitespace. The original rendered HTML is always preserved unchanged
in <code>body.html</code>; canonical HTML is used only for hashing.

Evidence: unchanged fixtures produce identical hashes; HTML entity variants
(<code>&amp;amp;</code> vs <code>&amp;#038;</code>) and relative-vs-absolute URLs hash equally; title/body
edits change the hash; slug and modified-date changes do not.

## 6. Discovery artifacts and storage boundaries

<code>source.discover</code> writes only inside the project's local artifacts directory:

~~~text
<project>/artifacts/source/<adapter>/
├── batches/<batchId>/
│   ├── items/<contentId>.json      qms-content@1
│   ├── index.jsonl                 append-only index journal
│   ├── index.json                  qms-content-index@1
│   ├── report.json                 qms-source-discovery-report@1
│   └── batch.json                  qms-source-batch@1
├── latest.json                     points only at a completed batch
└── sync-history.json               qms-sync-history@1
~~~

- A batch becomes <code>completed</code> only after its index, report and batch metadata
  are written. <code>latest.json</code> is updated last.
- Failed and cancelled batches remain on disk for diagnosis but are never
  referenced by <code>latest.json</code>.
- <code>index.jsonl</code> is append-only; <code>index.json</code> is streamed from it at finalize,
  so the engine does not hold every index entry in memory while iterating.
- Each index entry contains stable <code>sourceKey</code>, <code>id</code>, <code>contentHash</code>, file path,
  byte size, source modified time, <code>firstSeenAt</code>, <code>lastSeenAt</code> and
  <code>new|updated|unchanged</code> status.
- The second discovery marks unchanged items as <code>unchanged</code> and preserves
  <code>firstSeenAt</code>.

### 6.1 Migration Workspace vs Qortal node storage

The batch tree represents the **local migration workspace**. It is owned by the
migration application and can be cleaned up only after a future verification
step. Qortal Core's QDN data is managed only by Core; Phase 2 has no code path
that reads, writes or deletes Core storage.

Phase 2 intentionally implements **no destructive cleanup**. The data model
already supports a future safe cleanup:

- completed batches carry stable source ids, content hashes and a batch id;
- <code>latest.json</code> and <code>sync-history.json</code> identify verified completed work;
- incomplete/cancelled/failed batches are distinguishable by <code>batch.json</code>;
- cleanup can therefore delete only file sets belonging to verified completed
  batches whose hashes no longer appear in any referenced batch.

### 6.2 Memory and state measurement

Phase 2 keeps item bodies out of the Phase 1 state store. The state store holds
run records, event envelopes and counters; item content and index entries live
in artifact files.

Measured with the deterministic fixture (500 posts, each with body, link and
image; command in section 12):

| Metric | Measured value |
| --- | --- |
| Normalized items | 509 (500 posts + 2 pages + 4 terms + 3 media) |
| Item payload bytes | 1,856,138 total; ~3,647 bytes/item |
| <code>index.json</code> bytes | 277,558; ~545 bytes/item |
| State snapshot + journal bytes | 287,120; ~564 bytes/item, dominated by event envelopes |

Measurement command: a 500-post fixture discovery with <code>perPage=100</code> and
<code>progressEvery=500</code> on the Phase 2 worktree. State size is linear in run
events, not item bodies: item payload was 6.5× the state store in this run.

The index is O(n) metadata and is streamed twice (append, then finalize). At
roughly 100k items this is tens of MiB of metadata, still far smaller than item
bodies but no longer trivial. **Recommendation:** keep journal+snapshot for run
state; if Phase 3 needs indexed queries or item identity state above ~50k
items, add SQLite behind the existing JournalStore/identity interfaces with a
measured migration. Do not migrate merely for aesthetics. No SQLite change was
made in Phase 2.

## 7. Phase 1 engine integration

### 7.1 Run kinds and events

| Run kind | Behavior |
| --- | --- |
| <code>source.validate</code> | Connect, validate site/auth, emit warnings and <code>SOURCE_VALIDATED</code>, complete with the report |
| <code>source.discover</code> | Connect, terms, assets, content, finalize; write batch; emit warnings/progress |

Events use the Phase 1 <code>qms-event@1</code> envelope. New stable codes include:

- <code>SOURCE_VALIDATED</code>
- <code>SOURCE_CAPABILITY_REPORT</code>
- <code>SOURCE_PROGRESS</code>
- <code>SOURCE_ITEM_LIMIT_REACHED</code>
- <code>UNSUPPORTED_CONTENT_TYPE</code>
- <code>UNSUPPORTED_SOURCE_FEATURE</code>
- <code>PREVIOUS_INDEX_UNREADABLE</code>
- <code>FEATURED_MEDIA_UNAVAILABLE</code>
- <code>TERM_NOT_FOUND</code>
- <code>EMPTY_TITLE</code>, <code>EMPTY_BODY</code>, <code>MEDIA_WITHOUT_URL</code>

Progress events are emitted at phase boundaries and every <code>progressEvery</code>
items (default 25, CLI/host configurable). They carry the adapter id and batch
id in details. Progress reconstruction after reopen uses the Phase 1 persisted
run/event model; no in-memory-only progress exists.

### 7.2 Cancellation and isolation

- Every loop checks <code>context.throwIfCancelled()</code>; the adapter receives the run
  abort signal, so in-flight HTTP requests abort.
- Cancelled discovery writes <code>batch.json</code> with status <code>cancelled</code> and does not
  update <code>latest.json</code>.
- Project locks remain the Phase 1 single-writer lock. Discovery runs inside the
  opened project handle and cannot write another project's artifacts.
- The state store remains single-writer and crash-safe; item files are written
  atomically.

### 7.3 Host and CLI

Host methods added:

- <code>source.list</code>
- <code>source.capabilities</code>
- <code>source.validate</code>
- <code>source.discover</code>

CLI:

~~~bash
npm run qms -- source capabilities --json
npm run qms -- source validate <projectId> --json
npm run qms -- source discover <projectId> --per-page 50 --json
npm run qms -- source discover <projectId> --modified-after 2026-01-01T00:00:00Z
~~~

Authentication comes only from environment variables
(<code>WORDPRESS_USERNAME</code>, <code>WORDPRESS_APP_PASSWORD</code>, <code>WORDPRESS_PASSWORD</code>,
<code>WORDPRESS_AUTH_MODE</code>, <code>WORDPRESS_LOGIN_URL</code>) or explicit in-process options.
They are never accepted as project settings that are written to disk.

## 8. Corbett Report backward compatibility

### 8.1 Preserved surfaces

- All legacy npm scripts keep their exact commands. The Phase 1 script-map
  regression remains in force.
- <code>src/wpClient.js</code>, <code>src/convert.js</code>, <code>src/convertRaw.js</code>, <code>src/preparePublish.js</code>,
  the batch runner, profiles, manifest/publish-plan formats, route rewriting and
  <code>cr-*</code> identifiers are unchanged.
- No existing live Corbett project data is migrated, rewritten or deleted.
- The universal schema is additive. It does not replace legacy converted
  records or output files.

### 8.2 Compatibility adapter

<code>lib/compat/corbett.js</code> provides a read-only view:

- <code>toLegacyContent(document, options)</code> reproduces <code>convertPost</code>/<code>convertPage</code>
  fields (dates, author, term id arrays, featured media, attachments, links,
  media arrays, import block).
- <code>toLegacyIndexItem()</code> reuses the legacy index constructors.
- <code>createLegacyUrlMap()</code> / <code>createLegacyMediaMap()</code> delegate to the legacy
  functions.
- <code>rewriteLegacyContentHtml()</code> delegates to the unchanged
  <code>rewriteInternalLinks()</code>.
- <code>corbettCompatibilityRecord()</code> returns the <code>corbettreport</code> profile and
  <code>cr-*</code> identifiers.

### 8.3 Golden evidence

<code>fixtures/corbett/golden-post.json</code> and <code>golden-page.json</code> are generated from the
real legacy converters. Tests assert:

1. legacy conversion still equals the golden fixture;
2. the new adapter's compatibility view equals the same golden fixture;
3. route-rewritten HTML is byte-identical to the legacy result;
4. <code>cr-qdn-manifest</code>, <code>cr-posts-index</code>, <code>cr-media-map</code> etc. remain unchanged;
5. original rendered HTML is preserved in both views.

### 8.4 Compatibility limitations

- Phase 2 does not generate <code>converted/posts-index.json</code>, <code>qdn-manifest.json</code>,
  <code>publish-plan.json</code> or batch folders. It proves the adapter can reproduce
  their content; producing them remains a later integration step.
- Only post/page/term/media legacy shapes are covered. Any future legacy
  feature not represented in <code>qms-content@1</code> must be added explicitly.
- <code>imported_at</code> is runtime data. The compatibility view accepts an explicit
  <code>importedAt</code>; golden tests fix it to <code>1970-01-01T00:00:00.000Z</code>.
- Session authentication is inherently brittle and version-dependent; the
  application-password path is preferred.
- WordPress cannot report deleted items through this API contract; deletion
  detection is declared unsupported.

## 9. Security and privacy

- Password, application-password, cookie and Authorization values never enter
  project state, artifacts, reports, indexes or events. The Phase 1 event
  redactor remains a second line of defense.
- Source errors expose status codes and a bounded response-body snippet, not
  request headers.
- The adapter refuses non-http(s) base URLs and validates project paths.
- HTML is preserved as data. No Phase 2 code renders it as trusted app HTML;
  downstream CMS code must sanitize before rendering.
- No wallet, seed or private key is read. No QDN publish or blockchain
  transaction exists in Phase 2.

## 10. Unsupported features and explicit limitations

| Area | Phase 2 behavior |
| --- | --- |
| Custom post types | Reported with counts; not migrated |
| Comments, users, menus, widgets, reusable blocks | Reported as unsupported source features |
| Drafts/private content | Discoverable only with valid auth and explicit <code>status</code>; capability declares states |
| Deleted source items | Not detectable; <code>incremental.deleted = false</code> |
| Media download | Not implemented; URLs preserved |
| QDN publication / manifests | Not implemented |
| Cleanup | Not implemented; safe batch model prepared |
| GUI / Electron / .deb | Not implemented |
| Joomla/Wix | Not implemented; contract/registry/fake-adapter test prove extension point |
| Live WordPress migration | Not run; all tests use fixture servers |
| WordPress non-REST content (shortcodes, plugin-rendered pages) | Only rendered HTML is preserved; plugin semantics are not reimplemented |

## 11. Phase 3 integration requirements

Phase 3 can build on this work if it:

1. consumes <code>qms-content@1</code> instead of WordPress raw fields;
2. reads completed batches via <code>latest.json</code> / <code>index.json</code> and never assumes
   an incomplete batch is valid;
3. uses <code>content_hash</code> + <code>source.key</code> for identity and revision decisions;
4. adds media planning/download without changing the source contract;
5. keeps <code>qms-event@1</code> ordering and run cancellation semantics;
6. keeps Corbett legacy output as the compatibility path until an explicit
   migration decision is recorded;
7. adds identity/mapping state behind the store interface; measure before
   introducing SQLite;
8. implements cleanup only against verified completed batches, preserving
   items referenced by incomplete work and never touching Qortal Core storage;
9. adds adapter conformance tests for any new adapter before registering it.

## 12. Tests and evidence

Commands:

~~~bash
npm ci
npm test                 # 102 tests: 56 legacy + 46 Phase 2
npm run check            # npm test + viewer build + CMS build
node --test test/source  # Phase 2 suite only
~~~

Phase 2 test files:

| File | Covers |
| --- | --- |
| <code>test/source/model.test.js</code> | Schema, deterministic hash, identity, entities, slug/modified exclusions, tamper detection, terms |
| <code>test/source/wordpress-adapter.test.js</code> | Public/auth modes, pagination/empty pages, duplicates/rename, media extraction, warnings, malformed/timeout/network/5xx, cancellation, unsupported types, date filters, 4 000-item bounded-memory archive |
| <code>test/source/engine-source.test.js</code> | Batch artifacts, determinism across runs, event ordering, progress reconstruction, project isolation, secret scanning, cancellation, failure, maxItems, validation, state-vs-items size |
| <code>test/source/host-source.test.js</code> | Host methods, events, run progress |
| <code>test/source/cli-source.test.js</code> | <code>qms source capabilities|validate|discover</code> |
| <code>test/source/future-adapter.test.js</code> | Non-WordPress adapter registers and runs unchanged |
| <code>test/source/engine-boundary.test.js</code> | Engine/model modules do not import WordPress adapter internals or fields |
| <code>test/source/corbett-compat.test.js</code> | Golden legacy output, route rewriting, <code>cr-*</code> identifiers, original HTML preservation |

Baseline before Phase 2: **56/56** tests pass on Phase 1 commit
<code>e71c404a6fc795185c8ef205f77dc101418e5e3c</code>.

Final Phase 2 result: **102/102** tests pass (see the commit report for the
exact run).

Test fixtures are deterministic local HTTP servers. No live WordPress site, QDN
name or Qortal node is contacted.

## 13. Known risks

- WordPress REST shape varies by version/plugin; fixture coverage is broad but
  not exhaustive.
- The session-login flow depends on the site's login form and cookie names.
- HTML extraction is conservative; exotic lazy-load libraries and shadow-DOM
  widgets may require adapter extensions.
- Legacy media arrays come from the legacy inspector; enhanced extraction may
  contain extra candidates. The compatibility view intentionally uses the
  legacy subset.
- Batch dirs accumulate in Phase 2 because cleanup is deliberately absent.
- The index is O(n) metadata; measure before scaling to six-figure archives.
- No live Corbett migration was run; compatibility is proven against golden
  fixtures and unchanged legacy code, not against a live QDN publish.
