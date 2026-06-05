# Corbett Report Full Import Workflow

Use this with `MIGRATION_PROFILE=corbettreport` after WordPress credentials are
ready. The shareable toolkit starts with `QUICKSTART.md`.

## 1. Configure `.env`

```env
WORDPRESS_BASE_URL=https://example.com
MIGRATION_PROFILE=corbettreport
OUTPUT_DIR=./wp-qortal-import
LIMIT_POSTS=100000
LIMIT_PAGES=100000
LIMIT_CATEGORIES=10000
LIMIT_TAGS=10000
LIMIT_MEDIA=100000
MEDIA_SCOPE=library
DOWNLOAD_MEDIA=true
DOWNLOAD_EXTERNAL_MEDIA=false
DOWNLOAD_MEDIA_TYPES=image,audio,video,document,file
WORDPRESS_AUTH_MODE=application_password
WORDPRESS_LOGIN_URL=/login/
WORDPRESS_USERNAME=your-wordpress-username
WORDPRESS_APP_PASSWORD=your-wordpress-application-password
WORDPRESS_PASSWORD=
QORTAL_NAME=Corbett
QORTAL_SITE_NAME=Corbett
QORTAL_CONTENT_NAME=
QORTAL_MEDIA_NAME=
QORTAL_PUBLISHER_NAMES=Corbett
QORTAL_COAUTHOR_NAMES=
PUBLIC_AUTHOR_NAME=Corbett
```

Use a WordPress Application Password, not the normal account password.

If the site only provides a normal member login and protects REST API access with that login session, use:

```env
WORDPRESS_AUTH_MODE=session
WORDPRESS_LOGIN_URL=/login/
WORDPRESS_USERNAME=your-login-email
WORDPRESS_APP_PASSWORD=
WORDPRESS_PASSWORD=your-normal-login-password
```

Keep `.env` local. It is excluded from git.

`QORTAL_NAME` is the technical publisher used for the current batch.
`QORTAL_SITE_NAME=Corbett` is the current website address and canonical CMS
catalog name.
`QORTAL_CONTENT_NAME=Corbett` is the stable publisher for posts, pages, indexes,
images and documents.
`QORTAL_MEDIA_NAME` routes downloaded audio and video to a separate registered
Qortal name when configured. Images and documents remain under
`QORTAL_CONTENT_NAME`.
`QORTAL_PUBLISHER_NAMES` accepts a comma-separated list of Qortal
names so additional operators can be added later. Visitors do not see these
technical names as the article author. `PUBLIC_AUTHOR_NAME=Corbett` makes the
public article byline display `by Corbett`.
`QORTAL_COAUTHOR_NAMES` seeds the intended CMS coauthor list.

`DOWNLOAD_EXTERNAL_MEDIA=false` is recommended initially. Content may contain linked third-party PDFs or media that should be preserved as links rather than copied.

For a limited post demo, use `MEDIA_SCOPE=selected_posts`. This collects featured images and attachment records belonging to the posts included by `LIMIT_POSTS`.

For an initial small media test, use:

```env
DOWNLOAD_MEDIA_TYPES=image,document
```

## 2. Inspect Access

```bash
npm run inspect
```

This confirms whether the REST API endpoints are reachable with the configured credentials.

## 3. Run Everything

```bash
npm run prepare-import
```

This runs:

```bash
npm run dump
npm run convert
npm run plan-media
npm run download-media
npm run validate
```

After media has been downloaded, run the stricter media validation:

```bash
npm run validate:media
```

Prepare the resource plan before QDN publishing:

```bash
npm run prepare-publish
```

This writes `wp-qortal-import/publish-log/publish-plan.json` without publishing data.
Set `QORTAL_NAME` before running this command when exporting a collaborator manifest.
The generated QDN references then retain the publisher name.

## 4. Preview The Imported Content

```bash
npm run migration:dev
```

Open:

```text
http://localhost:5174/
```

Use the preview to check imported posts, pages, media, tags, and categories before publishing.

## 5. Build and Publish the Migration Publisher Q-App

Build the small Migration Publisher ZIP:

```bash
npm run package:migration-qapp
```

Publish this file to Qortal as an `APP` or `WEBSITE`:

```text
release/wordpress-to-qortal-migration-app-v0.1.5.zip
```

Open the published app inside Qortal UI. Select the local `wp-qortal-import` folder. The Q-App stays small; imported data remains on the user's computer until selected resources are published to QDN.

Use the publish modes in this order:

