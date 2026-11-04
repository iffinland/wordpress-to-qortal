# Phase 5 — QDN publishing and exact read-back verification

| Field | Value |
| --- | --- |
| Document | Phase 5 implementation, security and verification guide |
| Date | 2026-11-03 |
| Status | Variant A implemented and locally tested; 0.6.1 adds a standalone Q-App build, ZIP packages and APP bundles. Real Hub-signed mixed-service QDN publication is still not exercised. |
| Scope | Portable handoff, universal Migration Publisher Q-App, account/name checks, controlled batching, exact QDN read-back, receipts, desktop reconciliation, Variant B assessment |
| Phase 4 baseline | b3b3b81f2baf45c02decfbabaa98e1e96700d57b |
| Phase 5 branch | agent/qortal-wordpress-to-qortal/20261103T070706Z-qortal-migration-studio-phase-5 |
| Engine | qms-engine@1, version 0.1.7-phase5 |
| Store version | 3 (adds qms-publication-state@1) |
| Companion | PHASE-5-VARIANT-B-FEASIBILITY.md |

This document describes what Phase 5 actually implements and what it does **not**
prove. Values marked unverified are not claims of live-network success.

## 1. Outcome

Phase 5 adds a truthful Variant A publication flow:

- Migration Studio prepares a portable, versioned handoff folder containing
  the exact bytes that will be published, their byte lengths, SHA-256 hashes,
  dependencies and a fee estimate;
- the universal Migration Publisher Q-App in Qortal Hub validates the package,
  obtains the active account through the Hub bridge, checks name ownership,
  checks existing resources, requires explicit approval, publishes controlled
  batches and records per-resource outcomes;
- the Publisher exports a versioned receipt;
- the desktop imports the receipt as Publisher-reported evidence and performs
  independent exact QDN read-back;
- only an exact byte/hash match marks a resource remote_verified or a content
  mapping published on QDN.

The desktop never requests, reads or stores a wallet seed, private key or wallet
password. It does not sign. Qortal Hub remains the signing and approval host.

## 2. Architecture

~~~text
+------------------------------+       handoff folder        +------------------------------+
| Qortal Migration Studio      |  handoff.json + payload/    | Migration Publisher Q-App    |
| Electron + React + TS        | --------------------------> | in Qortal Hub                |
|                              |                             |                              |
| lib/engine/publication       |                             | validates manifest/hashes    |
|  handoff, payloads, order,   |                             | account + name ownership     |
|  receipts, remote            |                             | explicit approval            |
|                              |                             | <=20 per multi-publish       |
|                              | <-------------------------- | per-resource results         |
+------------------------------+       receipt JSON          +------------------------------+
            |                                                            |
            | read-only Core HTTP /arbitrary/...?encoding=base64          | qortalRequest
            v                                                            v
      exact SHA-256 comparison                                  Hub approval + signing
~~~

- The desktop engine is authoritative for planning, identity reservation,
  package construction, receipt validation and independent verification.
- React is presentation only. It does not derive QDN identities or decide
  publication rules.
- The Q-App uses the documented Hub/Core bridge (qortalRequest) and does not
  assume the bridge is reachable through window.parent or window.top.

## 3. Portable handoff package

Files:

~~~text
hof_<id>/
  handoff.json
  README.txt
  payload/
    media/<sha256>.<ext>
    content/<stable-id>.json
    index/posts-index.json
    index/pages-index.json
    index/categories.json
    index/tags.json
    index/media-map.json
    index/url-map.json
    index/import-manifest.json
    manifest/qdn-manifest.json
~~~

handoff.json uses qms-publication-handoff@1:

~~~json
{
  "schema": "qms-publication-handoff@1",
  "version": 1,
  "handoffId": "hof_...",
  "publicationBatchId": "pub_...",
  "planId": "plan_...",
  "projectId": "prj_...",
  "siteId": "site_...",
  "siteNamespace": "ns...",
  "createdAt": "...",
  "target": { "qdnName": "...", "resourcePrefix": "qms" },
  "publisher": { "minVersion": "0.5.0", "bridge": "qortalRequest", "instructions": "..." },
  "estimate": {
    "resourceCount": 10,
    "feePerResource": 0.001,
    "estimatedFee": 0.01,
    "currency": "QORT",
    "label": "Estimate only. Qortal Hub shows the current network fee before approval.",
    "batches": 1
  },
  "resources": [
    {
      "id": "res_...",
      "kind": "content",
      "service": "DOCUMENT",
      "name": "TargetName",
      "identifier": "qms-ns...",
      "relativePath": "payload/content/....json",
      "contentType": "application/json; charset=utf-8",
      "bytes": 1234,
      "sha256": "sha256:...",
      "order": 0,
      "dependsOn": ["res_..."],
      "sourceKey": "post:123",
      "metadata": {}
    }
  ],
  "integrity": { "algorithm": "sha256", "value": "sha256:..." }
}
~~~

