# Phase 5.2 — External Auth publishing failure analysis and fix

Status: fee fix deployed; the remaining HTTP 400 is traced to the next Core
gate (API key enforcement) and the diagnostic contract is fixed. Operator
deployment is pending.
No QDN transaction was submitted during this work.

> **Update 2026-11-03 (later):** the atomic-fee broker fix is deployed and the
> broker now sends `fee=1000000`. The publish still returns HTTP 400
> (`pub_bb1a16b4915a4ee8df9ef917`, identifier `qms-dev-final-001`,
> `CORE_REQUEST_REJECTED`). Section 12 identifies the next gate, records the
> confirmed diagnostic-contract defect and describes the corrected deployment.
> The previously stored fee patch was **corrupt and never applicable**; both
> patches were regenerated and verified from the pinned commit.

## 1. Scope and pinned sources

| Component | Revision |
| --- | --- |
| Tool repository | base `dca823d8be505c6d4123abd33d0ad43868f74316` |
| Qortal External Auth | 0.2.0, `7e5d498221cf15ccbc01e7241efbcd0c6e76d09c` |
| Qortal Core (reference read) | `master` `ArbitraryResource.java`, `NameValidation`/name rules |
| Qortal UI (fee convention) | `plugins/plugins/core/qdn/publish/publish.src.js` |
| Qortal Hub (fee convention) | `src/qdn/publish/publish.ts` |

The signing VPS was not accessed. All conclusions below come from the pinned
source, the Qortal primary sources, and local reproductions in this repository.

## 2. Observed failures

| Publication | Identifier | Result | Resource verification |
| --- | --- | --- | --- |
| `pub_6b1dbeb87370fd7bfab9f28c` | `qms-dev-hello-001` | `failed` / `SIGNING_FAILED` | `SIGNING_REJECTED` (HTTP 401/403) |
| `pub_8c1650c0aa97b978b92b442b` | `qms-dev-hello-002` | `failed` / `SIGNING_FAILED` | `SIGNING_FAILED` (non-401/403, non-5xx) |

Neither attempt produced a signature, transaction or fee.

## 3. Every POST /qdn/publish error path (External Auth 0.2.0)

Route: `packages/auth-daemon/src/index.ts:4486`. Body schema requires
`walletId`, `data`, `service`, `registeredName`.

| Order | Condition | HTTP | Body | Broker outcome |
| --- | --- | --- | --- | --- |
| 1 | Fastify body-schema validation (missing/invalid required field, wrong type) | 400 | Fastify `{statusCode,error,message}` (no `error` string token) | `SIGNING_FAILED`, code `UNKNOWN` after the fix; previously hidden |
| 2 | Missing/malformed/expired Bearer token (`requireSession`) | 401 | `{"error":"unauthorized"}` | `SIGNING_REJECTED` |
| 3 | Body has a session but no `walletId` | 400 | `{"error":"walletId is required"}` | `SIGNING_FAILED` / `WALLET_ID_REQUIRED` |
| 4 | Permission mode `approval` and no approval token | 403 | `{"error":"approval_required","scope":"PUBLISH_QDN_RESOURCE","walletId":...}` | `SIGNING_APPROVAL_REQUIRED` |
| 5 | Wallet is not unlocked and no `password` supplied | 403 | `{"error":"wallet_locked"}` | `SIGNING_REJECTED` / `WALLET_LOCKED` |
| 6 | `walletId` not registered for this appId (`getWalletMeta`) | 400 | `{"error":"wallet_not_found"}` | `SIGNING_FAILED` / `WALLET_NOT_FOUND` |
| 7 | Missing service/name after validation | 400 | `{"error":"service and registeredName are required"}` | `SIGNING_FAILED` |
| 8 | `uploadType=file`: missing/not-a-file path | 400 | `filePath is required...` / `filePath must point to a file` | `SIGNING_FAILED` |
| 9 | `uploadType=string`: empty text | 400 | `{"error":"string data is required"}` | `SIGNING_FAILED` |
| 10 | `uploadType=zip`: empty data | 400 | `{"error":"zip data is required"}` | `SIGNING_FAILED` |
| 11 | `uploadType=base64`: empty data | 400 | `{"error":"data is required"}` | `SIGNING_FAILED` |
| 12 | Core `POST /arbitrary/{service}/{name}[/{id}]/base64?fee=...` non-2xx, or finalize non-2xx | 400 | `{"error":"<raw Core response text>"}` | `SIGNING_FAILED` / `CORE_REQUEST_REJECTED` |
| 13 | Core returns empty bytes or an error JSON instead of unsigned bytes | 400 | `{"error":"publish returned empty unsigned bytes"}` or parsed Core message | `SIGNING_FAILED` |
| 14 | Core `/transactions/convert` or `/transactions/process?apiVersion=2` non-2xx | 400 | `{"error":"<raw Core response text>"}` | `SIGNING_FAILED` |
| 15 | Any thrown error not classified above (catch-all at line 4577) | 400 | `{"error":<message>}` | `SIGNING_FAILED` |
| 16 | Success | 200 | `{"result":{...signature, creatorAddress}}` | `signed` |

