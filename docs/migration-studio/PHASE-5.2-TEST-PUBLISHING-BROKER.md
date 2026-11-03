# Phase 5.2 — Secure autonomous QDN test publisher

| Field | Value |
| --- | --- |
| Document | Policy broker, External Auth assessment and operator deployment model |
| Date | 2026-11-03 |
| Status | Implementation and deterministic verification complete; live deployment **not provisioned** |
| Scope | Development-only autonomous QDN test publication infrastructure |
| Product boundary | The user-facing Migration Studio workflow still uses Qortal Hub approval (Phase 5) |

## 1. Result in one paragraph

A standalone policy broker was implemented in `broker/`. It accepts only
Ed25519-authenticated publication requests, validates project/name/owner/service/
identifier/bytes/SHA-256/handoff integrity, enforces fee and budget limits,
calls only Qortal External Auth `POST /qdn/publish` with a fixed wallet and node
URL, then verifies exact QDN bytes and SHA-256 through the existing Phase 5
read-back code. It persists atomic budget state and an append-only hash-chained
audit log outside the repository, and exposes an operator-only Unix-socket kill
switch and key revocation. Deterministic tests pass with a mock signing backend.
No wallet was imported or unlocked, External Auth was not installed, and no QDN
resource or transaction was created.

## 2. Read-only security preflight

All checks below were read-only. No remote configuration, service, firewall or
wallet was changed.

| Check | Evidence | Result |
| --- | --- | --- |
| OpenClaw host identity | `uid=1000(iffi)`, groups include `sudo` | Agent runs as an unprivileged user with a sudo-group membership, but `sudo` requires an interactive password |
| Passwordless sudo | `sudo -n true` → "a password is required" | No non-interactive root |
| Docker control | `docker` binary not installed | No Docker-host access from this host |
| SSH to test VPS | `ssh root@169.58.135.102` → `Permission denied (publickey,password)` | No authorized agent SSH access |
| Qortal node health | `/admin/info`: `qortal-6.1.9-108bf19`, full node, mainnet | Healthy |
| Node synchronization | `/admin/status`: `isSynchronizing=false`, `syncPercent=100`, height 2,783,170, 108 connections | Synchronized |
| Test name ownership | `GET /names/developer%20iffi` → `name="developer iffi"`, `owner=QipPqwJeLtx89dXcSkY7vimMUNT8Gy5k2E`, `isForSale=false` | Exact expected name and owner |
| Balance | `GET /addresses/balance/Qip...` → `5.02000000` | 5.02 QORT confirmed |
| Node API exposure | `http://169.58.135.102:12391` answered read-only status calls from the agent host | Public reachability observed; hardening is an operator task |
| Node OS user/process owner | No SSH access | **Unknown; must be documented by the operator** |
| Wallet secret isolation | Host not provisioned | **Unverified; requires the provisioning tests below** |

The node's public API being reachable does **not** grant signing authority. The
test wallet is not on the OpenClaw host and no wallet file was read.

## 3. Qortal External Auth audit

Source audited read-only:

- `gitea.qortal.org/crowetic/Qortal-External-Auth`, version 0.2.0;
- `README.md`;
- `packages/auth-daemon/src/index.ts` (route definitions and
  `publishQdnResource`).

### Findings

| Area | Finding | Consequence |
| --- | --- | --- |
| Bind address | Default `127.0.0.1:3191`; Docker example publishes `0.0.0.0:3191` | Loopback is required; the Docker example is unsafe |
| Auth | `POST /apps/register` → app secret; `POST /sessions` → bearer token | Bearer token is a signing credential and must live only on the signing host |
| Permissions | Scopes include `SIGN_TRANSACTION` and `PUBLISH_QDN_RESOURCE`; modes `ask`, `session`, `persistent` | The broker token must have only `PUBLISH_QDN_RESOURCE`; never `SIGN_TRANSACTION` |
| Publish API | `POST /qdn/publish` accepts `walletId`, `data` (base64), `service`, `registeredName`, `identifier`, optional metadata, `fee`, `nodeUrl`, `password` | Caller controls target name, service, identifier, fee and node URL; External Auth itself enforces no allowlist |
| Arbitrary signing | `POST /tx/sign` signs caller-supplied `unsignedBytes` under `SIGN_TRANSACTION` | Must be unreachable to the agent and unused by the broker |
| Generic proxy | `POST /qortal/request` and `POST /node/proxy` | Must not be exposed to the agent |
| Wallet operations | Import, create, backup export, unlock/lock routes exist | Operator-only; broker never calls them and never holds a wallet password |
| Limits | No built-in target allowlist, resource count, fee cap, cumulative budget, transaction count, session budget or emergency kill switch found | The broker is mandatory |
| Audit | Application audit events exist but are not a tamper-evident ledger | Broker keeps its own hash-chained ledger |
| Suitability | Suitable as a **private signing primitive behind the broker**; not an isolation boundary and not safe to expose directly | Adopt only on a dedicated host with the controls below |

