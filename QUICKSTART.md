# Quickstart: WordPress to Qortal Migrator

Current version: `0.1.0`

This Node.js tool downloads WordPress content to your computer, converts it to Qortal-friendly JSON, downloads selected media, and prepares a QDN publish plan.

The Migration Publisher and Qortal CMS are separate Q-Apps. Imported content stays on your computer until the Migration Publisher sends selected resources to QDN.

## 1. Install Requirements

Install:

- Node.js 18 or newer
- npm
- Qortal Core and Qortal UI for QDN publishing
- WordPress REST API access or a supported WordPress login

Check Node.js:

```bash
node --version
npm --version
```

## 2. Install the Importer

```bash
npm install
cp .env.example .env
```

Edit `.env`. Start with a small import:

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

Keep `.env` private.

## 3. Import and Convert

Check access:

```bash
npm run inspect
```

Run the local import:

```bash
npm run prepare-import
npm run validate:media
npm run prepare-publish
```

This creates:

```text
wp-qortal-import/
├── raw/
├── media/
├── converted/
├── logs/
└── publish-log/
```

## 4. Optional Local Preview

For local development or review:

```bash
npm run migration:dev
```

Open:

```text
http://localhost:5174/?tool=viewer
```

This local URL is only for preview and development. Normal QDN publishing uses the small Migration Publisher Q-App.

## 5. Build the Migration Publisher Q-App

```bash
npm run package:migration-qapp
```

This creates:

```text
release/wordpress-to-qortal-migration-app-v0.1.0.zip
```

Publish that small ZIP to Qortal as an `APP` or `WEBSITE`. Do not place `wp-qortal-import` inside the Q-App ZIP.

Open the published app inside Qortal UI:

1. Select your local `wp-qortal-import` folder.
2. Confirm the Qortal name.
3. Keep `Skip already published` enabled.
4. Publish `Demo`.
5. Publish `CMS JSON`.
6. Publish media gradually.

Publisher media modes:

- `Images`
- `Documents`
- `Audio`
- `Video`
- `Selected media`
- `Full media`

Each resource row has a checkbox. Large migrations should be uploaded in small batches. Existing QDN resources are skipped automatically when `Skip already published` is enabled.

## 6. Load Content in Qortal CMS

In the Qortal CMS backend, open `Imported` and enter:

```text
Importer owner name: <Qortal name used by Migration Publisher>
Manifest identifier: cr-qdn-manifest
```

Click `Load imported content`, preview a post, adopt it as a CMS draft, review attachments, and publish it through the CMS.

## 7. Useful Commands

```bash
npm run inspect
npm run prepare-import
npm run validate:media
npm run prepare-publish
npm run migration:dev
npm run package:migration-qapp
npm run package:tester-bundle
```

See `TESTER_GUIDE.md` for the complete tester workflow.