Core-side rejections reachable through row 12/14 include:
`Name not registered: <name>`, `ADDRESS_UNKNOWN`, `BLOCKCHAIN_NEEDS_SYNC`,
`Data not supplied`, query-parameter conversion failures, and
`Unable to upload data: <reason>`.

Broker mapping in `broker/src/signing/external-auth.js`:

- 401/403 → `rejected`; `approval_required` becomes `SIGNING_APPROVAL_REQUIRED`,
  anything else `SIGNING_REJECTED`.
- 5xx → `ambiguous` `SIGNING_BACKEND_UNAVAILABLE` (never retried).
- any other non-2xx → `failed` `SIGNING_FAILED`.
- transport error/timeout → `ambiguous` `SIGNING_TRANSPORT_UNKNOWN`.

## 4. Confirmed defect: QORT vs atomic fee

### 4.1 What the broker sent

`broker/src/fees.js` quotes and reserves the atomic unit fee. For the test
publication the quote was `1,000,000` atomic (`0.01 QORT`). Before this fix,
`broker/src/service.js` converted it:

```js
feePerTransaction: Number(atomicToQort(resource.feeAtomic)) // 0.01
```

`broker/src/signing/external-auth.js` forwarded that number as the JSON field
`fee`. External Auth 0.2.0 forwards `fee` verbatim into the Core query string
(`packages/auth-daemon/src/index.ts:2874-2886`, `buildQuery` at 1452).
Therefore the first Core request was exactly:

```
POST /arbitrary/DOCUMENT/developer iffi/base64?fee=0.01
Authorization: (External Auth → Core; server-side only)
```

Node's `fetch` encoded the path space on the wire (see §5), so Core received:

```
POST /arbitrary/DOCUMENT/developer%20iffi/base64?fee=0.01
```

### 4.2 Why Core rejects it

Qortal Core binds `fee` to a Java `Long` in **atomic units**:

- `ArbitraryResource.java:1619-1665` — `POST /{service}/{name}/base64`,
  parameter declared as `@QueryParam("fee") Long fee` at line 1651.
- `ArbitraryResource.java:2038` — `upload(...)` takes the same `Long fee` and
  passes it to `ArbitraryDataTransactionBuilder`, whose field is `long fee`
  (atomic transaction fee).
- Qortal UI obtains `/transactions/unitfee?txType=ARBITRARY` and passes the
  **raw integer** to `?fee=` (`publish.src.js:485-493`, `611`); only the display
  value is divided by `1e8`.
- Qortal Hub does the same (`src/qdn/publish/publish.ts:229-236`, `397`).

`0.01` cannot bind to `Long`. The request fails during parameter binding,
**before** `upload()` looks up the registered name. That produces a Core 4xx.
External Auth's catch-all turns every publish error into HTTP 400 with
`{"error":"<Core text>"}`, so the broker saw `SIGNING_FAILED` — matching the
second failure exactly.

### 4.3 Local reproduction

`test/phase5.2/external-auth-contract.test.js` runs a local Core stand-in with
the same binding rule and a local External Auth stand-in that reproduces 0.2.0's
path and fee forwarding:

- atomic `1000000` → `200`, Core saw
  `/arbitrary/DOCUMENT/developer%20iffi/base64?fee=1000000`.
- legacy `0.01` → `404` `Bad query parameter [fee]: 0.01`, which External Auth
  converts to `400` and the broker to `SIGNING_FAILED`.
- the fixed broker never sends `0.01`; it rejects a fractional atomic fee before
  any HTTP request.

### 4.4 First vs second failure

