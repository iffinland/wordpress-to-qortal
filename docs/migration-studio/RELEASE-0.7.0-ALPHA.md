# Qortal Migration Studio 0.7.0 alpha — CMS security, themes, editor and galleries

<!-- qms-release-version: 0.7.0 -->

| Field | Value |
| --- | --- |
| Product | Qortal Migration Studio |
| Version | 0.7.0 |
| Channel | alpha |
| Tag target | v0.7.0-alpha.1 |
| Signing | unsigned |
| Architecture | amd64 |
| Release status | published GitHub prerelease |
| Release URL | https://github.com/iffinland/wordpress-to-qortal/releases/tag/v0.7.0-alpha.1 |

## Downloads

- [Qortal Migration Studio 0.7.0 .deb](https://github.com/iffinland/wordpress-to-qortal/releases/download/v0.7.0-alpha.1/qortal-migration-studio_0.7.0_amd64.deb)
- [Migration Publisher Q-App ZIP](https://github.com/iffinland/wordpress-to-qortal/releases/download/v0.7.0-alpha.1/qortal-migration-publisher-v0.7.0.zip)
- [Generic CMS Q-App ZIP](https://github.com/iffinland/wordpress-to-qortal/releases/download/v0.7.0-alpha.1/qortal-migration-generic-cms-v0.7.0.zip)

Downloading a ZIP is not deployment. An owner must publish it with wallet
approval.

## Security fix (priority)

A different signed-in Qortal account could open **Admin** on a CMS published
under another name. The old page exposed catalog counts and the local
adoption/import controls; QDN writes were already guarded, so it was an
authorization/UI exposure rather than an anonymous publish path.

0.7.0 fixes the whole class:

- Admin navigation is hidden from non-owners.
- Direct `#/admin`, `#/admin/settings`, `#/admin/editor` and
  `#/admin/galleries` render **Access denied** for non-owners with no catalog,
  adoption queue, drafts or editing state.
- Ownership requires the exact name record's on-chain owner to equal the active
  account **and** the active account name list to contain the name.
- Missing bridge, account, name record, node access or a name transfer fails
  closed.
- Every mutation revalidates the active account and name record immediately
  before signing; a remembered identity is never authorization.
- Query parameters (`?name=`, `?qdnName=`, `?node=`), localStorage, CMS config
  and React state cannot select the authorization target or grant ownership.
- Public posts, search, categories, tags and galleries remain read-only and open.

### Verified test matrix

Correct owner; different registered name; different account; no auth; no bridge;
name record unavailable; name transferred; stale account; forged query name;
forged localStorage; forged node query; direct admin navigation as a reader; and
owner-only settings/editor/gallery guards.

## CMS features

- **Themes:** light, dark, system; local persistence; inline pre-hydration
  script; no wrong-theme flash; accessible contrast; accent preserved.
- **Settings:** versioned `qms-cms-site-settings@1` with owner-only editing of
  title, tagline, description, navigation, footer text and branding; draft,
  preview, destination/fee confirmation, revision conflict protection and exact
  read-back. Template placeholders are removed at runtime.
- **Footer:** `Qortal. Template v<actual package version>`, clickable to
  `qortal://WEBSITE/Qortal%20Web%20Builders/` in a new Hub tab via
  `OPEN_NEW_TAB`; safe anchor fallback outside Hub.
- **Editor:** TipTap rich text (H2/H3, paragraphs, bold, italic, lists, quotes,
  links, images), title/slug, excerpt, categories/tags, author/date, preview,
  resumable local drafts, explicit errors/retry, sanitized HTML.
- **Media:** multi-file selection, preview, publish to IMAGE/VIDEO/AUDIO/FILE,
  content-addressed reuse, existing QDN media search through
  `SEARCH_QDN_RESOURCES`, gallery reuse.
- **Galleries:** versioned `qms-cms-gallery@1`; max 10 images per batch, no
  lifetime cap; captions; responsive grid; full-screen viewer with prev/next,
  keyboard arrows, Escape, swipe, focus restore and missing-image state.
- **Compatibility:** CMS posts use `qms-qdn-content@1` and a versioned
  `qms-cms-native-index` supplement merged into one public catalog with
  QMS-imported content; search, categories and tags include both. A WordPress
  incremental sync never deletes CMS posts or galleries.

## Acceptance status

| Gate | Result |
| --- | --- |
| Root test suite | 437/437 pass |
| Generic CMS typecheck | pass |
| Generic CMS tests | 75/75 pass (security, render, interaction, a11y, schemas) |
| Generic CMS production build + bundle validation | pass |
| Real live-node read-only checks | name owner, catalog manifest, unit fee, imported posts |
| Live signed CMS settings/post/gallery publication | **not performed in this run** — no mainnet signing authorization; implementation uses Hub `PUBLISH_QDN_RESOURCE` and exact read-back and is covered by mocks/unit tests |
| Three-artifact release gate | pass: .deb + Publisher ZIP + Generic CMS ZIP from one commit |
| Desktop typecheck + tests | pass, 44/44 |
| Desktop package | unsigned amd64; installed/launch evidence from the existing release pipeline |

Honest boundaries: automated tests and read-only live checks do not prove a
successful signed transaction. The first owner publication of settings, a CMS
post or gallery should be supervised.

## Upgrade steps for an existing CMS

1. Preserve `qms-cms-config.json` and all existing identifiers.
2. Publish the new Generic CMS ZIP under the same APP/WEBSITE name.
3. Open the site as the owner under `qortal://APP/<name>/` or
   `qortal://WEBSITE/<name>/`.
4. Publish site settings revision 1 (or the next revision) to replace
   placeholders.
5. Existing QMS posts, indexes, categories, tags and media remain untouched.
   CMS content and galleries are additive resources.

