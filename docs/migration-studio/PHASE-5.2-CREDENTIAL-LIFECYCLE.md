# Phase 5.2 — Autonomous credential lifecycle

| Field | Value |
| --- | --- |
| Document | External Auth session renewal, broker credential reload and renewable agent authorization |
| Date | 2026-11-03 |
| Status | Implementation and deterministic tests complete; **not installed or live-tested on the signing VPS** |
| Scope | Development-only QDN test publishing on the owner-provisioned signing VPS |
| Base commit | `2f4a2e2f11000969bab4f487f8b7983f14c6ff61` |

## 1. Result in one paragraph

The manual credential maintenance is replaced by two independent, bounded
mechanisms. On the signing VPS, a small `qms-auth-supervisor` oneshot service
uses the External Auth app credentials to call `POST /sessions`, pushes the new
bearer token over a private Unix socket, and the broker validates it through a
read-only `GET /settings` call before atomically replacing the last known-good
token. The token never transits OpenClaw, Git, Telegram, logs or the repository.
The agent no longer relies on a one-hour Ed25519 session: it signs a
`POST /v1/auth/refresh` request with its registered key and receives a
15-minute access grant; every publication request carries both the Ed25519
signature and the grant. Grants are hash-only in broker state, revocable, and
bounded by the operator-registered key lifetime plus a configurable maximum
renewable lifetime. A credential reload never restarts the broker and never
touches publication state, idempotency records, resource locks, audit state or
budget reservations.

## 2. External Auth audit (pinned source)

Audited source: `https://gitea.qortal.org/crowetic/Qortal-External-Auth`,
version `0.2.0`, tree `7e5d498221cf15ccbc01e7241efbcd0c6e76d09c`. No package
was installed or called on the signing VPS during this work.

| Question | Finding | Consequence |
| --- | --- | --- |
| App identity | `POST /apps/register {name}` returns `appId` and `appSecret`; no authentication required on the loopback interface | The app secret is a signing-adjacent credential and must be root/supervisor-only |
| Session creation | `POST /sessions {appId, appSecret}` returns a random UUID token and `expiresAt` | Renewal is a local, non-admin operation scoped to one app |
| Token lifetime | `FileStore.createSession` uses `resolveSessionTtlSeconds(appId)`; default `sessionTtlSeconds=3600`, overridable per app/wallet through `POST /settings` | A one-hour default explains the manual expiry; it is configurable but not renewable in place |
| Session storage | Sessions live in an in-memory `Map`; only apps, wallets and persistent permissions are persisted | An External Auth restart invalidates every session and locks wallets; restart must not be part of renewal |
| Session scopes | `POST /sessions` stores `scopes: ['*']`; no route checks `session.scopes` | Scopes are informational; authority comes from `appId + walletId + permission` |
| Authorization model | `ensurePermission(appId, walletId, scope, approvalToken)` checks persistent permission, then in-memory session permission, then `authMode` (`ask`, `session`, `persistent`), then an approval token | A persistent `PUBLISH_QDN_RESOURCE` permission survives sessions and can be reused by every renewed session |
| Scoped renewal path | There is no refresh endpoint and no token rotation endpoint. The only renewal is another `POST /sessions` with the app secret | The supervisor needs the app secret, not the wallet, and can be a separate OS user |
| Revocation | No app-delete, session-revoke or token-revoke route exists. Restart clears sessions; `POST /permissions/set mode=ask` clears a permission for the calling app only; `POST /permissions/revoke` likewise requires a session for that app | Operator revocation is broker-side (kill switch + key revocation) or requires the app secret / External Auth restart. Broker controls are the practical boundary |
| Privilege escalation within the app | Any valid session can call `POST /permissions/set` and `POST /settings` for its own app, including granting another scope or changing `authMode`, `sessionTtlSeconds` and node URL | External Auth is **not** an isolation boundary. The broker must remain the only caller and must never expose the token |
| Scope of `/qdn/publish` | Requires a live session and `PUBLISH_QDN_RESOURCE` for the exact `walletId`; caller supplies service, name, identifier and fee | The broker's policy layer is still mandatory; External Auth enforces no target/fee/budget policy |
| Audit | Application audit events exist but are not tamper-evident | The broker keeps its own hash-chained ledger and records credential events without token values |