- First attempt: `SIGNING_REJECTED` = 401 or 403. The only 401 is a missing,
  malformed or expired session token; the 403s are `approval_required` and
  `wallet_locked`. The broker at that time discarded the exact status and body,
  so the specific subtype cannot be reconstructed retroactively. The operator's
  narrative (session created, persistent permission set, wallet unlocked before
  the second attempt) is consistent with an invalid/expired session or missing
  permission on the first attempt.
- Second attempt: `SIGNING_FAILED` = another 4xx. With authentication,
  permission and wallet state repaired, execution reached `publishQdnResource`.
  The verifiable 4xx is the fee unit mismatch above; it is deterministic for the
  recorded payload and fee.
- The new diagnostics preserve `httpStatus` and a bounded `errorCode` on the
  next attempt, so any remaining subtype is directly observable.

## 5. Name-space hypothesis: disproven for this request

External Auth 0.2.0 builds `/arbitrary/${service}/${resolvedName}` without
`encodeURIComponent` (line 2907). That is a real latent defect, but it did not
cause this failure:

1. Node 24 `fetch` parses the URL with the WHATWG URL parser, which
   percent-encodes a space in the path. A local probe against a mock HTTP server
   recorded exactly:
   `/arbitrary/DOCUMENT/developer%20iffi/base64?fee=0.01`.
   `encodeURIComponent('developer iffi')` is also `developer%20iffi`.
2. Even if the path were wrong, the fee query parameter is bound before
   `upload()` runs, so the unencoded-name issue is never reached on this
   payload.
3. External Auth's own group-key publish path
   (`packages/auth-daemon/src/index.ts:3235`) encodes name and identifier and
   passes `payload.feeAtomic` directly, confirming the intended contract.