No External Auth package was installed, started, or configured during this
phase.

## 4. Architecture and trust boundaries

```text
┌──────────────────────────────┐
│ OpenClaw / development agent │  holds: Ed25519 client private key
│ (no SSH/sudo on signing host)│  cannot read: wallet, External Auth token, broker state
└──────────────┬───────────────┘
               │ private network (WireGuard) or loopback tunnel
               │ Ed25519 + timestamp + nonce + body hash
               ▼
┌──────────────────────────────┐
│ qms-broker (unprivileged)    │  policy, budget, resource locks, audit
│ 127.0.0.1 or RFC1918:3199    │  no admin route over TCP
│ Unix admin socket 0600       │  disable / enable / revoke key
└──────────────┬───────────────┘
               │ bearer token; ONLY POST /qdn/publish
               │ fixed walletId, fixed nodeUrl, fixed fee policy
               ▼
┌──────────────────────────────┐
│ qortal-auth (unprivileged)   │  wallet dir 0700, loopback 3191
│ Qortal External Auth 0.2.0   │  permission: PUBLISH_QDN_RESOURCE only
└──────────────┬───────────────┘
               │ Qortal Core submit
               ▼
┌──────────────────────────────┐
│ Qortal Core                  │  read-only name/properties/status/bytes
│ test name: developer iffi    │  exact Phase 5 SHA-256 read-back
└──────────────────────────────┘
```

Trust rules:

1. The agent's only authority is a scoped Ed25519 key and the broker's policy.
2. The broker is the only caller of External Auth and only calls
   `/qdn/publish`.
3. External Auth is the only component that can read wallet files and sign.
4. The operator owns wallet unlock, token creation/rotation, policy files,
   kill switch and key revocation.
5. The agent's repository, tests and commits have no deployment path: there is
   no auto-deploy, the operator reviews and installs a pinned commit as root,
   deployed policy lives in `/etc`, and runtime data in `/var/lib` is owned by
   different OS users on a host the agent cannot log in to.

## 5. Broker API and policy controls

### Routes

- `GET /v1/health` — unauthenticated liveness only.
- `POST /v1/publications` — one authenticated batch.
- `GET /v1/publications/{id}` — stored record.
- `POST /v1/publications/{id}/verify` — safe read-back re-verification.

No transaction-signing, wallet, proxy, admin or arbitrary-node route exists.
Unknown paths return `404 NOT_FOUND` before authentication, including
`/tx/sign`, `/wallet/import-seed`, `/node/proxy` and `/qortal/request`.

### Implemented controls

| Control | Implementation |
| --- | --- |
| Exact target name | Configuration hard-requires `developer iffi`; request target must match exactly |
| Exact owner | Request owner must equal the configured owner; live name ownership is checked through `GET /names/{name}` and `reducedName` is never used as identity |
| Service allowlist | `DOCUMENT` only |
| Identifier allowlist | `qms-dev-` prefix with a non-empty suffix; strict `[a-z0-9_-]` and length checks |
| Content types | Configurable allowlist, default text/Markdown/HTML/JSON |
| Payload limits | Per-resource 1 MiB, aggregate 4 MiB |
| Resource/transaction limits | Maximum 20 resources and 20 transactions per request |
| Fee per transaction | No arbitrary fixed ceiling. Each resource is quoted through the node's read-only `POST /transactions/fee` using a reconstructed Core v5 ARBITRARY transaction; the quote must be an exact multiple of `GET /transactions/unitfee?txType=ARBITRARY`. Any unavailable or malformed quote fails closed |
| Cumulative budget | 5 QORT per rolling 24 h window; the full batch fee is reserved atomically, and pending/ambiguous reservations count until resolved. Concurrent requests cannot double-spend |
| Wallet reserve | The confirmed QORT balance must cover the batch, existing reservations and a configurable 0.1 QORT reserve; an unavailable balance fails closed |
| Session lifetime | Ed25519 key `issuedAt` → `expiresAt`, capped by policy (1 h) |
| Existing identities | Core properties preflight; 404 required; existing identity rejected unless `allowResourceUpdates` is explicitly enabled (off) |
| Exact bytes | Canonical base64, byte length and SHA-256 verified before signing |
| Handoff integrity | Optional sealed `qms-publication-handoff@1`; Phase 5 validator plus project/target/triple/hash comparison |
| Replay protection | ±120 s timestamp window + nonce cache + body-hash signature |
| Idempotency | `requestId` + body hash; identical replay returns the stored record; conflicting reuse rejected |
| Ambiguous/pending | Persisted without resubmission; resource identities stay locked |
| Failed signatures | Zero charge, lock released, a new request may retry deliberately |
| Read-back mismatch | Persisted as `ambiguous`; no retry; safe re-verification only |
| Audit | Hash-chained JSONL, redacts payloads/secrets/signatures, verifies the entire chain at startup |
| Emergency stop | Operator Unix socket writes state + kill-switch file; every request re-checks both and fails closed |
| Key revocation | State-backed revocation through the operator socket |
| Bounded I/O | Body cap, header timeout, request timeout, backend/read-back timeouts, one submission attempt |

