# WP to Qortal Importer

This is a small Node.js MVP importer for moving WordPress content toward a Qortal-native JSON structure.

The first version only fetches WordPress posts through the public WordPress REST API. It does not publish anything to Qortal/QDN yet.

## Requirements

- Node.js 18 or newer
- npm
- A WordPress site with the REST API enabled

## Install

```bash
npm install
```

## Configure

Copy the example environment file:

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
MEDIA_SCOPE=library
DOWNLOAD_MEDIA=false
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

Settings:

- `WORDPRESS_BASE_URL` is the public base URL of the WordPress site.
- `OUTPUT_DIR` is where raw and converted files will be written.
- `LIMIT_POSTS` is how many posts to fetch in the first test run.
- `LIMIT_PAGES` is how many pages to fetch in the first test run.
- `LIMIT_CATEGORIES` is how many categories to fetch.
- `LIMIT_TAGS` is how many tags to fetch.
- `LIMIT_MEDIA` is how many media library items to fetch.
- `MEDIA_SCOPE=library` fetches a media-library slice; use `MEDIA_SCOPE=selected_posts` to fetch attachments and featured media for the selected posts.
- `DOWNLOAD_MEDIA` controls whether `npm run download-media` downloads files during the full workflow.
- `DOWNLOAD_EXTERNAL_MEDIA=false` avoids copying third-party linked files by default.
- `DOWNLOAD_MEDIA_TYPES` limits the downloaded resource types when a staged migration is needed.
- `WORDPRESS_AUTH_MODE=application_password` uses `WORDPRESS_USERNAME` with `WORDPRESS_APP_PASSWORD`.
- `WORDPRESS_AUTH_MODE=session` signs in through the normal WordPress login form using `WORDPRESS_USERNAME` with `WORDPRESS_PASSWORD`.
- `WORDPRESS_LOGIN_URL` defaults to `/login/` for sites using a custom login path.
- `WORDPRESS_APP_PASSWORD` should be used where the site makes Application Passwords available.
- `WORDPRESS_PASSWORD` is for session-mode fallback where the user only has the site's normal member login.
- `QORTAL_NAME` is the registered Qortal name that will publish the prepared resources.
- `QORTAL_NODE_URL` is the local Qortal node API base URL.
- `QORTAL_API_KEY` is required for Qortal node upload checks and future direct-node publishing.
- `QORTAL_API_KEY_FILE` can point to the local Qortal `apikey.txt` file so the key is not copied into `.env`.

## Inspect The WordPress API

```bash
npm run inspect
```

The command checks:

- the REST API root endpoint
- posts
- pages
- categories
- tags
- media
- whether authentication is configured

If the site returns `401 Unauthorized`, create a WordPress Application Password and add it to `.env`.

## Run The Dump

```bash
npm run dump
```

The command will:

1. Create the needed output folders.
2. Fetch posts from `/wp-json/wp/v2/posts`.
3. Fetch pages from `/wp-json/wp/v2/pages`.
4. Fetch categories from `/wp-json/wp/v2/categories`.
5. Fetch tags from `/wp-json/wp/v2/tags`.
6. Fetch media items from `/wp-json/wp/v2/media`.
7. Save the original WordPress responses into `raw/`.
8. Print a terminal summary.

## Convert Raw Data

```bash
npm run convert
```

The command reads:

```text
wp-qortal-import/raw/wordpress-posts.json
```

Then it:

1. Converts each post to a simpler Qortal-oriented JSON file.
2. Converts each page to a simpler Qortal-oriented JSON file.
3. Creates `converted/posts-index.json`.
4. Creates `converted/pages-index.json`.
5. Creates `converted/categories.json`.
6. Creates `converted/tags.json`.
7. Creates `converted/media-map.json`.
8. Creates `converted/url-map.json`.
9. Writes conversion errors to `logs/errors.json`.
10. Prints a terminal summary.

The normal workflow is:

```bash
npm run dump
npm run convert
```

## Download Media

Review the planned download size first:

```bash
npm run plan-media
```

This writes `wp-qortal-import/logs/media-plan.json` and shows file totals by type.

```bash
npm run download-media
```

This reads `converted/media-map.json`, downloads source media files into `media/`, calculates `sha256`, and updates `media-map.json`.

By default, media download only runs when `.env` contains:

```env
DOWNLOAD_MEDIA=true
```

You can force it manually with:

```bash
npm run download-media -- --force
```

