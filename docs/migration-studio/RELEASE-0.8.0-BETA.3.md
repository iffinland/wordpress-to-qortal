# Generic CMS 0.8.0-beta.3

Component release for the Generic CMS. Desktop and Migration Publisher remain
0.8.0-beta.1 and their artifacts are unchanged. The QMS bundle version and tag
remain 0.8.0-beta.2; this is a CMS source release on main.

## Added since 0.8.0-beta.2

- Compact hamburger header; the old standalone header buttons are gone. Site
  navigation is reorderable in settings.
- Subpages and page assignments via the optional `qms-cms-sections` document,
  with ordering and hide-from-home support.
- One combined Qortal Hub confirmation for posts and galleries. The dialog lists
  every resource and the total fee; one approval publishes the batch and each
  resource is verified separately with truthful partial states.
- Modernized admin: grouped navigation, lazy-loaded admin chunk, design tokens
  and responsive layouts.
- Class-based, theme-aware text colors in the rich text editor.
- Attachments: audio, video, files and archives; text/PDF preview; video posters;
  documented size limits and the public-node limit; all in the post batch.
- Optional cross-publication:
  - Q-Tube: each eligible video is published once under `qtube_vid_<token>`
    and metadata at `<video>_metadata`; the CMS post references the same
    resource. A video already present under the CMS media identifier produces a
    size and fee warning before the extra upload.
  - SubWire: one `essay` document with GFM Markdown. Headings, paragraphs,
    lists, links, images, quotes and code survive; text colors, audio, video and
    file attachments are dropped. A backlink to the CMS post is appended. The
    featured image is converted to WebP in the webview canvas (1600 px, 2 MiB
    cap), with a clear error if conversion is impossible.
  - Quitter: one 280-character announcement, created only on the first publish,
    never repeated on edits.
- Per-account local data isolation: drafts, settings drafts, pending publication
  records, adoption records and media/gallery pending state are scoped by the
  deployment identity and the verified owner address. Old unscoped drafts are
  hidden and shown only as a count with a Delete button.

## Known limitations

- Q-Tube, SubWire and Quitter content is public and permanent.
- SubWire Markdown cannot represent text colors, audio, video or file
  attachments; the canonical CMS post keeps them.
- Q-Tube rejects MKV and HEVC; only MP4, M4V, WebM and OGV are offered.
- Legacy unscoped drafts are delete-only by design.
- The three-artifact release gate was not run for this code release: the
  unchanged desktop 0.8.0-beta.1 evidence files are not present in this
  checkout. The desktop and Publisher artifacts were not rebuilt or modified.