Latent risk remains for names containing `#`, `?`, `%` or `\`, which the URL
parser would treat as fragment/query/escape/separator. The upstream patch
encodes every path segment once and therefore closes that class.

## 6. Fixes

### 6.1 Broker (deployed by the operator script)

- `broker/src/service.js` passes `feeAtomic: resource.feeAtomic` unchanged.
- `broker/src/signing/external-auth.js` requires a positive safe integer
  `feeAtomic` and sends it as `fee`; it never performs QORT conversion.
- `broker/src/service.js` persists and audits a sanitized diagnostic.

### 6.2 External Auth 0.2.0 patches (stored, not pushed)

Two patches apply in order to the pinned commit
`7e5d498221cf15ccbc01e7241efbcd0c6e76d09c`:

1. `patches/qortal-external-auth-0.2.0-qdn-publish.patch`
   - validates `fee` as a positive integer atomic amount and fails clearly on
     a QORT decimal before contacting Core;
   - percent-encodes `service`, `registeredName` and `identifier` once.
2. `patches/qortal-external-auth-0.2.0-core-diagnostics.patch`
   - parses Core's structured JSON rejection;
   - returns `{error:"publish_failed", diagnostic:{stage, coreStatus,
     coreErrorCode, coreMessage}}` without the raw body;
   - records the bounded reason in the External Auth publish audit;
   - adds `packages/auth-daemon/src/publishDiagnostics.ts` and five tests.

**Correction to an earlier claim:** the previously stored fee patch was
truncated inside its final hunk (57 lines, no trailing newline). `git apply
--check` rejected it as `corrupt patch at line 58`; it could never have been
deployed. Both patches were regenerated with `git diff` from the pinned
commit and verified sequentially in a clean worktree (`P1_OK`, `P2_OK`).
Patch sizes are 59 and 400 lines.

The patches are not pushed to the third-party repository and are not applied to
any production file in this task.

## 7. Diagnostics and redaction guarantees

Outcome from the signing backend for a Core rejection:

```json
{
  "state": "failed",
  "code": "SIGNING_FAILED",
  "diagnostic": {
    "httpStatus": 400,
    "errorClass": "REQUEST",
    "errorCode": "CORE_API_KEY_MISSING",
    "stage": "upload",
    "coreStatus": 401,
    "coreMessage": "Missing 'X-API-KEY' header"
  }
}
```

External Auth response for the same failure:

```json
{
  "error": "publish_failed",
  "diagnostic": {
    "stage": "upload",
    "coreStatus": 401,
    "coreErrorCode": "CORE_API_KEY_MISSING",
    "coreMessage": "Missing 'X-API-KEY' header"
  }
}
```

`httpStatus` is the External Auth response status (400). `coreStatus` is the
actual Qortal Core status, so the operator can distinguish an API-key 401 from
name registration, sync, signature or process rejections.

Persisted:

- `publications[].resources[].verification.diagnostic`
- `publications[].diagnostic` (record level, first failed resource)
- audit event `publication_signing_failed` fields `httpStatus`,
  `errorClass`, `errorCode`, and when present `stage`, `coreStatus`,
  `coreMessage`

Known `errorCode` values: `CORE_API_KEY_NOT_GENERATED`,
`CORE_API_KEY_MISSING`, `CORE_API_KEY_INVALID`,
`CORE_NAME_NOT_REGISTERED`, `CORE_BLOCKCHAIN_NEEDS_SYNC`,
`CORE_ADDRESS_UNKNOWN`, `CORE_DATA_MISSING`, `CORE_INVALID_SIGNATURE`,
`CORE_TRANSACTION_INVALID`, `CORE_TRANSFORMATION_ERROR`,
`CORE_QUERY_PARAMETER_INVALID`, `CORE_NO_TIME_SYNC`,
`CORE_REPOSITORY_ISSUE`, `CORE_INVALID_DATA`, `CORE_UNAUTHORIZED`,
`CORE_REQUEST_REJECTED`, `CORE_HTTP_ERROR`.

Guarantees:

- `errorCode` comes from a fixed allowlist or a classifier; an unknown
  structured `CORE_*` code collapses to `CORE_REQUEST_REJECTED`. Raw
  External Auth/Core text is never stored as the code.
- `httpStatus` and `coreStatus` must be integers 100-599; `errorClass` must
  be one of `AUTH|REQUEST|BACKEND|UNKNOWN`; `errorCode` must match
  `^[A-Z][A-Z0-9_]{2,63}$`; `stage` must be one of
  `fee|upload|convert|process|wallet|request`; `coreMessage` must be
  printable ASCII, at most 200 characters, with control characters collapsed.
  The service layer re-validates every field and drops invalid extras, so a
  compromised backend cannot inject free text.
- Both External Auth and the broker redact any run of 48+ token characters to
  `[redacted]`; a message that becomes only `[redacted]` is dropped.
- No authorization header, Bearer token, cookie, key, seed, wallet path, request
  body or Core URL is read, stored or logged.
- Tests include a Core body containing a 64-character token and an 88-character
  signature-sized value, plus a 400 body with a Bearer token, a seed phrase, a
  private key marker and a cookie; none appears in the outcome, record or audit
  JSONL.

## 8. One operator deployment procedure

Script: `broker/scripts/deploy-phase5.2-core-rejection-fix.sh`.
Wallet helper: `broker/scripts/operator-unlock-external-auth.sh`.

```bash
# 0) Read-only preview (no changes):
cd /home/iffiolen/qms-broker-deploy
sudo ./broker/scripts/deploy-phase5.2-core-rejection-fix.sh --check

# 1) Single idempotent deployment command. The API key file is read by the
#    script and written to a 0600 EnvironmentFile; its value is never printed.
sudo ./broker/scripts/deploy-phase5.2-core-rejection-fix.sh --yes \
  --core-api-key-file /qortal/apikey.txt

# 2) Operator-only wallet unlock after the External Auth restart
#    (password is prompted, never logged):
sudo /opt/qms-qdn-test-broker/broker/scripts/operator-unlock-external-auth.sh \
  --wallet-id <EXTERNAL_AUTH_WALLET_ID>

# 3) One new publication with a NEW identifier, then read the diagnostic.

# Only on failure or explicit rollback:
sudo ./broker/scripts/deploy-phase5.2-core-rejection-fix.sh \
  --rollback /var/backups/qms-phase5.2/<stamp>