## Validate Output

```bash
npm run validate
```

This checks that the expected raw and converted files exist and writes:

```text
wp-qortal-import/logs/validation.json
```

After downloading media, require every selected same-site media file to be present and hashed:

```bash
npm run validate:media
```

## Prepare QDN Publish Plan

```bash
npm run prepare-publish
```

This does not publish anything. It creates deterministic proposed QDN services and identifiers for posts, pages, indexes, and downloaded media:

```text
wp-qortal-import/publish-log/publish-plan.json
```

It also creates a Q-App loader manifest:

```text
wp-qortal-import/converted/qdn-manifest.json
```

The Q-App can use this manifest to map local content paths and source media URLs to QDN services and identifiers.

## QDN Publish Dry Run

Real QDN publishing is not implemented yet. First validate the publishing plan:

```bash
npm run publish -- --dry-run
```

The command requires:

```env
QORTAL_NAME=YourQortalName
QORTAL_NODE_URL=http://localhost:12391
QORTAL_API_KEY=
QORTAL_API_KEY_FILE=~/qortal/apikey.txt
```

The dry run checks:

- all planned local files exist
- services and identifiers are present
- identifiers are unique
- identifier length is valid
- total publish size can be reviewed before real publishing

It writes:

```text
wp-qortal-import/publish-log/dry-run.json
```

To also check a running Qortal node and available temporary upload space:

```bash
npm run publish -- --dry-run --check-node
```

## Local Viewer

Install the viewer dependencies once:

```bash
cd viewer
npm install
cd ..
```

Run the TypeScript viewer:

```bash
npm run viewer:dev
```

The viewer opens at:

```text
http://localhost:5174/
```

During local development the viewer reads the already converted dataset directly from:

```text
wp-qortal-import/
```

The Vite dev server exposes those files under:

```text
/qortal-content/
```

That means large downloaded media files are not duplicated into the viewer project.

The viewer has two data loading modes:

```text
http://localhost:5174/
```

uses local filesystem-backed content through `/qortal-content/`.

```text
http://localhost:5174/?source=qdn&name=YourQortalName
```

uses QDN resources through `cr-qdn-manifest`. This mode is for testing after the manifest and content resources have been published to QDN.

Open the minimal QDN publisher helper:

```text
http://localhost:5174/?tool=publish&name=YourQortalName
```

It publishes only the first demo set through Qortal UI's `qortalRequest` bridge:

- one image
- one post JSON
- `media-map`
- `posts-index`
- `qdn-manifest`

Build the viewer:

```bash
npm run viewer:build
```

## Full Workflow

After WordPress credentials are ready, use:

```bash
npm run inspect
npm run prepare
```

`npm run prepare` runs:

```bash
npm run dump
npm run convert
npm run plan-media
npm run download-media
npm run validate
```

For a detailed full import guide, see:

```text
docs/FULL_IMPORT_WORKFLOW.md
```

The first QDN resource strategy is documented here:

```text
docs/QDN_RESOURCE_STRATEGY.md
```

## Run With Sample Data

Use this while WordPress access is not ready yet:

```bash
npm run dump:sample
```

This uses `fixtures/sample-wordpress-posts.json` instead of calling the WordPress API.

It writes the sample raw file and then runs the same conversion step as `npm run convert`.

## Output Structure

By default, files are written into `./wp-qortal-import`:

```text
wp-qortal-import/
├── raw/
│   ├── wordpress-posts.json
│   ├── wordpress-pages.json
│   ├── wordpress-categories.json
│   ├── wordpress-tags.json
│   ├── wordpress-media.json
│   └── dump-manifest.json
└── converted/
    ├── posts/
    │   └── example-post.json
    ├── pages/
    │   └── example-page.json
    ├── posts-index.json
    ├── pages-index.json
    ├── categories.json
    ├── tags.json
    ├── url-map.json
    ├── media-map.json
    └── import-manifest.json
```

Errors are written into:

```text
wp-qortal-import/
└── logs/
    └── errors.json
```

Each converted post keeps important WordPress source data:

- WordPress source ID
- old URL
- slug
- title
- date and modified date
- status
- excerpt
- full HTML content
- category and tag IDs
- featured media ID
- images, audio, video, and links found inside the post HTML

## Not Included Yet

These are planned for later phases:

- WordPress XML/WXR import
- Qortal/QDN publishing
- Qortal CMS/Q-App editing UI
