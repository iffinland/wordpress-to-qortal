# Qortal CMS

Version: `0.1.0`

This is the separate Qortal-native CMS/Q-App. It is not the WordPress migrator.

## Current MVP

- Reads a CMS dataset from QDN through `cms-manifest`.
- Falls back to a local browser dataset when QDN resources do not exist yet.
- Detects the logged-in Qortal name when Qortal UI exposes `qortalRequest`.
- Shows editor and publish controls only to the owner name.
- Shows read-only mode to everyone else.
- Creates and edits posts with a rich text editor.
- Publishes posts and CMS indexes to QDN.
- Publishes local computer media files to QDN and stores them in `cms-media-index`.
- Attaches published media items to posts.
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

## Owner Mode

Owner controls are enabled when the logged-in Qortal name equals the `name` query parameter or the owner name in `cms-manifest`.

Examples:

```text
http://localhost:5180/?name=developer%20iffi
```

If the logged-in Qortal name is `developer iffi`, edit and publish controls are visible.

Other users see read-only mode and can only read content and use comment controls where available.

## Next Iterations

- Imported Content view that reads migrator `cr-qdn-manifest` and adopts selected posts into CMS indexes.
- Rich text editor media insertion modal.
- QDN video URI and Q-Tube share link parser.
- Lazy loaded embedded video player.
- Comment moderation and owner-side comments index sync.
- Page editor.
- Category/tag management modals.
