# Quickstart: WordPress to Qortal Migrator

This tool imports WordPress content to your computer, converts it to Qortal-friendly JSON, and helps publish the migrated resources to QDN.

It is a migration tool. It is not the long-term Qortal CMS.

## 1. Install Requirements

Install these first:

- Node.js 18 or newer
- npm
- Qortal UI, if you want to publish to QDN
- access to a WordPress account or a public WordPress REST API

Check Node.js:

```bash
node --version
npm --version
```

## 2. Install The Tool

From the project folder:

```bash
npm install
```

This installs the importer and the Migration Preview/Publisher app.

## 3. Create `.env`

Copy the example file:

```bash
cp .env.example .env
```

Edit `.env`.

Small first test:

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
```

For WordPress Application Password login:

```env
WORDPRESS_AUTH_MODE=application_password
WORDPRESS_USERNAME=your-wordpress-username
WORDPRESS_APP_PASSWORD=your-application-password
WORDPRESS_PASSWORD=
```

For normal website login fallback:

```env
WORDPRESS_AUTH_MODE=session
WORDPRESS_LOGIN_URL=/login/
WORDPRESS_USERNAME=your-login-email
WORDPRESS_APP_PASSWORD=
WORDPRESS_PASSWORD=your-normal-password
```

Keep `.env` private. Never publish it to GitHub.

## 4. Check WordPress Access

```bash
npm run inspect
```

If this works, continue.

If it returns `401 Unauthorized`, the WordPress site requires login. Configure either Application Password mode or session mode in `.env`.

## 5. Import And Convert Content

Run the full local import:

```bash
npm run prepare-import
```

This runs:

- `dump` - downloads raw WordPress JSON
- `convert` - creates Qortal-friendly JSON
- `plan-media` - checks planned media downloads
- `download-media` - downloads selected media files
- `validate` - checks the generated files

Then run the strict media check:

```bash
npm run validate:media
```

## 6. Prepare QDN Resource Plan

```bash
npm run prepare-publish
```

This creates:

```text
wp-qortal-import/publish-log/publish-plan.json
wp-qortal-import/converted/qdn-manifest.json
```

No QDN publishing happens in this step.

## 7. Preview The Migration Locally

Start the Migration Preview/Publisher:

```bash
npm run migration:dev
```

Open:

```text
http://localhost:5174/
```

Use this page to review imported posts, pages, images, videos, documents, categories, and tags.

## 8. Publish To QDN

QDN publishing currently runs through Qortal UI dev mode because the browser needs Qortal UI's `qortalRequest` bridge.

Open this URL inside Qortal UI dev mode:

```text
http://localhost:5174/?tool=publish&name=YourQortalName
```

Replace `YourQortalName` with your registered Qortal name.

Publisher modes:

- `Demo` publishes one small smoke-test set.
- `CMS JSON` publishes imported posts, pages, and indexes, plus one image for basic media testing.
- `Full media` publishes every planned resource, including all downloaded media.

Recommended order:

1. Publish `Demo`.
2. Check that QDN mode can read the result.
3. Publish `CMS JSON`.
4. Publish `Full media` only after the small tests work.

QDN read test:

```text
http://localhost:5174/?source=qdn&name=YourQortalName
```

## 9. Useful Commands

```bash
npm run inspect
npm run prepare-import
npm run validate:media
npm run prepare-publish
npm run migration:dev
npm run check
```

Create a clean copy for sharing:

```bash
npm run package:migration
```

The copy is written to:

```text
release/wordpress-to-qortal-migrator/
```

That release copy does not include `node_modules`, `.env`, generated import data, or the future CMS folder.

## 10. Output Folders

Generated data is written to:

```text
wp-qortal-import/
├── raw/
├── media/
├── converted/
├── logs/
└── publish-log/
```

Do not publish this folder to a public repository unless you are certain the imported content may be shared.