```

Properties:

- **Idempotent**: patch state is detected by source markers; applied patches are
  skipped, fresh ones are applied with `git apply`, conflicts abort before any
  service is touched. Broker files are copied only; config/clients/state/audit
  are preserved. Re-running is safe.
- **Preflight**: layout paths, unit existence, users, config/clients/state
  permissions, no wildcard bind on 3199/8443, ≥2 GiB free, mirror checks for both
  patches, and Core API key presence. Conflicts and an inconsistent patch order
  fail closed.
- **Core API key**: resolved from `--core-api-key-file`, an existing
  `/etc/qortal-external-auth/node-api-key.env`, or an existing unit
  `Environment=`. It is validated with read-only `GET /admin/apikey/test`
  before anything is restarted (the key is passed to Node through the
  environment, never on a command line). It is written to a 0600 root-owned
  EnvironmentFile; a systemd drop-in adds `EnvironmentFile=-` to the External
  Auth unit. Source, state and token values are never printed.
- **Backups**: installed broker sources/scripts, broker config, clients registry,
  state, audit, External Auth `dist`, External Auth unit/drop-ins, and the
  existing key EnvironmentFile (0600). No wallet store, seed, private key or
  broker token value is copied.
- **Ordering**: capture/backup → engage kill switch → stop broker → stop
  credential timer/service → configure Core API key → apply External Auth
  patches → build External Auth → install `dist` → install broker code →
  `systemctl restart qortal-external-auth` → wait for EA health and verify the
  key is in the process environment → start broker → wait for health and
  `credential.sock` → release kill switch (only if it did not pre-exist) →
  start credential timer + one-shot service (new session/token) → verify.
- **Wallet relock**: an External Auth restart discards in-memory sessions and
  the unlocked wallet cache. The script deliberately does not unlock anything;
  it prints the exact helper command. Publishing before the unlock returns
  `SIGNING_REJECTED`/`WALLET_LOCKED`, not a silent retry.
- **Credential renewal**: sessions are in-memory in External Auth 0.2.0, so the
  broker token is invalid after the restart. The one-shot
  `qms-auth-credential.service` runs after the broker is listening and writes a
  fresh token through `credential.sock`. The script fails if the token file is
  empty afterwards.
- **Verification**: EA `GET /health`, API key loaded in
  `/proc/<pid>/environ` (name check only), broker `GET /v1/health`, admin
  `status` ok, a non-empty renewed token file, clients registry schema/key,
  `credential.sock`, timer state, token file presence, and diagnostics markers
  in both installed trees. No private Ed25519 verification key is needed.
- **Rollback**: automatic on error and explicit via `--rollback`; restores
  broker sources/config/state/audit, External Auth `dist`, unit/drop-ins and
  the previous key file, restarts External Auth and the broker, renews the
  token, and leaves the kill switch engaged. The operator must unlock again.
- No port is opened, `tailscale serve`/`ufw`/Caddy are not touched, no wallet
  is modified and no secret is printed.

The script was not executed and the signing VPS was not accessed.

## 9. Restricted SSH maintenance design (design only, not applied)

Dedicated account: `qms-maint`, key-only, shell `/bin/bash` with a restricted
`authorized_keys` command wrapper, reachable only over Tailscale.

Tailnet ACL (conceptual):

```json
{
  "action": "accept",
  "src": ["tag:qms-dev"],
  "dst": ["tag:qms-signing"],
  "proto": "tcp",
  "ports": ["22"]
}
```

`sshd_config`:

```text
Match User qms-maint Address 100.64.0.0/10
  AuthenticationMethods publickey
  PasswordAuthentication no
  PermitTTY yes
  AllowTcpForwarding no
  X11Forwarding no
  AllowAgentForwarding no
  PermitTunnel no
