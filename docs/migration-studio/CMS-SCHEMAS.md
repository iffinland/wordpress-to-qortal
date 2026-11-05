# CMS QDN schemas (0.7.0)

All CMS resources are published under the exact site QDN name. They are
additive: the QMS manifest and its indexes remain the source of imported
content and are not rewritten.

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

## Resources deliberately not used

- No localStorage-only ownership or settings.
- No second incompatible catalog: the public viewer has one normalized post,
  page, category, tag and search model.
- No direct seed/key/password collection. All writes go through Qortal Hub
  approval.

