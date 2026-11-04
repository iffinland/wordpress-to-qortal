# Migration Publisher Q-App — distribution and deployment

Status: **artifact built and validated; not publicly deployed.** Deployment
requires the owner's registered Qortal name, an owner wallet approval and one
QDN application-bundle fee. Those are owner-controlled external writes and are
not performed by this repository's automated release process.

The Publisher and the Generic CMS can both live under the **same registered
Qortal name**. Use APP for one and WEBSITE for the other; the service plus
identifier makes each triple distinct. No second Qortal name is required.

**Downloading the ZIP is not deployment.** The file at the release URL is only
a package. It becomes a public Q-App only after an owner publishes it to QDN
with wallet approval.

## Use the published Publisher without development tools

Most people should not build anything:

1. Download
   [qortal-migration-publisher-v0.6.1.zip](https://github.com/iffinland/wordpress-to-qortal/releases/download/v0.6.1-alpha.1/qortal-migration-publisher-v0.6.1.zip)
   and verify it against `SHA256SUMS`.
2. An owner publishes that ZIP as one shared QDN application bundle, using the
   service/identifier values in the table below. One deployment serves every
   user; each user does not need to deploy their own copy.
3. Users open the deployed Publisher from Qortal Hub and select their QMS
   handoff ZIP.

No Node.js, npm, Git or compiler is needed for this path. Building the ZIP from
source is a separate developer workflow at the end of this document.

## What the artifact is

- Generic Q-App: no owner name, profile, preview data or local content root is
  compiled into it.
- Any Qortal name owned by the active Hub account can be targeted.
- The official release asset is `qortal-migration-publisher-v<version>.zip`.
- Root layout: `index.html`, `assets/*`, `publisher-bundle.json`.
- For developers: built at `viewer/dist-publisher` and validated with
  `npm run publisher:validate`.

## Supported deployment mechanism

QDN application bundles are multi-file APP or WEBSITE resources. Core accepts a
ZIP through the same generic service path:

~~~text
POST /arbitrary/<APP|WEBSITE>/<name>/<identifier>/zip?fee=<atomic>&isZip=true
Content-Type: text/plain
Body: base64(zip)
~~~

Then the exact Core transaction flow is `/transactions/convert`,
Ed25519 signature by the owner wallet, and `/transactions/process`. Qortal Hub's
publish UI and dev-mode preview accept Q-App ZIPs for preview; a permanent
public deployment is an owner wallet action.

A single generic deployment should be used for all users:

| Field | Recommended value |
| --- | --- |
| name | the owner's registered Qortal name (shared with the CMS) |
| identifier | `qms-publisher` (stable across updates) |
| service | `WEBSITE` or `APP` (the other service hosts the CMS) |
| file | `qortal-migration-publisher-v<version>.zip` |
| title | `Migration Publisher` |
| description | `Publish Qortal Migration Studio handoffs through Qortal Hub` |

Do not publish the Publisher under a migrated user's name, and do not use the
development broker or its `developer iffi` scope for this deployment.

## Owner deployment checklist

1. Verify the name and owner:

~~~bash
curl -s "http://127.0.0.1:12391/names/$(node -e "process.stdout.write(encodeURIComponent(process.argv[1]))" "Your Name")"
~~~

2. Obtain and verify the artifact. Most owners download the published ZIP:

~~~bash
sha256sum qortal-migration-publisher-v0.6.1.zip
grep qortal-migration-publisher-v0.6.1.zip SHA256SUMS
~~~

Developers building from source should follow the developer section below and
compare their ZIP hash with the release manifest.

3. Quote the actual network fee (atomic units):

~~~bash
curl -s "http://127.0.0.1:12391/transactions/unitfee?txType=ARBITRARY"
~~~

`1000000` atomic units equals 0.01 QORT. Confirm the fee in the owner wallet
approval; never assume the estimate.

4. Publish the ZIP through an owner-controlled Qortal UI/Core flow that signs
   with the owner wallet. The Publisher Q-App cannot deploy itself. Use the
   service chosen above; the same name can also host the CMS under the other
   service.
5. Exact read-back (substitute the chosen service):

~~~bash
curl -s -o /dev/null -w "%{http_code} %{content_type}\n" \
  "http://127.0.0.1:12391/arbitrary/WEBSITE/<name>/qms-publisher?filepath=index.html"
~~~

6. Open the Publisher from Qortal Hub/Home (Apps for APP; the QDN website URL
   for WEBSITE). Confirm the title, that no account name is hardcoded, and that
   selecting a handoff ZIP works.

### Same-name deployment matrix

| CMS service | Publisher service | Status |
| --- | --- | --- |
| APP | WEBSITE | supported; recommended separation |
| WEBSITE | APP | supported |
| APP | APP | supported with distinct identifiers |
| WEBSITE | WEBSITE | supported with distinct identifiers |

Only the service+name+identifier triple must be unique. Studio never allocates a
second Qortal name for an application bundle.

### For developers: build and validate the ZIP

Source building is not the beginner path. From a clean checkout:

~~~bash
npm ci && (cd viewer && npm ci)
npm run release:prepare
~~~

This builds the .deb and both Q-App ZIPs, validates their root layout, versions
and compatibility schemas, and writes `release/release-manifest.json` and
`release/SHA256SUMS`. Never upload a hand-built ZIP that has not passed the
three-artifact gate.

## Why this is not automated here

The existing development broker is scoped to the exact name `developer iffi`,
`DOCUMENT` resources, a `qms-dev-` identifier prefix and a 5 QORT rolling
budget. It is a test control, not a general deployment wallet. Using it for an
APP deployment would violate its policy and the project's authorization
boundary.

## User access

Once deployed, every user opens the same Q-App from Qortal Hub. No per-user
deployment is needed. The Q-App reads the active account with
`GET_USER_ACCOUNT`, checks the exact name and owner with `GET_ACCOUNT_NAMES`,
loads fees from the node, and publishes through
`PUBLISH_MULTIPLE_QDN_RESOURCES`.