### Consequence for the architecture

External Auth is a private signing primitive. The signing app should contain
only the dedicated test wallet, its persistent permission should remain
`PUBLISH_QDN_RESOURCE`, and the app secret must be readable only by the
supervisor. The broker's kill switch, exact-name/owner policy, fee derivation,
budget and key revocation remain the security boundary.

## 3. Architecture and trust boundaries

```text
OpenClaw / development agent (no SSH/sudo on the signing host)
  |  Ed25519 signature over method/path/body-hash/timestamp/nonce
  |  + short-lived broker access grant
  v
qms-broker (user qms-broker)
  |  policy, fee quotes, 5 QORT budget, locks, audit, state
  |  <-- credential.sock 0660, directory 0710 qms-broker:qms-broker
  |      token pushed by qms-auth-supervisor (supplementary group qms-broker)
  |      validated with GET /settings, written atomically 0600, swapped in memory
  v
qortal-auth (user qortal-auth, 127.0.0.1:3191)
  |  wallet directory 0700, app permission PUBLISH_QDN_RESOURCE
  v
Qortal Core (loopback) -> exact Phase 5 base64/SHA-256 read-back
```

Trust rules:

1. OpenClaw has no SSH, sudo, wallet, External Auth admin credential, app
   secret, broker policy edit or kill-switch control on the signing host.
2. The supervisor holds the app secret and the External Auth loopback URL. It
   cannot read the wallet directory, broker state, broker audit or admin socket.
3. The broker holds the bearer token and the operator policy. It cannot read
   the app secret, wallet directory or External Auth state.
4. The token is accepted only after a successful read-only validation. A
   failed validation keeps the previous token and records a sanitized audit
   event.
5. External Auth is never restarted by the renewal path. Restarting it would
   clear sessions and wallet unlock and is an operator action.
6. The agent's only authority is its Ed25519 key plus a short-lived grant.

## 4. External Auth credential renewal

### Components

- `broker/src/credentials/supervisor.js` runs as
  `qms-auth-supervisor`, reads
  `/etc/qms-qdn-auth-credential/app.json` (0600, owner supervisor), and
  `/etc/qms-qdn-auth-credential/supervisor.json` (0600).
- It checks `/var/lib/qms-auth-credential/state.json` (0600). If the stored
  session has more than `renewBeforeMs` (default 20 minutes) left, it exits
  without calling External Auth.
- Otherwise it calls `POST /sessions` with `appId` and `appSecret`.
- It connects to `/run/qms-qdn-test-broker/credential.sock` and sends one
  JSON line: `{"schema":"qms-auth-credential@1","op":"renew","token":"...","expiresAt":...}`.
- The broker's credential socket calls `ExternalAuthCredentialStore.accept`:
  validates token shape and expiry bounds, calls `GET /settings` with the new
  bearer token, writes the token atomically to
  `/etc/qms-qdn-test-broker/external-auth-token` with mode 0600, then swaps the
  in-memory token.
- On success it records a non-secret state file and the broker appends
  `credential_renewed` with a SHA-256 fingerprint and expiry.
- On failure the broker appends `credential_renew_rejected` with a code and
  keeps the last known-good token; the supervisor exits nonzero so the
  systemd timer retries.

### File permissions

| Path | Owner:group | Mode | Purpose |
| --- | --- | --- | --- |
| `/etc/qms-qdn-test-broker` | `root:qms-broker` | 0750 | broker config, client public keys |
| `/etc/qms-qdn-test-broker/external-auth-token` | `qms-broker:qms-broker` | 0600 | broker's durable last-known-good token |
| `/etc/qms-qdn-auth-credential` | `root:qms-auth-supervisor` | 0700 | supervisor config and app secret |
| `/etc/qms-qdn-auth-credential/app.json` | `qms-auth-supervisor:qms-auth-supervisor` | 0600 | appId + appSecret |
| `/etc/qms-qdn-auth-credential/supervisor.json` | `qms-auth-supervisor:qms-auth-supervisor` | 0600 | loopback URL, socket/state paths |
| `/var/lib/qms-auth-credential` | `qms-auth-supervisor:qms-auth-supervisor` | 0700 | non-secret renewal state |
| `/run/qms-qdn-test-broker` | `qms-broker:qms-broker` | 0710 | admin socket (0600) and credential socket (0660) |
| `/var/lib/qms-qdn-test-broker` | `qms-broker:qms-broker` | 0700 | state, audit, kill switch |