### Fee derivation and budget accounting

The request schema is `qms-test-publication-request@2`; it has no `fees`
field. A caller cannot set, lower or raise a fee, and an unknown fee field is a
`400 INVALID_REQUEST`.

For every batch the broker performs these read-only Core calls:

1. `GET /transactions/unitfee?txType=ARBITRARY&timestamp=<now>` returns the
   current unit fee in atomic QORT.
2. For each resource, the broker reconstructs the exact Core v5 ARBITRARY
   transaction byte length for that resource (fixed fields, name, identifier,
   data hash or small RAW_DATA payload, metadata hash) and sends the unsigned
   Base58 transaction to `POST /transactions/fee`. Core returns the exact
   recommended fee, which must be a positive integer and an exact multiple of
   the unit fee.
3. `GET /addresses/balance/<owner>` returns the confirmed QORT balance. The
   batch is rejected unless the balance covers the full batch, every existing
   reservation and the configured `walletReserveQort` (0.1 QORT by default).

Core computes the fee from serialized transaction bytes, not from the QDN
payload size directly. For ordinary off-chain DOCUMENT resources the
transaction is well under 1024 bytes and currently quotes one unit
(0.01 QORT). The broker still stores and charges each resource's own quote, so a
future Core change or a different resource shape is handled without a fixed
per-transaction ceiling. Any quote failure, malformed amount, non-multiple or
unavailable balance rejects the request before reservation or signing.

The full batch cost is reserved in one state transaction. `windowSpent`
includes spent, uncertain and currently reserved atomic amounts. Pending and
ambiguous signing outcomes charge the whole reservation and never release it
automatically; crash recovery converts in-flight reservations to ambiguous and
counts the full reservation as spent. The broker never increases
`budgetQort`; an operator must change the deployed configuration explicitly.

Live read-only evidence (2026-11-03, Qortal Core 6.1.9-108bf19 on
`169.58.135.102:12391`): unit fee `1000000` atomic; reconstructed
transactions of 307 and 331 serialized bytes both quoted `1000000` atomic;
confirmed wallet balance `502000000` atomic (5.02 QORT). No transaction was
signed or submitted.

External Auth v0.2.0 accepts a caller-supplied numeric `fee` and passes it to
the node's arbitrary publish route. When the field is omitted it fetches the
ARBITRARY **unit** fee and uses that value. It does not compute the recommended
per-transaction fee, does not cap the fee, and has no target or budget policy.
The broker therefore always sends the explicit Core-derived per-resource fee;
External Auth is a signing primitive, not a fee authority. Each resource's
quote is stored in the publication record, and the batch total is the plain sum
of those atomic quotes.

## 6. Threat model

