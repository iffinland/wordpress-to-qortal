# Qortal Migration Studio - Generic CMS Template

A neutral, accessible Qortal Q-App site template that renders a published QDN
catalog. It is independent from the Corbett Report custom clone and does not
import engine or Corbett code.

## Features

- Configurable title, tagline, navigation, colors and typography in cms.config.json.
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

## Development

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
or publish anything. Owner mode requires:

1. A Qortal account from GET_USER_ACCOUNT.
2. The account's name list from GET_ACCOUNT_NAMES to include the configured QDN
   site name.
3. If GET /names/<name> is reachable, the name record owner must equal the
   account address.

Without a verified owner identity the page remains read-only.

## Output

The build creates template/dist with index.html at the bundle root and relative
asset URLs. The validator checks the root layout, referenced assets and absence
of engine imports. With --zip it also writes
release/qms-generic-cms-template-v<version>.zip.