The supervisor is a member of supplementary group `qms-broker` only to reach
the 0660 credential socket. It cannot open the 0600 admin socket or traverse
the 0700 state directory.

### Failure modes

| Failure | Behaviour |
| --- | --- |
| External Auth returns 401/403 | Supervisor exits 1, prints no token, broker token unchanged, audit rejection |
| External Auth unreachable/timeout | Same; timer retries in 5 minutes |
| Broker socket missing/refusing | Supervisor exits 1; no state file written; last token unchanged |
| New token fails `GET /settings` | Broker rejects; old token remains in memory and on disk |
| Token file missing/widened/wrong owner | Broker refuses startup or reload; publication fails closed |
| SIGHUP with invalid file | Reload rejected and audited; current token remains |
| Concurrent renewals | Each token is validated and written atomically; one wins as current; no file corruption |
| Broker restart | Token reloaded from the 0600 file; budget/state recovered by existing crash-recovery path |
| Supervisor or broker crash loop | No budget/state mutation from credential handling; kill switch and key revocation remain effective |

## 5. Agent access grants

### Flow

1. The agent signs `POST /v1/auth/refresh` with its registered Ed25519 key.
   The request uses the existing canonical string and nonce/timestamp replay
   protection. No access grant is required for this route.
2. `authorizeKeySession` checks: key exists, not disabled/revoked, not before
   `issuedAt`, not after `expiresAt`, and not older than
   `auth.maxAuthorizationLifetimeMs` (default 7 days).
3. The broker mints a random 32-byte grant, returns it once, and stores only
   its SHA-256 hash with `keyId`, `issuedAt`, `expiresAt` and `revoked`.
4. Every other route requires both the Ed25519 signature and
   `Authorization: Bearer <grant>`. The grant must hash to a stored entry bound
   to the same key and be unexpired/unrevoked.
5. Grants default to 15 minutes. The client refreshes automatically when fewer
   than 30 seconds remain and retries once after a grant error.

### Bounds and revocation

- `auth.accessTtlMs`: 60 s..1 h; default 15 minutes.
- `auth.maxAuthorizationLifetimeMs`: 1 h..30 days; default 7 days, measured
  from the operator-registered key `issuedAt`.
- `auth.maxGrantsPerKey`: 1..64; default 8. Oldest grants are pruned when the
  bound is reached.
- Operator `revoke-key` adds the key to `revokedKeys` and marks all its grants
  revoked. `unrevoke-key` restores the key but not old grants.
- Kill switch blocks refresh as well as publication.
- Access tokens are never written to audit logs or state in plaintext.

## 6. Broker reload and state preservation

The signing backend reads the current token on every `publish()` call rather
than caching it at startup. Credential acceptance and SIGHUP reload affect only
the token and its metadata. They do not:

- restart the process or close HTTP connections;
- rewrite or reinitialize `state.json`;
- clear `publications`, `idempotency`, `resourceLocks`, `budget`;
- clear the nonce cache or in-flight concurrency counters;
- change the audit chain.

State schema v1 is migrated to v2 on first open by adding an empty
`accessGrants` object; every existing publication, idempotency, lock, budget
and audit field is preserved. The migration is written atomically and only
after validation.

## 7. Operator installation and upgrade

The commands below are exact templates. Run them as root on the signing VPS
only. They are **not executed by this repository**.

### 7.1 Build and stage a pinned commit

```bash
cd /opt/qms-qdn-test-broker
git fetch --all
git checkout <PINNED_COMMIT>
npm ci --omit=dev
node --test test/phase5.2/*.test.js
```

### 7.2 Users, directories and units

```bash
useradd --system --home /nonexistent --shell /usr/sbin/nologin qms-broker
useradd --system --home /nonexistent --shell /usr/sbin/nologin qms-auth-supervisor
usermod -a -G qms-broker qms-auth-supervisor
install -m 0644 broker/systemd/qms-qdn-test-broker.tmpfiles.conf /etc/tmpfiles.d/qms-qdn-test-broker.conf
systemd-tmpfiles --create /etc/tmpfiles.d/qms-qdn-test-broker.conf
install -m 0644 broker/systemd/qms-qdn-test-broker.service /etc/systemd/system/
install -m 0644 broker/systemd/qms-auth-credential.service /etc/systemd/system/
install -m 0644 broker/systemd/qms-auth-credential.timer /etc/systemd/system/
systemctl daemon-reload
```

