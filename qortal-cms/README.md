# Qortal CMS

Version: `0.1.4`

This is the separate Qortal-native CMS/Q-App. It is not the WordPress migrator.

## Current MVP

- Reads a CMS dataset from QDN through `cms-manifest`.
- Falls back to a local browser dataset when QDN resources do not exist yet.
- Detects the logged-in Qortal name when Qortal UI exposes `qortalRequest`.
- Treats the Qortal name that publishes the CMS as SysOp.
- Generates a stable site ID for each CMS installation.
- Lets the SysOp edit the public site title and tagline.
- Lets the SysOp add coauthors by wallet address or Qortal name from Settings.
- Shows editor and publish controls to SysOp and coauthors.
- Shows read-only mode to everyone else.
- Creates and edits posts with a rich text editor.
- Provides a Discussion Boards-inspired rich text tools modal for headings, lists, code, quotes, links, and color.
- Uses video-gallery-style quick action rows for post engagement: like, share, copy QDN URI, send tip, and comments.
- Publishes posts and CMS indexes to QDN.
- Publishes local computer media files to QDN and stores them in `cms-media-index`.
- Attaches published media items to posts.
- Opens attached media through Qortal's resolved QDN resource URLs, with image and TXT/MD previews.
- Loads migrator QDN manifests from the Imported view.
- Previews imported WordPress posts and adopts them into CMS drafts.
- Adds QDN/Q-Tube video links to posts.
- Renders attached videos through a lazy-load player.
- Has a comments-ready model where Qortal users can publish their own comment resource.
- Adopts one imported post or up to 10 selected posts into CMS drafts.

## Resource Identifiers

The owner name publishes these CMS control resources:

```text
DOCUMENT / cms-manifest
DOCUMENT / cms-posts-index
DOCUMENT / cms-pages-index
DOCUMENT / cms-categories
DOCUMENT / cms-tags
DOCUMENT / cms-media-index
DOCUMENT / cms-comments-index
```

Each post is a separate resource:

```text
DOCUMENT / cms-post-<site-id>-<slug>-<suffix>
```

Each comment is a separate resource under the commenter's own Qortal name:

```text
DOCUMENT / cms-comment-<post-id>-<suffix>
```

Media files are separate QDN resources under the owner name:

```text
IMAGE / cms-media-<filename>-<suffix>
AUDIO / cms-media-<filename>-<suffix>
VIDEO / cms-media-<filename>-<suffix>
FILE  / cms-media-<filename>-<suffix>
```

Posts can also reference external QDN video resources without copying them:

```text
qortal://VIDEO/<name>/<identifier>
/arbitrary/VIDEO/<name>/<identifier>
qortal://APP/Q-Tube/video/<name>/<identifier>
qortal://use-embed/VIDEO?name=<name>&identifier=<identifier>&service=VIDEO
```

## Development

From the repository root:

```bash
npm run cms:dev
```

Open:

```text
http://localhost:5180/?name=YourQortalName
```

## Build

```bash
npm run cms:build
```

The static Q-App build is written to:

```text
qortal-cms/dist/
```

Create a Qortal-ready CMS ZIP from the repository root:

```bash
npm run package:cms-qapp
```

Publish this file as a Qortal `APP` or `WEBSITE`:

```text
release/qortal-cms-app-v0.1.4.zip
```

The app shell is separate from the content. CMS content is stored in separate QDN resources.

## Roles

SysOp controls are enabled when the logged-in Qortal name matches the Qortal name that publishes the CMS manifest.

Coauthors are detected from `cms-manifest.coauthors` by wallet address or Qortal name. Other users see the public visitor frontend and can use reader/comment controls where available.

## Coauthors

Coauthors are stored in `cms-manifest`. A coauthor can create and edit CMS content, publish posts under their own Qortal name, and publish media from the CMS interface. Only the SysOp owner can add or remove coauthors.

## Imported Content

The Imported view reads a migrator manifest such as:

```text
DOCUMENT / cr-qdn-manifest
```

After loading the manifest, a SysOp or coauthor can preview a WordPress post and adopt it into the CMS as a draft. They can also select up to 10 unadopted imported posts and adopt them in one Qortal multi-publish confirmation.

Imported attachments are read from the migrator `media-map` entrypoint. When an imported post is adopted, published imported media is added to the CMS media index and linked to the new CMS draft. Imported video resources are added to the post video list for lazy playback. The original migrator resources are left untouched; CMS adoption creates separate CMS posts and updates CMS indexes.

## Next Iterations

- Rich text editor media insertion modal.
- Comment moderation and owner-side comments index sync.
- Page editor.
- Category/tag management modals.