Integrity is SHA-256 over canonical JSON without the integrity field.

Validation before publication:

- supported schema and version;
- manifest integrity;
- project/site/target fields;
- unique resource IDs and unique (service,name,identifier) triples;
- resource name equals the handoff target name;
- supported service (DOCUMENT, JSON, IMAGE, AUDIO, VIDEO, FILE);
- identifier syntax and length;
- relative paths only, under payload/, no absolute paths, .., NUL or backslashes;
- regular files only, no symlinks;
- exact byte length and SHA-256 per file;
- dependency existence, phase ordering (media -> content -> index -> manifest)
  and acyclic dependencies;
- no secret-like manifest keys.

The package contains converted QDN-ready bytes, not source-discovery metadata.
Content payloads use qms-qdn-content@1; indexes use qms-qdn-index@1; the
site manifest uses qms-qdn-manifest@1. Media bytes are copied from the
content-addressed media store and re-hashed.

## 4. Publication state machine

Persisted qms-publication-state@1 adds:

- plans keyed by publicationBatchId;
- handoffs keyed by handoffId;
- resources keyed by resource id;
- history and revision.

Per-resource states:

| State | Meaning |
| --- | --- |
| reserved | identity planned; nothing prepared |
| prepared | local payload prepared for a plan, not handed off |
| handoff_ready | package written and every payload hash validated |
| submitted | Publisher/Hub reported a submission; no proof of availability |
| pending_confirmation | unconfirmed, pending download/build or inconclusive node read |
| remote_verified | independent read-back matched exact bytes and SHA-256 |
| failed | explicit failure (for example a reported unsuccessful publish) |
| partial | aggregate only: some resources complete, others not |
| ambiguous | no definitive result, partial response, or read-back mismatch; manual reconciliation |
| declined | user or Hub declined the request |
| blocked | prerequisite, ownership, node authorization or collision prevents progress |

Allowed transitions:

~~~text
reserved -> prepared -> handoff_ready
handoff_ready -> submitted -> pending_confirmation -> remote_verified
handoff_ready -> blocked
submitted -> failed | ambiguous | declined
pending_confirmation -> remote_verified | ambiguous | failed | blocked
ambiguous -> remote_verified only after a later exact read-back
failed/declined/blocked -> submitted only after explicit user-approved retry
~~~

Reserved, prepared and handoff_ready are never described as published.
A receipt status of remote_verified is stored as pending_confirmation until
the desktop independently reads the bytes back.

Identity mapping compatibility:

- publicationStatus stays in reserved | prepared | remote_verified | published;
- localPreparation stays in reserved | partial | prepared;
- preparing a handoff sets localPreparation = prepared, never
  publicationStatus = published;
- only exact read-back sets publicationStatus = remote_verified;
- identifiers remain stable across content revisions.

## 5. Account, name and destination checks

The Publisher obtains the active account with GET_USER_ACCOUNT and the
account's names with GET_ACCOUNT_NAMES. The target name must be present in the
returned ownership list; otherwise publication is blocked before approval.

The authoritative check remains in Hub/Core. The local check is a preflight and
does not replace Hub's own getAllUserNames check before publishing.

### 5.1 Exact registered names

Qortal Core validates a name by UTF-8 byte length (3..40), NFKC display
normalization (no leading/trailing or repeated whitespace, no zero-width
characters) and an address check. Core has no ASCII character whitelist:
internal spaces and Unicode letters are valid. Phase 5.1 removed the obsolete
local regex. See
`docs/migration-studio/PHASE-5.1-QORTAL-NAME-VALIDATION.md` for the Core audit
and evidence.

Identity, ownership, handoff targets, resource names and receipts use the exact
registered display string. Core's `reducedName` is a uniqueness/search key only
and is never accepted as identity. Ownership requires both the exact returned
`name` and the exact `owner` address; a case-folded match, reducedName match,
missing name, wrong owner or unavailable node is `blocked`.

