# Migration Publisher Q-App — distribution and deployment

Status: **artifact built and validated; not publicly deployed.** Deployment
requires the owner's registered Qortal name, an owner wallet approval and a QDN
APP fee. Those are owner-controlled external writes and are not performed by
this repository's automated release process.

## What the artifact is

- Generic Q-App: no owner name, profile, preview data or local content root is
  compiled into it.
- Any Qortal name owned by the active Hub account can be targeted.
- Built at `viewer/dist-publisher` and packaged as
  `release/qortal-migration-publisher-v<version>.zip`.
- Root layout: `index.html`, `assets/*`, `publisher-bundle.json`.
- Validation: `npm run publisher:validate`.

## Supported deployment mechanism

QDN Q-Apps are multi-file APP resources. Core accepts a ZIP only through:

~~~text
POST /arbitrary/APP/<name>/<identifier>/zip?fee=<atomic>&isZip=true
Content-Type: text/plain
Body: base64(zip)
~~~

Then the exact Core transaction flow is `/transactions/convert`,
Ed25519 signature by the owner wallet, and `/transactions/process`. Qortal Hub's
publish UI and dev-mode preview accept Q-App ZIPs for preview; a permanent
public APP deployment is an owner wallet action.

A single generic deployment should be used for all users:

| Field | Recommended value |
| --- | --- |
| name | the owner's registered Qortal name |
| identifier | `qms-publisher` (stable across updates) |
| service | `APP` |
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

2. Build and validate the artifact:

~~~bash
npm run publisher:build
npm run publisher:validate
npm run publisher:package
sha256sum release/qortal-migration-publisher-v*.zip
~~~

3. Quote the actual network fee (atomic units):

~~~bash
curl -s "http://127.0.0.1:12391/transactions/unitfee?txType=ARBITRARY"
~~~

`1000000` atomic units equals 0.01 QORT. Confirm the fee in the owner wallet
approval; never assume the estimate.

4. Publish the ZIP through an owner-controlled Qortal UI/Core flow that signs
   with the owner wallet. The Publisher Q-App cannot deploy itself.
5. Exact read-back:

~~~bash
curl -s -o /dev/null -w "%{http_code} %{content_type}\n" \
  "http://127.0.0.1:12391/arbitrary/APP/<name>/qms-publisher?filepath=index.html"
~~~

6. Open Qortal Hub → Apps → Migration Publisher. Confirm the title, that no
   account name is hardcoded, and that selecting a handoff ZIP works.

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