### 7.3 App credentials and supervisor config

Create the app once (operator-only; keep the secret off Telegram and out of
shell history where possible):

```bash
curl -sS -X POST http://127.0.0.1:3191/apps/register \
  -H 'content-type: application/json' \
  -d '{"name":"qms-qdn-test-broker"}'
```

Write the returned `appId` and `appSecret` to a 0600 file owned by
`qms-auth-supervisor` using an editor, not a command line that leaks them:

```bash
install -m 0600 -o qms-auth-supervisor -g qms-auth-supervisor /dev/null \
  /etc/qms-qdn-auth-credential/app.json
# edit /etc/qms-qdn-auth-credential/app.json:
# {"appId":"...","appSecret":"..."}
install -m 0600 -o qms-auth-supervisor -g qms-auth-supervisor \
  broker/supervisor.example.json /etc/qms-qdn-auth-credential/supervisor.json
```

Grant only `PUBLISH_QDN_RESOURCE` persistently for the test wallet. Use a
temporary session (created with the app secret) and then discard it:

```bash
# One-off operator command; do not store the token.
curl -sS -X POST http://127.0.0.1:3191/sessions \
  -H 'content-type: application/json' \
  -d "{"appId":"$APP_ID","appSecret":"$APP_SECRET"}"
# Then, with the returned bearer token in a shell variable:
curl -sS -X POST http://127.0.0.1:3191/permissions/set \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"walletId":"<TEST_WALLET_ID>","scope":"PUBLISH_QDN_RESOURCE","mode":"persistent"}'
unset TOKEN
```

### 7.4 Broker config

```bash
install -m 0640 -o root -g qms-broker broker/config.example.json \
  /etc/qms-qdn-test-broker/config.json
# Replace walletId and keep the fixed name/owner/policy.
```

Ensure `/etc/qms-qdn-test-broker/external-auth-token` exists, is owned by
`qms-broker`, mode 0600, and contains the current valid token before the first
broker start:

```bash
chown qms-broker:qms-broker /etc/qms-qdn-test-broker/external-auth-token
chmod 0600 /etc/qms-qdn-test-broker/external-auth-token
chown root:qms-broker /etc/qms-qdn-test-broker
chmod 0750 /etc/qms-qdn-test-broker
```

The supervisor cannot bootstrap the very first token because the broker must
already be listening on the credential socket.

### 7.5 Start and verify

```bash
touch /var/lib/qms-qdn-test-broker/DISABLED   # start disabled
systemctl enable --now qms-qdn-test-broker.service
systemctl enable --now qms-auth-credential.timer
systemctl start qms-auth-credential.service   # one immediate renewal
node broker/src/control.js /run/qms-qdn-test-broker/admin.sock status
```

Expected status fields: `disabled: true`, a credential fingerprint and expiry,
and `activeGrants`. No token value is returned.

Enable only for a supervised test window:

```bash
node broker/src/control.js /run/qms-qdn-test-broker/admin.sock \
  enable '{"confirm":"ENABLE"}'
```

### 7.6 Upgrade

```bash
cd /opt/qms-qdn-test-broker
git checkout <NEW_PINNED_COMMIT>
npm ci --omit=dev
systemctl stop qms-qdn-test-broker.service
install -m 0644 broker/systemd/qms-qdn-test-broker.service /etc/systemd/system/
install -m 0644 broker/systemd/qms-auth-credential.service /etc/systemd/system/
install -m 0644 broker/systemd/qms-auth-credential.timer /etc/systemd/system/
systemd-tmpfiles --create /etc/tmpfiles.d/qms-qdn-test-broker.conf
systemctl daemon-reload
systemctl start qms-qdn-test-broker.service
systemctl restart qms-auth-credential.timer
```

Before restarting, keep the existing token ownership valid:

```bash
chown qms-broker:qms-broker /etc/qms-qdn-test-broker/external-auth-token
chmod 0600 /etc/qms-qdn-test-broker/external-auth-token
chown root:qms-broker /etc/qms-qdn-test-broker
chmod 0750 /etc/qms-qdn-test-broker
```

