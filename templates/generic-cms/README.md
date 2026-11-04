# Qortal Migration Studio - Generic CMS Template

A neutral, accessible Qortal Q-App site template that renders a published QDN
catalog. It is independent from the Corbett Report custom clone and does not
import engine or Corbett code.

**The download is a ZIP package, not a live website.** Downloading or unzipping
it does not publish anything to QDN. The Generic CMS can be published as either
an **APP** or a **WEBSITE** where the verified package and current application
flow support that service. A QMS migration normally publishes its configured
CMS bundle for you; deploying this neutral ZIP by hand is optional.

## Beginner path (no development tools)

1. Download
   [qortal-migration-generic-cms-v0.6.1.zip](https://github.com/iffinland/wordpress-to-qortal/releases/download/v0.6.1-alpha.2/qortal-migration-generic-cms-v0.6.1.zip)
   and verify it against `SHA256SUMS`.
2. Inspect the root: it contains `index.html` and `assets/` with no parent
   folder.
3. Publish it to QDN as an APP or WEBSITE through an owner-approved Qortal
   publication flow. Until that happens it is only a local file.

No Node.js, npm, Git, compiler or manual build is required for this path.

## Features

- Configurable title, tagline, navigation, colors and typography in cms.config.json.
- **Admin** in the default navigation. It renders before catalog gating, so a
  missing manifest is explained instead of the entry disappearing. Runtime
  navigation also injects Admin for an already published `qms-cms-config.json`
  that predates this change.
- Routes: home, posts, post, page, category, tag, archive, search and admin/import.
- Reads qms-cms-manifest@1, the Phase 5 qms-qdn-manifest@1 output, and the legacy
  cr-qdn-manifest shape through one read-only adapter.
- Honest loading, empty, partial, stale and error states.
- HTML and URL sanitization with DOMPurify.
- Owner-only import/adoption actions based on the signed-in account's QDN name
  ownership and an optional on-chain name record cross-check.
- Accessible layout with skip link, landmarks, labelled controls, focus styles,
  visible status regions and reduced-motion support.
- Valid root-layout Q-App build with relative assets and a bundle validator.

## For developers / Build from source

Do not use this section for a normal installation.

    npm install
    npm run dev
    npm run test
    npm run build
    npm run build -- --zip

Use a different configuration file with:

    CMS_TEMPLATE_CONFIG=/path/to/site.json npm run build

The development fixture catalog is available at:

    npm run dev
    open http://localhost:5191/#/home
    open http://localhost:5191/?source=fixture#/

An optional Qortal node URL can be supplied with the node query parameter or
VITE_QORTAL_NODE_URL. Production Q-App builds read the catalog from
DOCUMENT/<ownerName>/<manifestIdentifier> and fall back to the legacy identifier.

## Manifest identifiers

| Identifier | Default | Purpose |
| --- | --- | --- |
| CMS manifest | qms-cms-manifest | Generic CMS catalog |
| Legacy manifest | cr-qdn-manifest | Existing Corbett-compatible catalog |
| Engine manifest | qms-qdn-manifest@1 | Phase 5 exact publication output |

Content indexes and content resources are referenced from the manifest. The
template never rewrites published resources.

## Administrative actions

The admin/import route stages items in a local adoption queue. It does not sign
or publish anything. The page states its preconditions explicitly: a published
`qms-cms-manifest` with its indexes under this site's exact QDN name, and a
signed-in account that owns that name. Owner mode additionally requires:

1. A Qortal account from GET_USER_ACCOUNT.
2. The account's name list from GET_ACCOUNT_NAMES to include the configured QDN
   site name.
3. If GET /names/<name> is reachable, the name record owner must equal the
   account address.

Without a published catalog, owner identity or a verified name, the page remains
read-only. Admin stays reachable so the missing precondition is visible.

The site must be opened under a URL that carries its exact QDN name, for
example `qortal://WEBSITE/developer%20iffi/` or `?name=developer%20iffi`.
Otherwise the app cannot determine which name's catalog to read and shows an
empty or unverified state.

When redeploying an existing site, preserve its `qms-cms-config.json` in the
new bundle. It carries the site title, tagline, navigation, theme and manifest
identifier; without it the bundle falls back to the build-time defaults.

## Output

The build creates template/dist with index.html at the bundle root and relative
asset URLs. The validator checks the root layout, referenced assets and absence
of engine imports. With --zip it also writes
release/qortal-migration-generic-cms-v<version>.zip. The release pipeline
validates that ZIP as a root-layout Q-App and ships it with the .deb and the
Publisher ZIP.
