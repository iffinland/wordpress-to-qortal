# CMS QDN schemas (0.7.0)

All CMS resources are published under the exact site QDN name. They are
additive: the QMS manifest and its indexes remain the source of imported
content and are not rewritten.

## Runtime host binding and offline cache isolation

Every newly generated `qms-cms-config.json` carries a `deployment` binding:

```json
{
  "deployment": {
    "service": "APP",
    "name": "NASA-Official",
    "identifier": "default"
  }
}
```

At runtime the CMS derives the current APP/WEBSITE triple from Qortal's hosted
context, never from visitor query parameters. It accepts a runtime config only
when its deployment, `site.ownerName`, and `admin.qdnName` agree with that
context. Existing configs without `deployment` are accepted only when both
name fields agree; they are still cached under the current host triple.

The dataset cache format is `qms-cms-dataset-cache@2`. Its binding contains the
source, hosted service/name/identifier, catalog manifest identifier and
`site.id`. A fallback is available only when every binding value and the cached
dataset site id match. Version-1 cache entries and mismatched manifests or
references are ignored rather than displayed. This is intentionally fail-closed:
an unavailable NASA catalog is an unavailable/empty state, never another
site's cached posts.

The canonical public application route is always
`qortal://APP/<registered-name>/` (or `qortal://WEBSITE/<registered-name>/`).
QMS therefore publishes its site shell at identifier `default`. A project
manifest, content and media remain namespaced and bound in the generated
runtime config; only the public APP/WEBSITE shell uses the canonical slot. A
missing, invalid or mismatched `qms-cms-config.json` must clear the catalog
identifiers and display a diagnostic instead of trying template defaults.

## qms-cms-site-settings@1

Resource: `DOCUMENT / <name> / qms-cms-site-settings`

```json
{
  "schema": "qms-cms-site-settings@1",
  "version": 1,
  "revision": 2,
  "previous_revision": 1,
  "updated_at": "2026-11-05T00:00:00.000Z",
  "published_by": { "address": "Q...", "name": "developer iffi" },
  "site": {
    "title": "Developer Iffi",
    "tagline": "Notes",
    "description": "Long description",
    "footerText": "Owner footer text",
    "publicAuthor": "Developer Iffi"
  },
  "navigation": [
    { "label": "Home", "href": "#/" },
    { "label": "Posts", "href": "#/posts" }
  ],
  "theme": {
    "colors": {
      "accent": "#4da3ff",
      "background": "#0b0f14",
      "surface": "#121820",
      "text": "#e8edf4"
    }
  },
  "integrity": { "algorithm": "sha256", "value": "sha256:..." }
}
```

Rules:

- `revision` is a positive integer. Publication reads the current remote
  revision and refuses to overwrite a newer one.
- Navigation accepts internal `#/` routes or http(s) URLs only.
- Colors must be CSS colors; the owner accent is preserved in both themes.
- `integrity` covers the document with the integrity field removed.
- Drafts are local only. There is no publish without a fresh owner
  revalidation and Hub approval.

## qms-cms-native-index@1

Resource: `DOCUMENT / <name> / qms-cms-native-index`

```json
{
  "schema": "qms-cms-native-index@1",
  "version": 1,
  "revision": 3,
  "site_id": "generic-site",
  "updated_at": "2026-11-05T00:00:00.000Z",
  "published_by": { "address": "Q...", "name": "developer iffi" },
  "categories": [{ "id": "cms-category-news", "name": "News", "slug": "news" }],
  "tags": [{ "id": "cms-tag-qortal", "name": "Qortal", "slug": "qortal" }],
  "entries": [
    {
      "id": "cms-native-post-...",
      "type": "post",
      "title": "A CMS post",
      "slug": "a-cms-post",
      "status": "published",
      "excerpt": "Summary",
      "category_ids": ["cms-category-news"],
      "tag_ids": ["cms-tag-qortal"],
      "created_at": "2026-11-05T00:00:00.000Z",
      "updated_at": "2026-11-05T00:00:00.000Z",
      "published_at": "2026-11-05T00:00:00.000Z",
      "contentHash": "sha256:...",
      "qdn": {
        "service": "DOCUMENT",
        "name": "developer iffi",
        "identifier": "qms-cms-...-post-a-cms-post-..."
      }
    }
  ]
}
```

