# CMS authorization, themes, settings, editor and galleries

This document describes the 0.7.0 Generic CMS changes. It is written for site
owners and for developers reviewing the security boundary.

## 1. Admin authorization

### Confirmed defect before 0.7.0

A signed-in Qortal account that did **not** own the published name could open
`#/admin` directly. The page rendered catalog counts and the import/adoption
controls. The mutation paths were already guarded by
`canMutate(identity)`, so the defect was primarily authorization exposure, not
an anonymous QDN write: adoption only wrote a local queue, and there was no
publish action in the CMS. It was still a real authorization defect: admin
state, adopted items and editing UI were visible to an unauthorized account.

### 0.7.0 rule

Only the verified on-chain owner of the exact QDN name may use any admin route
or mutation. The check is layered:

1. The authorization target comes from the hosting context (Hub globals or the
   `/APP/<name>/` or `/WEBSITE/<name>/` path) or, when no hosting context
   exists, the owner-published `qms-cms-config.json`.
2. Visitor query parameters (`?name=`, `?qdnName=`, `?node=`) and
   localStorage are never used to select the name or the ownership node.
3. `GET_USER_ACCOUNT` must return an address.
4. `GET /names/<exact name>` on the trusted node must return the same exact name
   and an owner equal to the active address.
5. `GET_ACCOUNT_NAMES` must include the exact name.
6. Missing bridge, account, name record, name-list entry, node error, account
   change or name transfer all fail closed.
7. Every mutation re-fetches the active account and name record immediately
   before signing. A remembered React identity is never authorization.
8. Settings, editor and gallery publication are owner-only components. Non-owners
   get **Access denied** and no catalog, adoption queue, drafts or editing UI is
   rendered.

Public posts, search, categories, tags and galleries remain read-only and open to
everyone.

### Test matrix

The CMS suite covers: correct owner; different registered name; different
signed-in account; no auth; no bridge; name record unavailable; name transfer;
stale account at mutation time; forged `?name=`; forged localStorage owner;
forged `?node=`; and a direct admin navigation as a reader. See
`templates/generic-cms/tests/security.test.ts`,
`tests/render.test.tsx` and `tests/interactions.test.tsx`.

## 2. Themes

- Modes: light, dark, system.
- Persisted in `localStorage` under `qms-cms-theme@1`.
- Applied by an inline pre-hydration script in `index.html`, so the first paint
  already uses the resolved theme (no flash of the wrong theme).
- System mode follows `prefers-color-scheme` and reacts to changes without a
  reload.
- The owner's accent color is preserved; light surfaces/text use an accessible
  derived palette. Accent text is chosen by relative luminance for contrast.
- Available to all visitors, not only owners.

## 3. Owner-only site settings

Resource: `DOCUMENT / <exact name> / qms-cms-site-settings`

The resource is additive and versioned. It never replaces the published APP
bundle or the QMS catalog. The CMS merges it over `cms.config.json` at runtime.

Editable fields: site title, tagline, description, footer text, public author,
navigation labels/links and branding colors.

Publication flow:

1. Edit locally (a local draft is convenience only).
2. Preview applies the draft in this browser and shows a preview banner.
3. **Publish settings…** shows the exact destination, next revision, node unit
   fee and signer address.
4. Confirm sends one `PUBLISH_QDN_RESOURCE` to Qortal Hub for approval.
5. The CMS reads the exact bytes back and compares SHA-256 before reporting
   success.
6. A newer published revision blocks the write instead of overwriting it.

Placeholders such as `Qortal Site`, `Independent publishing on Qortal QDN`,
`Qortal QDN publication` and the neutral template description are removed at
runtime; the QDN name is used as the title fallback.

## 4. Footer attribution

The footer shows editable footer text separately from:

```
Qortal. Template v<package version>
```

The version comes from `templates/generic-cms/package.json` embedded by Vite as
`__CMS_TEMPLATE_VERSION__`. It is never hardcoded.

The whole attribution is a link to
`qortal://WEBSITE/Qortal%20Web%20Builders/`. A normal click first calls the
Qortal Hub bridge action `OPEN_NEW_TAB` with `{ qortalLink }` (verified against
Qortal/Qortal-Hub and qapp-core). The anchor still has
`target="_blank" rel="noopener noreferrer"`, so outside Hub an installed protocol
handler or a manual copy of the visible link is a graceful fallback.

## 5. Native editor

- TipTap (maintained React editor) with StarterKit, Link, Image and Placeholder.
  No hand-rolled contenteditable.
- Title, slug, rich HTML (H2/H3, paragraphs, bold, italic, lists, quotes, links,
  images), excerpt, categories, tags, author and dates.
- Local drafts are versioned under `qms-cms-post-drafts@1` and survive reload.
- Preview renders sanitized HTML.
- Publication re-sanitizes with the existing DOMPurify policy and URL allowlist
  before bytes are built. Scripts, iframes, forms, event handlers and executable
  HTML are removed.
- Media picker supports multi-file selection, preview, publish to the matching
  QDN service (IMAGE/VIDEO/AUDIO/FILE), insertion into the editor, reuse of
  already-published catalog/gallery media, and Hub `SEARCH_QDN_RESOURCES` for
  existing media. Manual URL entry is not required.
- Q-Tube's current pattern was reviewed: it searches QDN resources by service
  and identifier, then fetches each name, and publishes DOCUMENT metadata plus
  VIDEO/IMAGE resources through `PUBLISH_QDN_RESOURCE`. This implementation uses
  the same Hub actions and content-addressed identifiers.
- Android file selection works when the Hub build supports the file input;
  otherwise the picker shows an honest message and existing QDN media remains
  available.

## 6. Publishing model and QMS compatibility

QMS-imported content stays in `qms-cms-manifest` / `qms-qdn-manifest@1` and its
indexes, untouched. CMS-authored content is a versioned supplement:

`DOCUMENT / <name> / qms-cms-native-index` (`qms-cms-native-index@1`)

Entries use the same `qms-qdn-index` entry shape, and content uses
`qms-qdn-content@1`, so both sources normalize into one public catalog, one
search, one category/tag space and one post/page list. A slug collision with
imported content is blocked before publication and skipped defensively at read
time. A WordPress incremental sync never deletes the CMS supplement.

Galleries are similarly versioned:

`DOCUMENT / <name> / qms-cms-galleries` (`qms-cms-gallery@1`)

The gallery catalog has an integer revision and never overwrites imported
content. Images are QDN IMAGE resources with content-addressed identifiers; an
existing identical resource is reused rather than overwritten.

### Uncertain outcomes

A submitted transaction is not success. Before signing, the exact intended bytes
and their SHA-256 are recorded as pending. After submission the CMS reads the
resource back and compares exact bytes. If read-back is not confirmed, the state
is **ambiguous**, the UI says it was not retried, and retrying verifies the
pending submission instead of signing a second copy. A different pending hash
blocks a new submission until the user resolves it.

### Upgrade path for an already published CMS

1. Keep `qms-cms-config.json` and all existing identifiers.
2. Publish the new CMS ZIP for the same APP/WEBSITE name (or let QMS package it).
3. Open the site as the owner; the old catalog still renders.
4. Publish `qms-cms-site-settings` revision 1 to replace placeholder copy.
5. Optionally publish CMS posts/galleries. Existing imported posts are untouched.

No migration rewrites QMS resources. The CMS simply starts reading the optional
supplements when present.