| Asset | Threat | Control | Residual risk |
| --- | --- | --- | --- |
| Test wallet / seed | Agent reads wallet files | Separate host, different OS user, wallet dir 0700, systemd `InaccessiblePaths`, no agent SSH/sudo | Host compromise by root remains outside the model |
| Signing authority | Agent calls `/tx/sign` or wallet routes | Broker has no such route; External Auth token limited to `PUBLISH_QDN_RESOURCE`; External Auth loopback-only; firewall | A compromised broker user could call other local routes; requires host compromise |
| QDN namespace | Publication to another name | Exact name/owner config and live ownership check; request boundary rejects target changes | Qortal chain reorg/ownership transfer handled by fail-closed name check |
| Fee budget | Agent exhausts wallet with many small txs | Node-derived per-resource fees, 20 tx/request cap, 5 QORT rolling budget, atomic reservations, confirmed-balance reserve, pending/ambiguous accounting | Budget resets on the configured window; external wallet use can change the balance between checks |
| Duplicate writes | Retry after timeout creates a second tx | Single attempt; pending/ambiguous locks; idempotency; no auto-retry | A truly lost signature is reconciled by an operator |
| Content substitution | Bytes change after validation | Canonical base64 + byte length + SHA-256 re-checked immediately before signing; exact read-back after | External Auth/node bug could still publish wrong bytes; read-back exposes it |
| Replay/CSRF | Reuse a captured request | Ed25519 signature over method, path, body hash, timestamp, nonce; nonce cache; short window | In-memory nonce cache resets on restart; timestamp window still bounds replay |
| Audit tampering | Agent edits logs | Broker-owned directory outside repo; hash chain verified at startup and in tests | Root/operator can rewrite; external log shipping is recommended |
| Policy tampering | Agent commits a weaker policy | Deployed config is outside the repo and not read from the worktree; agent cannot deploy | Operator misconfiguration is possible |
| Denial of service | Huge bodies or requests | 8 MiB body cap, timeouts, one concurrent publication, bounded batch | Private-network DoS by the agent is limited but not eliminated |

## 7. Deployment model on the signing host

Recommended topology: a dedicated signing VM (or the existing Qortal node VPS
with dedicated unprivileged users), separate from the OpenClaw host.

- OS users: `qms-broker` (broker) and `qortal-auth` (External Auth). No shared
  group and no shared home.
- Wallet data: `/var/lib/qortal-external-auth`, owner `qortal-auth`, mode 0700.
  The broker unit has `InaccessiblePaths=/var/lib/qortal-external-auth`.
- Broker data: `/var/lib/qms-qdn-test-broker` (state + audit), owner
  `qms-broker`, mode 0700.
- Secrets: External Auth bearer token in
  `/etc/qms-qdn-test-broker/external-auth-token`, owner `qms-broker`, mode
  0600. Client public keys in `clients.json`; the agent private key never
  leaves the agent host.
- Network:
  - External Auth binds `127.0.0.1:3191` only.
  - Qortal Core API binds loopback, or is firewalled to the signing host only.
  - Broker binds loopback by default. If OpenClaw must reach it over
    WireGuard, bind an RFC1918 address and allow TCP 3199 only from the
    OpenClaw WireGuard peer. Never bind `0.0.0.0` or a public address.
  - No public 3191/3199. SSH only from the operator, never for the agent.
- systemd hardening: `NoNewPrivileges`, `ProtectSystem=strict`,
  `ProtectHome`, `PrivateTmp`, `PrivateDevices`, empty capability sets,
  `RestrictAddressFamilies`, `MemoryDenyWriteExecute`, explicit
  `ReadWritePaths`, and `InaccessiblePaths` for wallet/config secrets.
- Docker is not used as the isolation boundary. A container alone is not proof
  that the agent cannot reach wallet files or the admin API; process identity,
  filesystem permissions, network rules and host access are the boundary.

Example units are in `broker/systemd/`. They are templates, not installed
configuration.

## 8. Operator provisioning steps

1. **Confirm scope.** This is a development-only test publisher. The
   user-facing workflow remains Qortal Hub approval. Use only the dedicated
   test name `developer iffi` and the test wallet.
2. **Create the signing host.** Add users `qms-broker` and `qortal-auth`,
   directories from `broker/systemd/qms-qdn-test-broker.tmpfiles.conf`, and
   install Node.js 20.19+ (22.12+ if the optional Hub companion is used).
3. **Install External Auth pinned to v0.2.0.** Build it on the signing host.
   Do not expose port 3191. Set `QORTAL_AUTH_HOST=127.0.0.1`,
   `QORTAL_AUTH_DATA_DIR=/var/lib/qortal-external-auth`, and a loopback Core
   URL. Do not install it on the production node during Phase 5.2.
4. **Create the signing app and token.** As operator:
   `POST /apps/register`, then `POST /sessions`; grant only
   `PUBLISH_QDN_RESOURCE` (mode `session` or `persistent`). Never grant
   `SIGN_TRANSACTION`. Write the bearer token to the 0600 token file.
5. **Import/unlock the test wallet.** Operator-only, locally on the signing
   host. The seed/password must never be sent through Telegram, the broker,
   the agent or the repository. Choose an unlock TTL that covers the intended
   test session, then lock it afterwards.