Before approval, the Publisher can query:

- GET_QDN_RESOURCE_STATUS for presence;
- GET_QDN_RESOURCE_PROPERTIES for remote byte length and MIME type.

It distinguishes:

- new: not published;
- update: existing resource with the same byte length;
- collision: existing resource with a different byte length;
- unknown: status/properties unavailable.

A collision or unknown state is visible before approval. Publishing over a
collision requires the explicit "authorize updates to existing resources"
checkbox. Invalid identifiers, unsupported services and a mismatched target name
fail closed.

## 6. Publisher Q-App

The existing Publisher was replaced by a universal handoff workflow. Historical
bundled example-site data, mode buttons and example defaults are removed from
the active path.

Features:

- folder selection and package validation;
- active account display and name ownership precondition;
- resource/dependency review with per-resource SHA-256;
- remote presence and collision review;
- fee estimate clearly labelled as an estimate;
- explicit approval checkbox;
- controlled multi-publish batches, maximum 20 resources;
- per-resource status and reason;
- stop on pending/ambiguous/failed results to avoid exhausting the unconfirmed
  transaction pool;
- receipt export (SAVE_FILE, then browser download fallback);
- session persistence in localStorage keyed by handoff id;
- no wallet secret fields.

The Q-App does not deploy itself. Publisher Q-App QDN deployment remains
unauthorized in this phase.

## 7. Batching, ordering and outcome normalization

- MAX_BATCH_RESOURCES = 20, below Qortal Core's default
  maxUnconfirmedPerAccount = 25.
- Dependencies are scheduled in waves; a dependent is not in the same batch as
  its prerequisite.
- Publication order: media, content, indexes, final manifest.
- Before a dependent is submitted, its selected dependencies must be
  remote_verified (or already verified from a previous session).
- A failed index/manifest creates a repair task; it never invalidates content
  that was already verified.
- The desktop does not publish at all. The Publisher does not run a background
  publisher after the user leaves the page.
- After a batch, if any resource is pending or ambiguous, the Publisher stops
  and requires an explicit resume.

Outcome handling:

| Qortal response | Handling |
| --- | --- |
| success array | mark submitted, then exact read-back each resource |
| error.unsuccessfulPublishes | mark listed resources failed/declined/blocked; all others ambiguous, then read-back |
| thrown request error | mark all ambiguous (or declined for a clear decline); never resubmit automatically |
| timeout | ambiguous; read-back may discover successes, but no resubmission |
| insufficient balance | failed; no automatic retry |

## 8. Exact QDN verification

Verification uses the supported read-only Core API:

~~~text
GET /arbitrary/resource/properties/{service}/{name}/{identifier}
GET /arbitrary/resource/status/{service}/{name}/{identifier}?build=true
GET /arbitrary/{service}/{name}/{identifier}?encoding=base64
~~~

encoding=base64 is mandatory for exact comparison. Qortal's Q-App
FETCH_QDN_RESOURCE transport returns parsed text/JSON in some paths, which is
lossy for binary data. Phase 5 therefore:

- uses base64 for the exact HTTP read, decodes it and hashes the bytes;
- uses the Q-App bridge with encoding=base64 and rejects parsed objects;
- never claims exact hash equality from a parsed object;
- compares both byte length and SHA-256;
- treats READY, approval or a transaction signature as insufficient alone;
- polls a bounded number of times (default 6, 1.5 s interval);
- records timestamps, transport, expected/remote hash and byte counts;
- leaves pending/unavailable/inconclusive results unverified;
- preserves ambiguous results for manual reconciliation.

The status endpoint is advisory. Even READY still requires the exact byte read.

Names in HTTP path segments are raw values encoded exactly once with
`encodeURIComponent`: spaces become `%20`, never `+`, and `%` is escaped to
`%25`. The ownership lookup and exact read-back share this rule, and an
already-encoded name must not be passed in (no double encoding).

## 9. Receipts and desktop synchronization

Receipt schema: qms-publication-receipt@1.