The v1→v2 state migration preserves budget, reservations, idempotency and
locks. Take a copy of `/var/lib/qms-qdn-test-broker` first.

### 7.7 Rollback

```bash
systemctl stop qms-auth-credential.timer qms-auth-credential.service
systemctl stop qms-qdn-test-broker.service
cp -a /var/lib/qms-qdn-test-broker /var/lib/qms-qdn-test-broker.rollback-$(date -u +%Y%m%dT%H%M%SZ)
cd /opt/qms-qdn-test-broker
git checkout <PREVIOUS_PINNED_COMMIT>
npm ci --omit=dev
install -m 0644 broker/systemd/qms-qdn-test-broker.service /etc/systemd/system/
systemctl daemon-reload
systemctl start qms-qdn-test-broker.service
```

Recreate the `DISABLED` file before rollback if publication must remain off.
Old broker versions ignore `accessGrants` but the state schema is now
`qms-test-broker-state@2`; a pre-migration broker will refuse it. Roll back to
the last commit that understands schema v2, or restore a pre-upgrade state
copy only with operator approval.

### 7.8 Revocation and emergency disable

```bash
# Immediate: stop all publication and refresh.
touch /var/lib/qms-qdn-test-broker/DISABLED
node broker/src/control.js /run/qms-qdn-test-broker/admin.sock \
  disable '{"reason":"incident"}'

# Revoke the agent key and all its grants.
node broker/src/control.js /run/qms-qdn-test-broker/admin.sock \
  revoke-key '{"keyId":"agent-main-2026-11","reason":"incident"}'

# External Auth side (operator-only): disable the app permission.
# Use the app secret to create a temporary session, then:
curl -sS -X POST http://127.0.0.1:3191/permissions/set \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"walletId":"<TEST_WALLET_ID>","scope":"PUBLISH_QDN_RESOURCE","mode":"ask"}'
```

External Auth has no token-revoke route. Restarting it clears all sessions and
wallet unlock, but also requires the operator to unlock the wallet again. Do
not automate that restart in the supervisor.

## 8. Verification evidence

- `npm run test:phase5.2`: **97 passed, 0 failed** (implementation branch).
- New tests cover: credential load/validation, widened file refusal, atomic
  renewal, failed renewal retaining the old token, SIGHUP failure, socket
  permissions, socket renewal/status, supervisor skip/renew/failure/concurrency,
  grant minting, hash-only persistence, grant expiry, wrong key, revocation,
  grant bounds, refresh replay, forged signature, kill switch on refresh,
  concurrent refresh, budget/reservation/idempotency preservation across
  reload and state reopen, and audit-chain verification.
- The live signing VPS was not contacted. No External Auth call, wallet
  operation, token creation, signing or QDN publication was performed.

## 9. Remaining limitations and unverified items

1. The signing VPS still runs the old broker and token flow. Installing this
   branch, creating the supervisor user/app secret, and enabling the timer are
   operator actions and were **not** performed.
2. `GET /settings` token validation is verified against a mock External Auth
   response and the pinned source, not against the live daemon.
3. External Auth session lifetime is configured by its own settings; the
   supervisor renews before expiry but cannot prevent an operator from
   shortening or lengthening `sessionTtlSeconds`.
4. External Auth cannot revoke an individual session or app. Broker key
   revocation and the kill switch are the enforceable controls; External Auth
   permission revocation requires the app secret and is documented but not
   automated.
5. An External Auth restart invalidates sessions and wallet unlock. This design
   deliberately never restarts it; recovery from an External Auth crash still
   requires operator wallet unlock.
6. The supervisor's systemd sandbox and file permissions are templates. Their
   live effectiveness (including group membership and socket access) is
   unverified without signing-VPS access.
7. The agent refresh path assumes the agent host clock is within the broker's
   ±120 s window.

## 10. Safety statement

No wallet was imported, created, unlocked, backed up or exported. No seed,
private key, wallet password or External Auth app secret was requested or
transmitted. No External Auth instance was installed, configured or called. No
Qortal Core configuration or signing-VPS service was changed. No QDN resource
was published and no transaction was signed or submitted.