6. **Provision the agent key.** Generate an Ed25519 keypair on the agent host:
   `openssl genpkey -algorithm ED25519 -out agent.key` and
   `openssl pkey -in agent.key -pubout -out agent.pub`. Put only the public
   PEM, `issuedAt` and `expiresAt` in `clients.json`.
7. **Install broker policy.** Copy `broker/config.example.json` to
   `/etc/qms-qdn-test-broker/config.json`; replace the wallet id placeholder;
   keep the target name/owner, `DOCUMENT`-only, prefix, limits, updates-off
   and loopback/private bind. Install the systemd unit and tmpfiles entry.
8. **Start disabled.** Create
   `/var/lib/qms-qdn-test-broker/DISABLED` before first start. Verify health,
   socket mode and logs, then enable through the operator socket.
9. **Negative isolation tests (mandatory before adoption).**
   - From the OpenClaw host: SSH to the signing host must fail.
   - From the OpenClaw host: `curl http://<signing-host>:3191/health` must
     fail.
   - From the public internet: TCP 3199 and 3191 must be closed.
   - As `qms-broker`: reading
     `/var/lib/qortal-external-auth` must fail.
   - As the agent: no sudo/root/Docker control on the signing host.
   - Audit file and state directory are writable only by `qms-broker`.
10. **Live smoke test (separate authorization).** With explicit owner
    authorization, publish one synthetic `qms-dev-smoke-*` DOCUMENT, confirm
    the exact read-back hash, then verify the audit entry, the charged fee and
    the budget ledger. No live publish was performed in this phase.

## 9. Verification evidence

- `node --test test/phase5.2/*.test.js`: **68 passed, 0 failed**.
- Full repository `npm test`: **239 passed, 0 failed**.
- `npm run test:phase5`: **24 passed, 0 failed**.
- Production viewer and CMS builds: passed (Vite: 1585 modules; CMS bundle
  built).
- Desktop `npm run typecheck`: passed; `npm test`: **28 passed, 0 failed**;
  `npm run build`: passed.
- Covered cases include unauthorized names/owners, non-DOCUMENT services,
  identifier/path manipulation, oversized payloads, node fee quoting,
  non-multiple fee rejection, unavailable fees/balance, insufficient confirmed
  balance, cumulative budget exhaustion, pending/ambiguous accounting,
  concurrent budget races, replay, expired sessions, idempotency
  conflicts, existing identities, pending/ambiguous outcomes, failed
  signatures, read-back mismatch, wrong signer address, node unavailability,
  handoff integrity, forbidden endpoints, emergency disable, token revocation,
  audit tampering and crash recovery.
- Mock signing backend: deterministic; only `publish()` exists; tests assert
  that only `/qdn/publish` is called and that `/tx/sign` is never used.
- Existing Phase 5.1 and earlier suites are run separately; see the Phase 5.2
  final report for exact totals.

## 10. Missing prerequisites and blockers

The following are **not** satisfied by this repository and require the
operator/owner:

1. No authorized SSH/root access from the OpenClaw host to
   `169.58.135.102`; the node OS user and process identity are unknown.
2. No dedicated signing host, OS users, tmpfiles, systemd units or firewall
   rules are deployed.
3. External Auth v0.2.0 is not installed, configured, or live-tested on this
   node; API compatibility is based on source audit, not a live call.
4. No External Auth app/token or `PUBLISH_QDN_RESOURCE` permission exists.
5. The test wallet has not been unlocked (and must not be unlocked by the
   agent); no live signing was attempted.
6. No WireGuard/private-network path and no Ed25519 client key are provisioned
   for the agent.
7. The Qortal node API is currently reachable on a public interface; the
   operator must firewall it or bind it to loopback before adoption.
8. No owner authorization exists for a live synthetic QDN publish.
9. Host-level isolation (wallet unreadable by `qms-broker`, no agent SSH/sudo,
   no public signing/admin ports) cannot be verified until the host exists.
10. Token rotation and audit-log shipping are manual procedures, not automated.

Until items 1–9 are completed and evidenced, the correct status is
**implementation complete, deployment blocked**. Do not describe the system as
live or proven against the real wallet.

## 11. Safety statement

During Phase 5.2:

- no wallet was imported, created, unlocked, backed up or exported;
- no seed, private key or wallet password was requested or transmitted;
- no External Auth instance was installed or activated on the production node;
- no Qortal Core configuration was changed;
- no QDN resource was published and no transaction was submitted;
- the only network calls to the test node were read-only name, balance, status
  and health checks.