Entries use the same shape as QMS index entries. Content resources use
`qms-qdn-content@1` with `body.html`, `identity.slug`, `dates`, `authors`,
`terms` and `qdn`. The viewer merges this supplement with the QMS manifest
indexes. Imported content wins a slug collision; the editor blocks such a slug
before publication.

## qms-cms-gallery@1

Resource: `DOCUMENT / <name> / qms-cms-galleries`

```json
{
  "schema": "qms-cms-gallery@1",
  "version": 1,
  "revision": 4,
  "site_id": "generic-site",
  "updated_at": "2026-11-05T00:00:00.000Z",
  "published_by": { "address": "Q...", "name": "developer iffi" },
  "galleries": [
    {
      "id": "gallery-...",
      "slug": "trip",
      "title": "Trip",
      "description": "Photos",
      "createdAt": "2026-11-05T00:00:00.000Z",
      "updatedAt": "2026-11-05T00:00:00.000Z",
      "images": [
        {
          "service": "IMAGE",
          "name": "developer iffi",
          "identifier": "qms-cms-media-...",
          "mimeType": "image/jpeg",
          "bytes": 123456,
          "sha256": "sha256:...",
          "caption": "Caption",
          "alt": "Alt text",
          "width": 1600,
          "height": 900
        }
      ]
    }
  ]
}
```

Rules:

- At most 10 newly selected images per publication batch. A gallery can grow by
  repeated batches; there is no lifetime cap.
- Gallery images are ordinary QDN resources. Identifiers are content-addressed
  and reused when identical bytes already exist.
- Publication is revision-checked and verified byte-for-byte on read-back.

## qms-cms-edit-overlay@1

Resource: `DOCUMENT / <name> / qms-cms-edit-overlay`

Owner edits of WordPress-imported content. The imported manifest, indexes and
content resources are never modified. Each entry points at a CMS-owned
`qms-qdn-content@1` resource and keeps the imported identity.

```json
{
  "schema": "qms-cms-edit-overlay@1",
  "version": 1,
  "revision": 3,
  "site_id": "site-fixture",
  "updated_at": "2026-11-06T00:00:00.000Z",
  "published_by": { "address": "Q...", "name": "developer iffi" },
  "entries": [
    {
      "schema": "qms-cms-edit-overlay@1",
      "source_item_id": "wp-42",
      "source_type": "post",
      "source_slug": "imported-title",
      "source_adapter": "wordpress",
      "source_id": 42,
      "source_old_url": "https://old.example/imported-title/",
      "slug": "imported-title",
      "slug_aliases": ["older-imported-slug"],
      "title": "Owner-edited title",
      "excerpt": "Owner-edited excerpt",
      "category_ids": ["cat-news"],
      "tag_ids": ["tag-intro"],
      "author": "Owner",
      "content": {
        "service": "DOCUMENT",
        "name": "developer iffi",
        "identifier": "qms-cms-ov-..."
      },
      "content_hash": "sha256:...",
      "base_source_hash": "sha256:...",
      "base_source_modified_at": "2026-10-20T10:30:00.000Z",
      "source_modified_at": "2026-10-20T10:30:00.000Z",
      "state": "published",
      "conflict_state": "clean",
      "edited_at": "2026-11-06T00:00:00.000Z",
      "edited_by": { "address": "Q...", "name": "developer iffi" }
    }
  ]
}
```

Rules:

- `source_item_id` is the imported catalog id and the stable overlay key.
- `base_source_hash` is the upstream fingerprint the edit was based on. An
  unchanged source applies the edit silently; a changed source sets
  `conflict_state` to `open` until the owner keeps local edits or accepts
  upstream.
- `slug_aliases` preserves old URLs after an explicit published slug change.
- Imported resources are never referenced as write targets. The overlay content
  is a new CMS-owned resource using the same `qms-qdn-content@1` schema.
- Revision-checked upsert; a stale base revision blocks the write.

Native index entries additionally accept `slug_aliases` and `original_slug`
for the published slug-change workflow.

## Resources deliberately not used

- No localStorage-only ownership or settings.
- No second incompatible catalog: the public viewer has one normalized post,
  page, category, tag and search model.
- No direct seed/key/password collection. All writes go through Qortal Hub
  approval.

