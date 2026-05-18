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
DOWNLOAD_MEDIA=true
WORDPRESS_USERNAME=your-wordpress-username
WORDPRESS_APP_PASSWORD=your-wordpress-application-password
```

Use a WordPress Application Password, not the normal account password.

## 2. Inspect Access

```bash
npm run inspect
```

This confirms whether the REST API endpoints are reachable with the configured credentials.

## 3. Run Everything

```bash
npm run prepare
```

This runs:

```bash
npm run dump
npm run convert
npm run download-media
npm run validate
```

## 4. Output

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

## 5. Important Files

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
```

## Notes

The importer paginates WordPress REST API responses internally. WordPress usually limits each REST response to 100 items, so large limits are safe to use.

If media download fails for some files, the failed URLs are written to:

```text
wp-qortal-import/logs/media-download-errors.json
```
