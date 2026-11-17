# Qortal Migration Studio 0.8.0 rc.1

<!-- qms-release-version: 0.8.0-rc.8 -->

The public prerelease tag is `v0.8.0-rc.8`. Component versions are independent:
Desktop `0.8.0-beta.1`, Migration Publisher `0.8.0-beta.1` and Generic CMS
`0.8.0-rc.8`. The desktop and publisher artifacts are reused byte-for-byte from
the approved beta.1 builds.

## Generic CMS 0.8.0-rc.8

Everything added since 0.8.0-beta.2:

- Compact hamburger header; the old standalone header buttons are gone. Site
  navigation is reorderable in settings.
- Subpages and page assignments: posts and pages can be shown on user-created
  pages via the optional `qms-cms-sections` document, with ordering and
  hide-from-home support.
- One combined Qortal Hub confirmation for posts and galleries. The confirmation
  dialog lists every resource and the total fee; one Hub approval publishes the
  batch, and each resource is verified separately with truthful partial states.
- Modernized admin: grouped navigation, lazy-loaded admin chunk, design tokens
  and responsive layouts.
- Class-based, theme-aware text colors in the rich text editor.
- Attachments: audio, video, files and archives; text/PDF preview; video posters;
  documented size limits and the public-node limit; all in the same batch as the
  post.
- Optional cross-publication:
  - Q-Tube: each eligible video is published once under `qtube_vid_<token>`
    and its metadata at `<video>_metadata`; the CMS post references the same
    resource. A video already present under the CMS media identifier triggers a
    size and fee warning before the extra upload.
  - SubWire: one `essay` document with GFM Markdown. Headings, paragraphs,
    lists, links, images, quotes and code survive; text colors, audio, video and
    file attachments are dropped. A backlink to the CMS post is appended. The
    featured image is converted to WebP in the webview canvas (1600 px, 2 MiB
    cap), with a clear error if conversion is impossible.
  - Quitter: one 280-character announcement, created only on the first publish,
    never repeated on edits.
  - All destinations join the same owner-approved batch and the same fee quote;
    per-destination failures never mark the CMS post itself as failed.
- Per-account local data isolation: drafts, settings drafts, pending publication
  records, adoption records and media/gallery pending state are scoped by the
  deployment identity and the verified owner address. Old unscoped drafts are
  hidden and shown only as a count with a Delete button; no titles, content or
  adoption are exposed.

## Known limitations

- Q-Tube, SubWire and Quitter content is public and permanent; live ecosystem
  behaviour must still be confirmed in a real Qortal Hub session.
- SubWire Markdown cannot represent text colors, audio, video or file
  attachments; the CMS keeps them only in the canonical post.
- Q-Tube rejects MKV and HEVC; only MP4, M4V, WebM and OGV are offered.
- Legacy unscoped drafts are delete-only by design.
- The dataset cache contains public published content only; theme is a global
  browser preference, not account data.
