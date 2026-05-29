# Qortal CMS

Version: `0.1.0`

This is the separate Qortal-native CMS/Q-App. It is not the WordPress migrator.

## Current MVP

- Reads a CMS dataset from QDN through `cms-manifest`.
- Falls back to a local browser dataset when QDN resources do not exist yet.
- Detects the logged-in Qortal name when Qortal UI exposes `qortalRequest`.
- Treats the owner name as SysOp.
- Lets the SysOp add coauthors by wallet address from Settings.
- Shows editor and publish controls to SysOp and coauthors.
- Shows read-only mode to everyone else.
- Creates and edits posts with a rich text editor.
- Provides a Discussion Boards-inspired rich text tools modal for headings, lists, code, quotes, links, and color.
- Uses video-gallery-style quick action rows for post engagement: like, share, copy QDN URI, send tip, and comments.
- Publishes posts and CMS indexes to QDN.
- Publishes local computer media files to QDN and stores them in `cms-media-index`.
- Attaches published media items to posts.
- Opens attached media through Qortal's resolved QDN resource URLs, with image and TXT/MD previews.
- Adds QDN/Q-Tube video links to posts.
- Renders attached videos through a lazy-load player.
- Has a comments-ready model where Qortal users can publish their own comment resource.
- Leaves imported-content adoption as a staged view for the next iteration.

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
DOCUMENT / cms-post-<slug>-<suffix>
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

For the current local test name:

```text
http://localhost:5180/?name=developer%20iffi
```

## Build

```bash
npm run cms:build
```

The static Q-App build is written to:

```text
qortal-cms/dist/
```

That folder is the first thing to publish as a Qortal `WEBSITE`/Q-App shell. The content itself is stored in separate QDN resources.

## Roles

SysOp controls are enabled when the logged-in Qortal name equals the `name` query parameter or the owner name in `cms-manifest`.

Examples:

```text
http://localhost:5180/?name=developer%20iffi
```

If the logged-in Qortal name is `developer iffi`, SysOp controls are visible.

Coauthors are detected by wallet address from `cms-manifest.coauthors`. Other users see read-only mode and can only read content and use comment controls where available.

## Coauthors

Coauthors are stored in `cms-manifest` as wallet addresses. A coauthor can create and edit CMS content, publish posts, and publish media from the CMS interface. Only the SysOp owner can add or remove coauthors.

## Next Iterations

- Imported Content view that reads migrator `cr-qdn-manifest` and adopts selected posts into CMS indexes.
- Rich text editor media insertion modal.
- Comment moderation and owner-side comments index sync.
- Page editor.
- Category/tag management modals.
