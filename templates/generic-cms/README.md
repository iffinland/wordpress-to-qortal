# Qortal Migration Studio — Generic CMS Template

A neutral, accessible Qortal Q-App website that renders a published QDN
catalog and now provides owner-only authoring, themes, settings and galleries.

**The download is a ZIP package, not a live website.** Downloading or unzipping
it does not publish anything to QDN. The CMS can be published as an **APP** or a
**WEBSITE** where the verified package and current flow support that service.

## Beginner path (no Node.js, npm, Git or compiler)

1. Download
   [qortal-migration-generic-cms-v0.8.0-alpha.10.zip](https://github.com/iffinland/wordpress-to-qortal/releases/download/v0.8.0-rc.7/qortal-migration-generic-cms-v0.8.0-alpha.10.zip)
   and verify it against `SHA256SUMS`.
2. Inspect the ZIP: `index.html` and `assets/` are at the root, with no
   parent folder.
3. Publish it to QDN as an APP or WEBSITE through an owner-approved Qortal
   publication flow.
4. Open it as the owner under the exact name, for example
   `qortal://WEBSITE/developer%20iffi/`.
5. Open **Admin → Site settings** and publish the owner settings revision. This
   replaces the template placeholders with your title, tagline, footer and
   colors. Confirm the footer shows `Template v0.8.0-alpha.10`; an older version
   means the deployed bundle is stale.

Downloading a ZIP is not deployment.

## Features

- **Owner-only administration** verified against the live on-chain name record.
  Non-owners see an Access denied page and no admin controls.
- **Light, dark and system themes** with pre-hydration application, local
  persistence, accessible contrast and no reload.
- **Versioned site settings** (title, tagline, description, navigation, footer,
  branding colors) published as `qms-cms-site-settings@1`.
- **Native blog editor** (TipTap) with local drafts, sanitized rich text,
  categories/tags, preview, media publishing and existing QDN media search.
  Optional featured images can be selected from existing QDN media, uploaded
  from the device, previewed, replaced or removed; the first suitable body
  image is used automatically when none is chosen. First-class `qortal://` links are accepted and opened through Hub.
- **Verified publication state machine** (draft → pending-approval →
  pending-confirmation → published/partial/failed/ambiguous). A post appears in
  Posts, Latest posts, term pages and detail routes only after exact read-back.
- **https links copy instead of navigating** with a transient `Link copied.`
  badge and an explicit clipboard error state.
- **Live full-text search** over `qms-cms-search-index@1`, including titles,
  excerpts and bodies, Unicode case folding, phrases, safe highlighting,
  debouncing and honest missing/stale-index states.
- **Galleries** with multi-file batches of up to 10 images, captions, responsive
  grids, full-screen keyboard/swipe viewer and accessible focus handling.
- **One public catalog** for QMS-imported WordPress content and CMS-authored
  posts: same search, categories and tags. Imported content is never overwritten
  or removed by the CMS or by an incremental WordPress sync.
- Footer attribution **Qortal Migration Studio CMS** linking to
  `qortal://WEBSITE/Qortal Web Builders/` in a new Hub tab. The owner-editable
  footer text is separate and is never overwritten.
- Reads `qms-cms-manifest@1`, `qms-qdn-manifest@1` and the legacy
  `cr-qdn-manifest` shape through one read-only adapter.
- Honest loading, empty, partial, stale and error states.
- DOMPurify HTML/URL sanitization.
- Accessible landmarks, skip link, labelled controls, focus styles, status
  regions and reduced-motion support.
- Valid root-layout Q-App bundle with relative assets and a bundle validator.

## Routes

Home, posts, post, page, category, tag, archive, search, galleries and
owner-gated admin sections:

- `#/admin` — overview and import/adoption
- `#/admin/settings` — owner site settings
- `#/admin/editor` — CMS posts
- `#/admin/galleries` — gallery batches

## Security model

Only the verified on-chain owner of the exact QDN name can use admin. The check
requires the active account, the exact name record on the trusted node and the
account name list to agree. Missing bridge, account, name record or node access
fails closed. Query parameters (`?name=`, `?node=`), localStorage and React
state cannot select the authorization target. Every publish revalidates
immediately before signing. See
[../../docs/migration-studio/CMS-AUTHORING-SECURITY.md](../../docs/migration-studio/CMS-AUTHORING-SECURITY.md)
and [../../docs/migration-studio/CMS-SCHEMAS.md](../../docs/migration-studio/CMS-SCHEMAS.md).

### How ownership is verified

1. The QDN name comes from the hosting context (`_qdnName`, `_qdnBase` or the
   `/render/WEBSITE/<name>` path), never from `?name=`. Percent-encoded names
   are decoded exactly once.
2. Qortal Hub is asked for the active account (`GET_USER_ACCOUNT`) and the
   account's registered names (`GET_ACCOUNT_NAMES`).
3. The CMS reads `/names/<name>` from the node that serves the page. If that
   direct read is blocked, it asks the Hub-connected node for the same record
   through `GET_NAME_DATA`.
4. Owner mode is enabled only when the record name, the record owner address,
   the active address and the account name list all match exactly. Anything else
   stays read-only.

Release builds always use the page's hosting node origin for step 3. The
`VITE_QORTAL_NODE_URL` build variable is a local-development override only; it
must never contain a loopback default in a published bundle. A build-time
`http://localhost:12391` made Android Hub devices check their own loopback and
was the cause of the 0.8.0-alpha.2 Admin regression.

### If Admin is missing

The header shows the current access state. Use the message and action shown:

- **Connect owner account**: the bridge is available but no active account was
  returned. Tap it and approve the account request in Qortal Hub. This never
  grants owner mode by itself; the full check runs again.
- **Retry verification**: the node or name registry could not be read. This is
  not a permission problem. Check the Hub connection and retry.
- **Access denied** with "not registered to" or a different owner address: the
  active Hub account is not the on-chain owner. Switch to the owning account and
  retry. A different account cannot be granted admin through this screen.
- "Open this site inside Qortal Hub": the page was opened in a normal browser,
  where the Qortal request bridge does not exist.

Admin appears in the navigation only after verification succeeds. Direct
navigation to `#/admin` by a non-owner still shows **Access denied**.

## Published resources

| Resource | Service | Identifier | Purpose |
| --- | --- | --- | --- |
| QMS catalog | DOCUMENT | `qms-cms-manifest` / `qms-qdn-manifest@1` | Imported catalog |
| Site settings | DOCUMENT | `qms-cms-site-settings` | Versioned owner settings |
| CMS content index | DOCUMENT | `qms-cms-native-index` | CMS-authored posts/pages |
| Full-text search | DOCUMENT | `qms-cms-search-index` | Versioned `qms-cms-search-index@1` text index |
| Gallery catalog | DOCUMENT | `qms-cms-galleries` | Versioned galleries |
| CMS post content | DOCUMENT | stable per slug | `qms-qdn-content@1` |
| Gallery images | IMAGE/VIDEO/FILE | `qms-cms-media-<hash>` | Content-addressed media |

Publication always verifies exact bytes on read-back. Uncertain submissions are
marked **ambiguous** and are not resent automatically. See
[../../docs/migration-studio/CMS-LINKS-AND-SEARCH.md](../../docs/migration-studio/CMS-LINKS-AND-SEARCH.md)
for link handling, the search index format, rebuild/migration and stale-index
behaviour.

## Upgrading a deployed site

The running site shows its template version in the footer. When the shared QDN
update registry lists a newer CMS template, a compact **Update available** badge
appears. The update view shows the installed and available versions, changes,
compatibility and a copyable verified download link. It does not replace the
running site. Update manually by republishing the template bundle in Qortal Hub.

If the site already uses a runtime `qms-cms-config.json` or published settings,
the update view warns that the generic ZIP must not overwrite a customized CMS.
Preserve the existing configuration and custom assets.

Preserve the existing `qms-cms-config.json` and all identifiers. Publish the
new CMS bundle under the same name, then publish site settings revision 1 (or
the next revision) as the owner. Existing imported posts, categories, tags and
media remain readable. No QMS resource is rewritten by this upgrade.

## For developers / Build from source

Do not use this section for a normal installation.

    npm install
    npm run dev
    npm run typecheck
    npm run test
    npm run build
    npm run build -- --zip

Use a different configuration file:

    CMS_TEMPLATE_CONFIG=/path/to/site.json npm run build

Development fixture:

    npm run dev
    open http://localhost:5191/?source=fixture#/

`source=fixture` is ignored in production builds. An optional node URL for
catalog reads can be set with `VITE_QORTAL_NODE_URL`; ownership and fee checks
always use a trusted node, never `?node=`.

## Output

The build creates `dist` with `index.html` at the bundle root and relative asset
URLs. With `--zip` it writes
`release/qortal-migration-generic-cms-v<version>.zip`. The release pipeline
validates that ZIP as a root-layout Q-App and ships it with the .deb and the
Publisher ZIP.

