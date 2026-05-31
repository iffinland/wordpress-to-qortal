# Full Import Workflow

Use this after WordPress credentials are ready.

## 1. Configure `.env`

```env
WORDPRESS_BASE_URL=https://example.com
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
release/wordpress-to-qortal-migration-app-v0.1.3.zip
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

## 6. Output

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

## 7. Important Files

```text
wp-qortal-import/raw/dump-manifest.json
wp-qortal-import/converted/import-manifest.json
wp-qortal-import/converted/posts-index.json
wp-qortal-import/converted/pages-index.json
wp-qortal-import/converted/categories.json
wp-qortal-import/converted/tags.json
wp-qortal-import/converted/media-map.json
wp-qortal-import/converted/url-map.json
wp-qortal-import/logs/validation.json
wp-qortal-import/logs/media-plan.json
```

## Notes

The importer paginates WordPress REST API responses internally. WordPress usually limits each REST response to 100 items, so large limits are safe to use.

If media download fails for some files, the failed URLs are written to:

```text
wp-qortal-import/logs/media-download-errors.json
```