```

Allowed privileges (via a dedicated sudoers file, no wildcard shell):

- `systemctl status|is-active|show` on `qortal-external-auth`,
  `qms-qdn-test-broker`, `qms-auth-credential.*`;
- `journalctl -u` those units (and `--since`), read-only;
- read `/var/lib/qms-qdn-test-broker/state.json`, `audit.jsonl`,
  `/etc/qms-qdn-test-broker/config.json` (redacted values only);
- read the deployment backup directory;
- run the fixed deployment script with an explicit, pre-approved command path.

Prohibited explicitly:

- any access to `/var/lib/qortal-external-auth` (wallet store), wallet backups,
  wallet passwords, seeds or private keys;
- reading External Auth app tokens, `credential.sock` contents, agent private
  keys, or the broker token file;
- `SIGN_TRANSACTION`, `/tx/sign`, `/wallet/*`, `/node/proxy`,
  `/qortal/request`, owner-wallet operations or any signing route;
- unrestricted `sudo`, `sudo su`, editing units/config, installing packages,
  changing firewall/Tailscale state, or starting a publication.

Audit: `auditd` watches on `/etc/qms-qdn-test-broker`,
`/var/lib/qms-qdn-test-broker`, `/var/lib/qortal-external-auth` (deny/read
attempts), plus sshd `LogLevel VERBOSE` and journald retention. The account is
not created and no key is issued in this task.

## 10. Verification performed

Local, no signing-VPS access:

- `npm run test:phase5.2`: **111 tests, 111 pass, 0 fail**.
- `npm test` (full repository): **282 tests, 282 pass, 0 fail**.
- External Auth `npm run build` (auth-core + auth-daemon `tsc`): OK.
- External Auth focused diagnostics suite: **5 tests, 5 pass, 0 fail**.
- External Auth full daemon suite: **141 tests, 139 pass, 2 fail**, both
  `daemon startup timeout` in integration tests while the repository suite ran
  concurrently. Re-run alone: **3 tests, 3 pass, 0 fail**. The failures are
  timing/resource contention in the upstream harness, not assertion failures
  and not in the patched publish path.
- Both patches applied sequentially to a clean worktree at the pinned commit
  `7e5d498`: `P1_OK`, `P2_OK`.
- Deployment layout/ordering suite: **3 tests, 3 pass, 0 fail**, including the
  realistic preflight fixture and the patch-completeness check that catches the
  previously truncated fee patch.
- `bash -n` for both operator scripts: OK; every broker `.js` passed
  `node --check` in the deployment test.
- Mock-Core chain test asserts the exact
  `/arbitrary/DOCUMENT/developer%20iffi/qms-dev-final-002/base64?fee=1000000`
  request, identifier forwarding, base64 body, and the mapping of Core 401 JSON
  to `CORE_API_KEY_MISSING`; the same test proves a configured key reaches the
  signed path.
- Redaction tests inject a 64-character token and an 88-character
  signature-sized value plus a Bearer token, seed phrase, private key marker and
  cookie; none reaches the outcome, record or audit JSONL.
- The viewer and desktop packages were not modified, so their suites were not
  re-run for this broker/External Auth change.

## 11. Remaining blockers and next step

1. Operator runs `--check`, then
   `--yes --core-api-key-file /path/to/apikey.txt` from
   `/home/iffiolen/qms-broker-deploy`. This patches, rebuilds and restarts
   External Auth, installs the Core API key, installs the broker, and renews
   the credential.
2. Operator runs `operator-unlock-external-auth.sh --wallet-id <id>` once,
   because the External Auth restart relocked the wallet.
3. Operator submits **one** new test publication with a new identifier (not
   `qms-dev-final-001`).
4. Read `GET /v1/publications/{id}`; the record now shows
   `diagnostic.httpStatus`, `errorCode`, `stage`, `coreStatus` and
   `coreMessage`.
5. Apply the decision tree in §12.4. Do not resubmit an ambiguous outcome and
   do not retry the failed identifier.

No QDN transaction, wallet operation, token exposure, External Auth admin
action or signing-VPS change was performed during development.

## 12. Remaining 400 after the fee fix (2026-11-03, later)

### 12.1 Next rejection point

Core 6.1.9 gates `POST /arbitrary/{service}/{name}/{identifier}/base64` in this
order:

| Order | Gate | Source | Failure |
| --- | --- | --- | --- |
| 1 | Route match | `ArbitraryResource.java` `@Path("/{service}/{name}/{identifier}/base64")` | 404 |
| 2 | `fee` binds to Java `Long` | same method, `@QueryParam("fee") Long fee` | 400/404 before the method |
| 3 | **`Security.checkApiCallAllowed(request)`** | `ArbitraryResource.java:1665-1700` (identifier variant; the no-identifier route is 1620-1654), `Security.java:31-68` | **401 JSON** |
| 4 | `Service.valueOf(service)` | same method | 400/500 |
| 5 | Registered-name lookup | `ArbitraryResource.upload()` | 400 `Name not registered` |
| 6 | Chain sync | `upload()` | 400 `BLOCKCHAIN_NEEDS_SYNC` |
| 7 | Owner account public key | `upload()` | 400 `ADDRESS_UNKNOWN` |
| 8 | Base64 decode + builder | `upload()` | 400 `INVALID_DATA` |
| 9 | `/transactions/convert` | `TransactionsResource` | 400 `TRANSFORMATION_ERROR` |
| 10 | `/transactions/process` | signature, fee, reference, import | 400 `INVALID_SIGNATURE` / `TRANSACTION_INVALID` |

With the fee now a valid atomic integer, **gate 3 is the first remaining gate**.
`Settings.localAuthBypassEnabled` defaults to `false`
(`Settings.java:96`), and `Security.checkApiCallAllowed` then requires a
generated API key and an `X-API-KEY` header. It returns
`{"error":401,"message":"API key not generated"}`,
`{"error":401,"message":"Missing 'X-API-KEY' header"}` or
`{"error":401,"message":"API key invalid"}`.

Supporting evidence that this gate applies to this deployment:

- The repository's External Auth unit example sets only
  `QORTAL_AUTH_HOST`, `QORTAL_AUTH_PORT`, `QORTAL_AUTH_DATA_DIR`,
  `QORTAL_AUTH_NODE_URL` and `NODE_ENV`; it does not set
  `QORTAL_AUTH_NODE_API_KEY`, and no Phase 5.2 document mentions it.
- External Auth only sends `X-API-KEY` when that variable is non-empty
  (`packages/auth-daemon/src/index.ts:1698-1708`). Its `auto` mode path
  list does include `/arbitrary/{service}/{name}/{identifier}/base64`
  (`:191-216`), so configuring the key is both necessary and sufficient.
- Qortal Hub's publish flow always carries a node API key
  (`qortal-hub` `src/background/background.ts`), and Core exposes the
  read-only `GET /admin/apikey/test` specifically to validate one.

**Honest limit:** the deployed process environment and the Core settings are on
the signing VPS, which this task did not access. The gate order and the missing
key in the deployment contract are proven from source; the exact Core message is
confirmed by the new diagnostic on the next (single) operator attempt. If the
operator had already configured the key or enabled the local auth bypass, the
same diagnostic names the next gate instead.

### 12.2 Why the broker showed only `CORE_REQUEST_REJECTED`

External Auth 0.2.0 `postNode` did:

```ts
if (!response.ok) {
  const text = await response.text();
  throw new Error(text);            // raw Core JSON becomes the message
}
```

and the publish route returned `{ error: error.message }`. The broker saw a
string beginning with `{`, which matched none of its message classifiers, so
every Core JSON rejection became `CORE_REQUEST_REJECTED` — including
`Name not registered`. That is a confirmed contract defect, not an inference.

### 12.3 Confirmed defects fixed in this change

1. The stored External Auth fee patch was **corrupt** (truncated final hunk,
   rejected by `git apply --check`). Regenerated from the pinned commit; both
   patches now apply sequentially in a clean worktree.
2. External Auth discarded Core's structured error. It now returns a sanitized
   `diagnostic` and records the same bounded fields in its audit event.
3. The deployment contract omitted the Core API key required by
   `Security.checkApiCallAllowed`. The procedure now validates and installs it
   through a 0600 EnvironmentFile and a systemd drop-in.
4. The contract test double omitted the identifier segment, so it did not assert
   the real Core path. Fixed to
   `/arbitrary/DOCUMENT/developer%20iffi/{identifier}/base64?fee=1000000`.

### 12.4 Operator decision tree

| `diagnostic.errorCode` | Meaning | Action |
| --- | --- | --- |
| `CORE_API_KEY_MISSING` | Key not sent to Core | Check the drop-in/EnvironmentFile and rerun the deploy |
| `CORE_API_KEY_NOT_GENERATED` | Core has no key yet | `POST /admin/apikey/generate` locally, then redeploy |
| `CORE_API_KEY_INVALID` | Wrong key | Re-read the node's `apikey.txt` and redeploy |
| `CORE_NAME_NOT_REGISTERED` | Name/identity mismatch | Re-check `GET /names/developer iffi` |
| `CORE_BLOCKCHAIN_NEEDS_SYNC` | Node out of sync | Wait for sync; no retry |
| `CORE_INVALID_SIGNATURE` / `CORE_TRANSACTION_INVALID` | Wallet/name owner mismatch | Stop; verify the wallet address |
| `CORE_DATA_MISSING` / `CORE_INVALID_DATA` | Body shape | Stop; capture the resource id |
| `CORE_REQUEST_REJECTED` | No known mapping | Read `coreMessage` (bounded) before any retry |

No live publication, wallet operation, token read or signing-VPS change was
performed while producing this update.
