# WordPress to Qortal Migrator

Current version: `0.1.0`

This package imports WordPress content, converts it to Qortal-friendly JSON, and provides a local Migration Preview/Publisher for publishing migrated resources to QDN.

This is the migration package. The future interactive Qortal CMS/Q-App should be a separate package.

Start here:

```text
QUICKSTART.md
```

## What This Tool Does

- Connects to the WordPress REST API.
- Downloads posts, pages, categories, tags, and media metadata.
- Saves raw WordPress JSON locally.
- Converts content to Qortal-oriented JSON.
- Downloads selected media files.
- Creates indexes and media maps.
- Creates a QDN publish plan.
- Provides a local preview app.
- Publishes selected migration resources through Qortal UI dev mode.

## Install

```bash
npm install
```

## Configure

```bash
cp .env.example .env
```

Edit `.env`:

```env
WORDPRESS_BASE_URL=https://example.com
OUTPUT_DIR=./wp-qortal-import
LIMIT_POSTS=5
LIMIT_PAGES=5
LIMIT_CATEGORIES=100
LIMIT_TAGS=100
LIMIT_MEDIA=20
MEDIA_SCOPE=selected_posts
DOWNLOAD_MEDIA=true
DOWNLOAD_EXTERNAL_MEDIA=false
DOWNLOAD_MEDIA_TYPES=image,audio,video,document,file
WORDPRESS_AUTH_MODE=application_password
WORDPRESS_LOGIN_URL=/login/
WORDPRESS_USERNAME=
WORDPRESS_APP_PASSWORD=
WORDPRESS_PASSWORD=
QORTAL_NAME=
QORTAL_NODE_URL=http://localhost:12391
QORTAL_API_KEY=
QORTAL_API_KEY_FILE=~/qortal/apikey.txt
```

Keep `.env` private.

## Import Workflow

Check WordPress access:

```bash
npm run inspect
```

Import, convert, plan media, download media, and validate:

```bash
npm run prepare-import
```

Strict media validation:

```bash
npm run validate:media
```

Prepare QDN resource identifiers and manifest:

```bash
npm run prepare-publish
```

## Local Preview And Publisher

Run the Migration Preview/Publisher:

```bash
npm run migration:dev
```

Open:

```text
http://localhost:5174/
```

Publisher:

```text
http://localhost:5174/?tool=publish&name=YourQortalName
```

QDN read mode:

```text
http://localhost:5174/?source=qdn&name=YourQortalName
```

Publishing requires Qortal UI dev mode or another Q-App context where `qortalRequest` is available. A normal browser can preview local content, but it cannot publish to QDN.

## Publisher Modes

- `Demo` publishes one small smoke-test set.
- `CMS JSON` publishes imported posts, pages, indexes, and one image for basic media testing.
- `Full media` publishes every planned resource, including all downloaded media files.

Recommended order:

1. Run `Demo`.
2. Test QDN read mode.
3. Run `CMS JSON`.
4. Run `Full media` only after smaller tests work.

## Output Structure

Generated files are written to `wp-qortal-import/`:

```text
wp-qortal-import/
├── raw/
├── media/
├── converted/
├── logs/
└── publish-log/
```

Important generated files:

```text
wp-qortal-import/converted/posts-index.json
wp-qortal-import/converted/pages-index.json
wp-qortal-import/converted/categories.json
wp-qortal-import/converted/tags.json
wp-qortal-import/converted/media-map.json
wp-qortal-import/converted/url-map.json
wp-qortal-import/converted/qdn-manifest.json
wp-qortal-import/publish-log/publish-plan.json
```

## Checks

```bash
npm run check
```

This validates downloaded media and builds the Migration Preview/Publisher.

## Create A Shareable Copy

```bash
npm run package:migration
```

The clean package is written to:

```text
release/wordpress-to-qortal-migrator/
```

It excludes `node_modules`, `.env`, generated import data, and the separate future CMS folder.

Create a zip file for sharing:

```bash
npm run package:zip
```

The zip file is written to:

```text
release/wordpress-to-qortal-migrator-v0.1.0.zip
```

## More Documentation

```text
QUICKSTART.md
docs/FULL_IMPORT_WORKFLOW.md
docs/QDN_RESOURCE_STRATEGY.md
```
