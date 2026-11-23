# Independent CMS content connection

Status: Generic CMS 0.9.0-beta.3, owner runtime acceptance passed for RC.2 on 2026-11-23.

## Deployment and ownership

Publisher writes content as DOCUMENT/media resources under the selected Qortal
name. A CMS is a separate APP or WEBSITE presentation resource. Either may be
installed first. Replacing an APP Publisher with the CMS does not replace the
DOCUMENT resources. APP and WEBSITE under the same name can consume the same
catalog. This does not imply connecting content from a different Qortal name;
that would require a separately designed delegation contract.

Hosting identity comes from the trusted QDN address/Hub context, never visitor
query parameters. Owner administration requires current name-ownership
verification. An explicit owner-matching runtime configuration remains supported
and is rebound to the actual presentation service rather than rejected because
its original service was different.

## Discovery contract

`src/lib/contentDiscovery.js` exports the shared browser adapter:

- `discoverSiteContent(hosting)`: reads a public connection or searches the
  connected node's DOCUMENT metadata in explicit `mode=ALL` (the default mode can collapse an owner's resources and hide the import) for the hosting name. Search is paginated
  in pages of 100, capped at 10,000 metadata rows. Both direct Core search and
  the Hub search fallback are scoped to the exact name; returned rows are
  independently filtered.
- Supported candidate identifiers: generated `*-man-site-manifest-*`,
  `qms-cms-manifest`, and `cr-qdn-manifest`. The existing versioned manifest
  adapter validates catalog identity, entrypoints and publisher references.
- One verified candidate connects automatically without a transaction. Several
  candidates require owner selection. Unreadable candidates or incomplete
  searches are reported as unavailable, never silently treated as empty.
- `bindDiscoveredContent(defaults, hosting, candidate)` binds content coordinates
  while retaining the custom frontend's title/theme/navigation defaults.

QDN node visibility/propagation can lag. A successful upload and exact read-back
are necessary publication evidence, but do not prove that a separate frontend
has discovered the catalog. Refresh repeats discovery; it does not re-upload.

## Optional durable selection

The verified owner can publish one DOCUMENT under the hosting name:

| Presentation identifier | Connection identifier |
| --- | --- |
| `default` | `qms-cms-connection` |
| Other identifier | `qms-cms-connection-` plus the first 32 hex characters of SHA-256 of its UTF-8 value |

The connection deliberately omits presentation service, so APP and WEBSITE with
identical name/identifier share the selection. Different presentation identifiers
can select different catalogs. The document is public and contains no secrets:

```json
{
  "schema": "qms-cms-connection@1",
  "version": 1,
  "name": "jussi-olen",
  "deploymentIdentifier": "default",
  "siteId": "<manifest site_id>",
  "manifest": {
    "service": "DOCUMENT",
    "name": "jussi-olen",
    "identifier": "<published manifest identifier>"
  }
}
```

The manifest is re-read before requesting approval. Publication uses existing
ownership checks, durable pending state and exact read-back. Discovery never
signs or writes by itself. The pointer and referenced manifest must agree on
owner and site identity. Generated manifest identifiers are stable across
same-project updates; updating their content does not require a new connection.

## Native content and edits

With no import, the CMS uses the deterministic site id `cms:<normalized Qortal
name>`. Its native index is `qms-cms-native-index`. Once an import connects, the
repository accepts that owner's pre-import native index alongside the imported
site and preserves its items on the next publication. Arbitrary foreign site
identities are still refused. The existing native index and edit overlay are
name-level resources; independent native libraries per deployment identifier
are not introduced by this change.

Imported edits continue through `qms-cms-edit-overlay`, including replacement
text and featured media references. Imported originals remain unchanged. The
repository merges imports, native content and overlays after reinstallation;
local browser state is not required to recover published edits.

## Bespoke frontends

A Web2-style clone should use the same contract rather than copying content
into its frontend ZIP. For a clone based on this template, reuse these modules:

```js
const hosting = discoverHostedQdnResource();
const found = await discoverSiteContent(hosting);
// Handle ambiguous/unavailable states before constructing a repository.
const config = bindDiscoveredContent(cloneDefaults, hosting, found.selected);
const repository = createCmsRepository(config);
```

Keep the owner-only connection UI, use the repository for imported/native/edited
content, and retain the ownership-verified editor for writes. Merely cloning
HTML does not automatically implement this contract. Custom visual defaults
are tested independently from the content binding.

## Validation scope

Automated fixtures cover independent APP/WEBSITE installation, CMS-first native
publication followed by import, mixed content authoring, text/featured-image
overlays, reinstall with empty local storage, multiple catalogs, pagination,
foreign publishers and unavailable QDN resources. The App tests exercise public
rendering and the owner editor without a bundled runtime configuration.
The owner confirmed that RC.2 displays the imported post correctly in Hub.

## RC.2 search regression

RC.1 omitted `mode=ALL` in both HTTP and Hub searches. A later settings document could therefore be returned while the earlier import catalog was omitted. RC.2 explicitly sets ALL for connection lookup and paginated catalog discovery on both transports. Regression tests model this default-mode collapse and fail against RC.1. A read-only public-node comparison for the reported owner reproduced the difference; the import manifest is present.