~~~json
{
  "schema": "qms-publication-receipt@1",
  "version": 1,
  "receiptId": "rcp_...",
  "handoffId": "hof_...",
  "publicationBatchId": "pub_...",
  "planId": "plan_...",
  "projectId": "prj_...",
  "siteId": "site_...",
  "target": { "qdnName": "...", "resourcePrefix": "qms" },
  "publisher": { "accountAddress": "Q...", "name": "...", "appVersion": "0.5.0-phase5", "network": null },
  "createdAt": "...",
  "completedAt": "...",
  "results": [
    { "resourceId": "res_...", "service": "DOCUMENT", "name": "...", "identifier": "...", "status": "submitted", "txSignature": "...", "reason": null }
  ],
  "counts": { "submitted": 1 },
  "integrity": { "algorithm": "sha256", "value": "sha256:..." }
}
~~~

Import validation:

- schema, version and integrity;
- receipt id and handoff/publication/plan ids;
- project id and site id must match the target project;
- target name must match;
- every result resource must exist in the handoff and match the exact triple;
- duplicate resource ids are rejected;
- unknown fields do not grant file access;
- the receipt is never allowed to reference arbitrary local paths.

Missing resources in a receipt are imported as ambiguous. Receipt import never
sets remote_verified. Exact verification is a separate action. Receipts and
verification evidence are stored with mode 0600.

## 10. Desktop GUI

The Electron app adds a Publishing section:

- selects a completed plan;
- shows actionable resources and their QDN identifiers;
- requires explicit selection;
- shows estimated fee and its estimate-only label;
- generates the handoff and opens its folder;
- explains opening the Publisher in Qortal Hub;
- imports a receipt JSON;
- runs independent verification with a read-only node URL;
- shows per-resource state, reason, receipt signature and verification transport;
- preserves state after restart;
- keeps reserved, locally prepared and remote-verified labels distinct.

The renderer gets no filesystem or Node access. Receipt content is read with a
browser file picker and then validated by the main process/engine. IPC channels
are allowlisted and payload-validated.

## 11. Security

Implemented controls:

- no seed/private key/wallet password fields or storage;
- no desktop transaction signing;
- no unapproved blockchain writes in automated tests;
- no QDN publish during tests unless explicitly authorized;
- no Publisher Q-App deployment;
- handoff path containment, symlink rejection and exact hash validation;
- receipt cross-project rejection and integrity validation;
- no generic renderer IPC bridge;
- node URL validation rejects non-HTTP(S), credentials, query and fragment;
- verification rejects parsed-object/transported text as exact proof;
- read-only HTTP verification only;
- diagnostics redaction remains in place.

## 12. Verification evidence

### 12.1 Tests

~~~bash
npm test                 # 170 tests
npm run test:phase5      # 24 tests
cd desktop && npm test   # 28 tests
~~~

Phase 5 tests cover:

- valid/invalid handoff packages;
- exact resource identity and byte hashing;
- tampered payloads, duplicate triples, traversal and unsupported services;
- two independent sites with overlapping source IDs;
- media packaging and missing-media blocking;
- controlled batches <= 20 and dependency waves;
- success arrays, partial unsuccessfulPublishes, thrown/declined/timeout errors;
- content/index/manifest ordering;
- binary and JSON base64 read-back;
- pending, stale/unavailable and mismatched responses;
- receipt export/import, integrity and cross-project rejection;
- restart recovery and history;
- host publication methods;
- desktop IPC validation and renderer workflow;
- no wallet secret fields and no false published labels;
- exact space-containing names, UTF-8 byte bounds, NFKC normalization,
  reducedName non-identity, URL encoding and exact name+owner checks
  (Phase 5.1).

### 12.2 Builds

- npm run migration:build (Publisher Q-App): passed (tsc + Vite).
- desktop npm run typecheck: passed.
- desktop npm run build: passed.
- Debian package (Phase 5.1 rebuild): qortal-migration-studio-0.5.0-amd64.deb, 107,989,438 bytes, sha256 de99094e6d886198d0413dca4520d055e30095d0750b2cad4bbf58b3fe65f538.
- Package verification: passed; dependencies and layout inspected with dpkg-deb.
- Headless packaged launch was not rerun in Phase 5.1 because Xvfb/xkbcomp are
  absent in this environment; the Phase 5 baseline smoke evidence remains
  historical and the 5.1 changes affect validation, not application startup.

### 12.3 Cross-validation of the Q-App package validator

The browser-side validator in viewer/src/publisher/handoff.ts was run against an
engine-generated handoff with Node 24 type stripping:

