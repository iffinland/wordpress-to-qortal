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
WORDPRESS_USERNAME=
WORDPRESS_APP_PASSWORD=
```

Settings:

- `WORDPRESS_BASE_URL` is the public base URL of the WordPress site.
- `OUTPUT_DIR` is where raw and converted files will be written.
- `LIMIT_POSTS` is how many posts to fetch in the first test run.
- `LIMIT_PAGES` is how many pages to fetch in the first test run.
- `LIMIT_CATEGORIES` is how many categories to fetch.
- `LIMIT_TAGS` is how many tags to fetch.
- `LIMIT_MEDIA` is how many media library items to fetch.
- `WORDPRESS_USERNAME` is optional and is only needed when the WordPress REST API requires authentication.
- `WORDPRESS_APP_PASSWORD` is optional and should be a WordPress Application Password, not the normal account password.

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
│   └── wordpress-media.json
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
    └── media-map.json
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

- Pages
- Categories and tags as full JSON files
- Media download and local media map
- WordPress XML/WXR import
- Qortal/QDN publishing
- Qortal CMS/Q-App UI
