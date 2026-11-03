# Phase 5.2 — External Auth publishing failure analysis and fix

Status: analysis and fix prepared; operator deployment pending.
No QDN transaction was submitted during this work.

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

### 6.2 External Auth 0.2.0 patch (stored, not pushed)

`patches/qortal-external-auth-0.2.0-qdn-publish.patch` (26 insertions,
14 deletions, verified with `git apply --check` against the pinned commit):

- validates `fee` as a positive integer atomic amount and fails clearly on a
  QORT decimal before contacting Core;
- percent-encodes `service`, `registeredName` and `identifier` exactly once.

The patch is not pushed to the third-party repository and is not applied to any
production file in this task.

## 7. Diagnostics and redaction guarantees

Outcome from the signing backend:

```json
{
  "state": "failed",
  "code": "SIGNING_FAILED",
  "diagnostic": { "httpStatus": 400, "errorClass": "REQUEST", "errorCode": "CORE_REQUEST_REJECTED" }
}
```

Persisted:

- `publications[].resources[].verification.diagnostic`
- `publications[].diagnostic` (record level, first failed resource)
- audit event `publication_signing_failed` fields `httpStatus`,
  `errorClass`, `errorCode`

Guarantees:

- `errorCode` comes from a fixed map, an uppercase-token allowlist, or a
  classifier; raw External Auth/Core text is never stored.
- `httpStatus` must be an integer 100-599; `errorClass` must be one of
  `AUTH|REQUEST|BACKEND|UNKNOWN`; `errorCode` must match
  `^[A-Z][A-Z0-9_]{2,63}$`. The service layer re-validates, so a compromised
  backend cannot inject free text.
- No authorization header, Bearer token, cookie, key, seed, wallet path, request
  body or Core URL is read, stored or logged.
- Tests include a 400 body containing a Bearer token, a seed phrase, a private
  key marker and a cookie; none appears in the outcome, record or audit JSONL.

## 8. One operator deployment procedure

Script: `broker/scripts/deploy-phase5.2-external-auth-fix.sh`.

```bash
# Single idempotent command on the signing VPS, from the actual checkout:
cd /home/iffiolen/qms-broker-deploy
sudo ./broker/scripts/deploy-phase5.2-external-auth-fix.sh --yes
# Optional read-only preview; not a required step:
sudo ./broker/scripts/deploy-phase5.2-external-auth-fix.sh --check
# Only on failure or explicit rollback:
sudo ./broker/scripts/deploy-phase5.2-external-auth-fix.sh --rollback /var/backups/qms-phase5.2/<stamp>
```

Properties:

- **Idempotent**: copies the corrected broker sources, preserves config/clients/
  state/audit, and re-runs safely. `--yes` is the single deployment command.
- **Preflight**: actual layout paths, unit existence, config/clients/state
  permissions, active External Auth, no wildcard bind on 3199/8443, ≥2 GiB free.
- **Current state capture**: systemd states, repo HEAD, config/clients/state/
  audit SHA-256, kill-switch pre-existence, logs in the backup directory.
- **Backups**: installed broker sources/scripts, broker config, clients registry,
  state, audit. No External Auth source and no secrets are copied.
- **Ordering**: engage kill switch → stop broker → stop credential timer/service
  → install broker code → start broker → wait for health and credential.sock →
  release kill switch (only if it did not pre-exist) → start credential timer and
  service → verify.
- **External Auth**: not patched, rebuilt or restarted. The broker atomic-fee
  fix is sufficient; the vendor patch remains upstream-only and does not cause a
  wallet relock during this deployment.
- **Verification**: EA `GET /health`, broker `GET /v1/health`, admin socket
  `status`, clients registry schema/key, credential socket, timer and kill-switch
  state. No private Ed25519 verification key is required on the signing VPS.
- **Rollback**: automatic on error and explicit via `--rollback`; restores
  sources/config/state, rebuilds, restarts services and leaves the kill switch
  engaged.
- No port is opened, `tailscale serve` is not touched, no secret is printed.

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

- `node --test test/phase5.2/*.test.js`: 100 tests, 100 pass, 0 fail.
- `npm test` (repository, includes broker/engine/desktop host and phase5.2):
  271 tests, 271 pass, 0 fail.
- `npm --prefix viewer run build`: TypeScript + Vite OK.
- `cd desktop && npm run typecheck`: OK.
- `cd desktop && npm test`: 10 files, 28 tests, 28 pass, 0 fail (including
  `tests/renderer/publishing.spec.tsx`, the Publisher handoff/verify flow).
- `cd desktop && npm run build`: OK.
- `git apply --check` of the External Auth patch against the pinned commit: OK.
- `bash -n` and `node --check` for the operator scripts: OK.
- `operator-verify.js` exercised against the in-process broker harness: health
  `ok`, signed fake-id read `400 INVALID_REQUEST`, exit 0.

## 11. Remaining blockers and next step

1. Operator runs the single `--yes` command on the signing VPS from `/home/iffiolen/qms-broker-deploy`; `--check` is optional preview only.
2. Operator submits **one** new test publication with a new identifier.
3. Read `GET /v1/publications/{id}`; the record now shows
   `diagnostic.httpStatus` and `errorCode`.
4. If it still fails, the code distinguishes `WALLET_NOT_FOUND`,
   `CORE_NAME_NOT_REGISTERED`, `CORE_REQUEST_REJECTED`, etc., without exposing
   secrets. Do not resubmit an ambiguous outcome.

No QDN transaction, wallet operation, token exposure, External Auth admin
action or signing-VPS change was performed.
