# WordPress to Qortal Toolkit: Tester Guide

Version: `0.1.5`

This package contains three separate tools:

1. `wordpress-to-qortal-migrator-v0.1.5.zip` - a local Node.js importer.
2. `wordpress-to-qortal-migration-app-v0.1.5.zip` - a small Qortal Migration Publisher Q-App.
3. `qortal-cms-app-v0.1.5.zip` - the Qortal-native CMS Q-App.

The imported WordPress dataset stays on your own computer. Do not place a multi-gigabyte media folder inside a Q-App ZIP.

## Requirements

Install:

- Node.js 18 or newer
- npm
- Qortal Core
- Qortal UI
- a registered Qortal name
- WordPress REST API access or a supported WordPress login

## Part 1: Import WordPress Data Locally

Extract:

```text
wordpress-to-qortal-migrator-v0.1.5.zip
```

Open a terminal inside the extracted folder:

```bash
npm install
cp .env.example .env
```

Edit `.env`. Start with a small test:

```env
WORDPRESS_BASE_URL=https://example.com
MIGRATION_PROFILE=generic
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

Keep `.env` private. It may contain WordPress credentials.

Check WordPress access:

```bash
npm run inspect
```

Import, convert, download media, and validate:

```bash
npm run prepare-import
npm run validate:media
npm run prepare-publish
```

The generated local dataset is written to:

```text
wp-qortal-import/
├── raw/
├── media/
├── converted/
├── logs/
└── publish-log/
```

## Part 2: Publish Migrated Resources to QDN

Publish this ZIP to Qortal as an `APP` or `WEBSITE`:

```text
wordpress-to-qortal-migration-app-v0.1.5.zip
```

Open the published Migration Publisher inside Qortal UI.

1. Select your local `wp-qortal-import` folder.
2. Confirm the Qortal name.
3. Keep `Skip already published` enabled.
4. Publish `Demo` first.
5. Publish `CMS JSON`.
6. Publish media in manageable batches.

Media modes:

- `Images`
- `Documents`
- `Audio`
- `Video`
- `Selected media`
- `Full media`

Each row has a checkbox. For a slow connection, publish a few files at a time. The publisher checks QDN before uploading and skips resources that already exist.

The publisher uses grouped QDN publishing. A selected batch is sent to Qortal UI as one multi-resource confirmation request.
The progress bar shows batch preparation and completion. Green statuses indicate resources already published or found in QDN. Orange `Queued in batch` statuses are waiting for the grouped Qortal confirmation.

## Part 3: Publish and Configure the CMS

Publish this ZIP to Qortal as an `APP` or `WEBSITE`:

```text
qortal-cms-app-v0.1.5.zip
```

The Qortal name that publishes the CMS becomes the SysOp owner. Each CMS installation receives its own stable site ID.

In CMS Settings:

1. Set the public site title.
2. Set the tagline.
3. Save the site identity.
4. Add coauthors if needed.

Coauthors publish under their own Qortal names. Only the SysOp can add or remove coauthors.

## Part 4: Adopt Imported Posts Into the CMS

Open the CMS backend and select `Imported`.

Enter:

```text
Importer owner name: <Qortal name used by Migration Publisher>
Manifest identifier: wpq-qdn-manifest
```

Click `Load imported content`.

You can:

- preview imported WordPress posts
- adopt one post as a CMS draft
- adopt up to 10 selected posts in one batch
- review categories, tags, and attachments
- edit the CMS draft
- publish the final CMS post

Publish a few images before adopting a media-heavy post. Large audio and video collections can be migrated gradually later.

## Important Notes

- Do not publish `.env`.
- Do not put `wp-qortal-import` inside the Q-App ZIP.
- Do not upload all videos immediately unless you intentionally want a large migration.
- Keep local backups of the original WordPress export and `wp-qortal-import`.
- This is an early tester release. Use small batches first.
