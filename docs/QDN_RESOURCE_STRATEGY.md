# QDN Resource Strategy

The Corbett Report migration stores each part of the archive as a separate QDN resource. It does not publish the WordPress site as one large ZIP.

## Qortal names

| Name | Purpose |
| --- | --- |
| `Corbett` | Migration content, imported posts, pages, indexes, images, documents, audio, and video. |
| `CorbettReport` | The published website and CMS Q-App. |

The content name and the app name are intentionally separate. The Migration Publisher must be signed by the account that owns `Corbett`.

## Services

| Content | QDN service | Notes |
| --- | --- | --- |
| Post JSON | `DOCUMENT` | One resource per post. |
| Page JSON | `DOCUMENT` | One resource per page. |
| Indexes | `DOCUMENT` | Posts, pages, categories, tags, media map, URL map, and manifests. |
| Images | `IMAGE` | Downloaded images from the same site. |
| Video | `VIDEO` | Downloaded video files. |
| Audio | `AUDIO` | Downloaded audio files. |
| PDF, ZIP, DOC, and other files | `FILE` | Non-media attachments. |

## Identifier prefix

The Corbett Report profile uses the prefix `cr`.

Content identifiers use:

```text
cr-post-<slug>-<hash>
cr-page-<slug>-<hash>
cr-media-<filename>-<hash>
```

Index identifiers use:

```text
cr-posts-index
cr-pages-index
cr-categories
cr-tags
cr-media-map
cr-url-map
cr-import-manifest
cr-qdn-manifest
```

The hash makes identifiers stable and avoids collisions between similar slugs or filenames. Identifiers are limited to 64 characters.

## QDN catalog

The public site and CMS start from:

```text
DOCUMENT/Corbett/cr-qdn-manifest
```

The manifest maps local conversion paths to QDN resources:

```json
{
  "converted/posts/example--wp-12345.json": {
    "type": "post",
    "service": "DOCUMENT",
    "identifier": "cr-post-example-abc123",
    "name": "Corbett"
  }
}
```

It also lists:

- the posts, pages, categories, tags, and media map entrypoints;
- the publisher and coauthor names;
- media resources by source URL;
- media entries that remain external links.

## Publish modes

The published Migration Publisher is:

```text
WEBSITE/Corbett
```

It reads a local batch folder and uses Qortal UI's `qortalRequest` bridge to sign transactions.

| Mode | What it publishes |
| --- | --- |
| `CMS JSON` | Posts, pages, indexes, manifests, and one sample image. |
| `Images` | Imported images. |
| `Documents` | PDFs and other document attachments. |
| `Audio` | Imported audio. |
| `Video` | Imported video. |
| `Selected media` | Only checked media rows. |
| `Full media` | Every media resource in the current batch plan. |
| `Merged catalog` | The cumulative catalog index resources. |
| `Demo` | A small smoke test. |

Use `CMS JSON` before media. Use `Full media` only when the connection and disk space are suitable.

## Cumulative batch behavior

The batch workflow combines the current batch with:

- the QDN baseline recorded by `npm run batch:init -- --from-qdn`;
- all completed and prepared local batches.

The cumulative catalog is used for:

```text
cr-posts-index
cr-pages-index
cr-categories
cr-tags
cr-media-map
cr-url-map
cr-qdn-manifest
```

The publish plan still contains only the current batch's new content and media. This keeps QDN uploads small while the published indexes remain complete.

## Media policy

- Same-site media is downloaded by default.
- External media is preserved as a link by default.
- A blocked or missing file stays an external link and is recorded in validation warnings.
- A media URL that returns HTML is rejected rather than saved as a broken image.
- Downloads use a timeout and retry with the configured concurrency.

Set this to make any missing same-site media fail the batch instead of becoming a warning:

```bash
CORBETT_ALLOW_MISSING_MEDIA=false npm run batch:retry
```

## Local data layout

```text
workspaces/corbettreport-batches/
├── state.json
├── baseline-qdn/
│   └── converted/
│       ├── qdn-manifest.json
│       ├── posts-index.json
│       ├── pages-index.json
│       ├── categories.json
│       ├── tags.json
│       ├── media-map.json
│       └── url-map.json
├── batches/
│   └── <timestamp>_batch-<number>_posts-<range>/
│       ├── raw/
│       ├── converted/
│       ├── media/
│       ├── logs/
│       └── publish-log/
└── receipts/
    └── batch-<number>/
```

## Safety

- Run `batch:init -- --from-qdn` before the first batch.
- Keep `Skip already published` enabled.
- Do not publish `.env` or the project folder.
- Do not delete QDN resources during migration.
- Keep a backup of local batch data until the public site is verified.