1. `Demo` for a small smoke test.
2. `CMS JSON` for posts, pages, indexes, and the QDN manifest.
3. `Images`, `Documents`, `Audio`, `Video`, or `Selected media` for manageable media batches.
4. `Full media` only when intentionally publishing every remaining planned resource.

Keep `Skip already published` enabled. The publisher checks QDN before uploading and skips resources that already exist. A selected batch uses one grouped Qortal UI confirmation request.
The Migration Publisher shows batch preparation and completion through a progress bar. Green rows are already published or already present in QDN. Orange rows are queued for the grouped Qortal confirmation.

The publisher requires Qortal UI's `qortalRequest` bridge. It will not publish from a normal browser tab.

## 6. Merge Two Publisher Manifests

Use the stable registered website name as the canonical catalog name:

```text
CorbettReport
```

Each operator can publish a full or partial migration batch under a Qortal name
they own. For example:

```text
Corbett
AgoristMarket
```

After both operators have prepared and published their resources, place both exported
`qdn-manifest.json` files on the canonical operator's computer and run:

```bash
npm run merge-manifests -- \
  --canonical-name=CorbettReport \
  --source=Corbett=/path/to/content-qdn-manifest.json \
  --source=AgoristMarket=/path/to/media-qdn-manifest.json
```

Source order matters. Pass the preferred content publisher first. Later sources
override matching source media URLs while the first source remains authoritative
for indexes and content paths.

The command writes:

```text
wp-qortal-import/converted/merged-qdn-manifest.json
wp-qortal-import/publish-log/catalog-publish-plan.json
```

Open the Migration Publisher Q-App, select the canonical operator's import folder,
choose `Merged catalog`, disable `Skip already published` for this catalog update,
and publish the single selected resource under `CorbettReport`.

## 7. Build the Corbett Report CMS

Create the Corbett Report CMS Q-App ZIP:

```bash
npm run package:cms-qapp:corbettreport
```

Publish:

```text
release/qortal-cms-app-corbettreport-v0.1.5.zip
```

The profile preconfigures the canonical migration catalog:

```text
DOCUMENT / CorbettReport / cr-qdn-manifest
```

The CMS import view can load the merged catalog and resolve posts, images,
documents, audio, and video from their actual QDN publisher names.

The Corbett Report CMS respects QDN ownership boundaries while allowing trusted
coauthors to handle daily publishing work:

1. The SysOp or a trusted coauthor adopts migrated WordPress batches.
2. Coauthors create posts and publish signed submissions under their own Qortal names.
3. The SysOp opens `Submissions`, refreshes the queue, and approves posts into the canonical site index.
4. Trusted coauthors can upload media under their own Qortal names.
5. The Corbett Report CMS automatically loads trusted operator manifests and
   merges their posts, pages, terms, and media into the canonical view.
6. The Corbett Report catalog retains the real publisher name for every resource.

Qortal does not allow one wallet to sign writes under another wallet's
registered name. For example, `AgoristMarket` resources are published under
`AgoristMarket`, not under `CorbettReport`. The CMS profile permits this
operator workflow without weakening the default universal CMS policy.

Operator control resources are namespaced per CMS site:

```text
DOCUMENT / cms-operator-<site-id>-manifest
DOCUMENT / cms-operator-<site-id>-posts-index
DOCUMENT / cms-operator-<site-id>-media-index
```

## 8. Output

Raw WordPress data:

```text
wp-qortal-import/raw/
```

Converted Qortal-oriented JSON:

```text
wp-qortal-import/converted/
```

Downloaded media:

```text
wp-qortal-import/media/
```

Logs:

```text
wp-qortal-import/logs/
```

## 9. Important Files

```text
wp-qortal-import/raw/dump-manifest.json
wp-qortal-import/converted/import-manifest.json
wp-qortal-import/converted/posts-index.json
wp-qortal-import/converted/pages-index.json
wp-qortal-import/converted/categories.json
wp-qortal-import/converted/tags.json
wp-qortal-import/converted/media-map.json
wp-qortal-import/converted/url-map.json
wp-qortal-import/converted/qdn-manifest.json
wp-qortal-import/converted/merged-qdn-manifest.json
wp-qortal-import/publish-log/catalog-publish-plan.json
wp-qortal-import/logs/validation.json
wp-qortal-import/logs/media-plan.json
```

## Notes

The importer paginates WordPress REST API responses internally. WordPress usually limits each REST response to 100 items, so large limits are safe to use.

Converted post and page filenames always include the WordPress source ID:

```text
<slug>--wp-<source_id>.json
```

This prevents duplicate WordPress slugs from overwriting each other.

If media download fails for some files, the failed URLs are written to:

```text
wp-qortal-import/logs/media-download-errors.json
```