~~~text
QAPP_VALIDATE_OK 10 8914 {"content":2,"index":7,"manifest":1}
QAPP_TAMPER_REJECTED Payload byte length mismatch for res_...
~~~

This proves the two implementations agree on canonical manifest integrity,
payload hashes, ordering and tamper rejection for the tested package.

## 13. Live-network limitation

No real Qortal Core API or Qortal Hub wallet session was available in this VPS
environment. Ports 12391 (Qortal Core) and 12388 (Hub dev server) were not
listening. A virtual X display was used only for the packaged Electron launch
smoke; it was not a Hub session. Therefore:

- no real Qortal transaction was created;
- no real QDN resource was published;
- no Hub approval/signing flow was executed;
- no real network fee was quoted;
- no real QDN read-back against a live network was performed.

The exact read-back path was proven against a local HTTP fixture implementing
the same Core endpoints, including encoding=base64. Fixture evidence is not
reported as live proof.

To complete live acceptance, an operator must:

1. run a Qortal Core node and Qortal Hub with an account that owns the chosen
   test name;
2. set an explicit target network and synthetic resource set;
3. generate a handoff with synthetic content;
4. run the Publisher Q-App in Hub and approve the fee;
5. import the receipt into the desktop;
6. run independent read-back against that Core node;
7. record transaction signatures, resource identifiers, fees and exact hashes.

## 14. Remaining risks

- Hub's qortalRequest bridge availability and response shapes can drift. The
  implementation is based on Qortal-Hub and Qortal Core source at the commit
  recorded in the final report.
- Direct fetch to Core read-only endpoints may require QDNAuthBypass or a
  public read node; otherwise verification reports blocked.
- The Publisher's ownership preflight is not a substitute for Hub's
  authoritative check.
- Large handoffs are processed in memory in the Q-App; media uses File
  objects, but very large sets still need operational care.
- The desktop GUI was tested in jsdom, not a full graphical desktop session.
- No live fee/transaction/network acceptance has been completed.

## 15. Phase 6 recommendations

- Complete one authorized live publication with synthetic resources and record
  exact read-back, fee and transaction evidence.
- Consider a generic CMS manifest consumer only after the live handoff contract
  is stable.
- Keep the receipt schema versioned and add a migration path before changing
  resource identities or fields.
- Add a repair-task model for failed indexes/manifests without invalidating
  verified content.
- Keep Variant B deferred unless a threat-modeled, authenticated, one-time
  transfer design is fully implemented and tested.

## 16. 0.6.1 integration update — standalone Publisher, ZIP packages and APP bundles

Phase 5.3-style integration is implemented in the 0.6.1 alpha candidate:

- **Standalone Q-App build.** `viewer/vite.publisher.config.ts` builds
  `viewer/dist-publisher` from `viewer/publisher/index.html` with no profile,
  preview data, local content server or hardcoded owner name. The bundle
  validator rejects absolute asset URLs, source maps, profile/Corbett
  identities and parent/top-frame bridge assumptions.
- **Portable distribution artifact.**
  `npm run publisher:package` writes
  `release/qortal-migration-publisher-v0.6.1.zip` plus a SHA-256 checksum.
- **One-file handoff.** The desktop exports
  `<data-root>/exports/<handoffId>-publisher.zip`; the Publisher accepts that
  ZIP or the folder. A ZIP with one root folder is normalized safely; traversal,
  duplicate paths, oversized entries and encrypted archives fail closed.
- **CMS application-bundle resources.** A handoff may contain one `kind: "site"`
  resource with service `APP` or `WEBSITE`. Both may share the same registered
  name because the service+name+identifier triple stays unique. Its payload is the exact deterministic CMS ZIP; its
  `metadata.bundle.files` list is the exact member read-back contract. The
  Publisher submits it with `isMultiFileZip: true` after the manifest and reads
  each member through `?filepath=...&encoding=base64`.
- **Live fee quote.** The Publisher queries the node's
  `/transactions/unitfee?txType=ARBITRARY` and displays the timestamped quote.
  Hub's approval remains authoritative.
- **Deployment status.** The artifact is **not deployed**. Deployment needs an
  owner name and wallet approval outside the development broker's scope; see
  `PUBLISHER-QAPP-DEPLOYMENT.md`.

The development broker still permits DOCUMENT-only `qms-dev-` resources on the
exact `developer iffi` name. No IMAGE or APP live publish is claimed.
