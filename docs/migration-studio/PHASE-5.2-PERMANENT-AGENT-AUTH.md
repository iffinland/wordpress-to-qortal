# Phase 5.2.2 — Permanent agent authorization

| Field | Value |
| --- | --- |
| Document | Persistent Ed25519 agent identity, direct request signatures and durable replay protection |
| Date | 2026-11-03 |
| Status | Implementation and deterministic tests complete; **not installed or live-tested on the signing VPS** |
| Scope | Development-only QDN test publishing on the owner-provisioned signing VPS |
| Base commit | `ea318e83b9776815d459f451eaa63d2815dd0181` |
| Replaces | The 15-minute access-grant and 7-day maximum-renewable-lifetime layer |

## 1. Result in one paragraph

The development agent now has one persistent Ed25519 identity. It signs every
broker request directly over the canonical method, path, body hash, timestamp
and nonce. The broker verifies the registered public key, a ±120 s timestamp
window, a nonce replay claim and the operator revocation list. There is no
login, session, access grant, refresh route, background renewal or
authorization lifetime: the key authenticates indefinitely until the operator
revokes it. Replay claims are persisted in broker state, so a broker restart
inside the timestamp window cannot reopen a captured request. External Auth
session renewal remains unchanged and fully automatic through the existing
supervisor. All publishing restrictions, the 5 QORT / 24 h budget, the 0.1 QORT
reserve, Core-derived fees, audit logging, key revocation and the emergency
kill switch are preserved.

## 2. Removed and replaced

| Removed | Replacement |
| --- | --- |
| `POST /v1/auth/refresh` | No replacement; every route is directly signed |
| `accessGrants` state and `grants.js` | Persistent key registry plus state-backed revocation |
| 15-minute `auth.accessTtlMs` | Per-request timestamp window `auth.clockSkewMs` |
| 7-day `auth.maxAuthorizationLifetimeMs` | No authorization lifetime |
| `auth.maxGrantsPerKey` | No grant pool |
| `auth.maxRequestAgeMs` (duplicate, unused) | `auth.clockSkewMs` |
| `authorizeKeySession()` | `authenticateRequest()` on every request |
| `AUTH_GRANT_*` and `AUTH_REFRESH_LIMIT` | Existing `AUTH_REQUIRED`, `AUTH_INVALID`, `AUTH_EXPIRED`, `AUTH_REPLAY`, `AUTH_KEY_UNKNOWN`, `AUTH_KEY_REVOKED` |
| Client access-token cache and refresh retry | Direct signature per request, no retry after ambiguous work |

The HTTP surface is now four routes:

- `GET /v1/health` — unauthenticated liveness; always 200 while the process is
  alive, with `disabled` reflecting the kill switch;
- `POST /v1/publications` — authenticated publication;
- `GET /v1/publications/{id}` — authenticated stored record;
- `POST /v1/publications/{id}/verify` — authenticated read-only verification.

## 3. Persistent key registry

The operator-owned file is `/etc/qms-qdn-test-broker/clients.json`, mode 0640,
owner `root:qms-broker`:

```json
{
  "schema": "qms-broker-client-keys@2",
  "keys": [
    {
      "keyId": "agent-main-2026-11",
      "publicKeyPem": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----\n",
      "createdAt": "2026-11-03T10:00:00.000Z",
      "enabled": true
    }
  ]
}
```

- `keyId` is stable and is the audit identity.
- `publicKeyPem` must be an Ed25519 SubjectPublicKeyInfo PEM.
- `createdAt` is an audit timestamp, not an activation or expiry bound.
- `enabled: false` disables the key in the file; omitted means enabled.
- There is no `expiresAt`. A key stays valid until explicit revocation.

Revocation is state-backed. `revoke-key` adds the keyId to `revokedKeys`;
`unrevoke-key` removes it. The state list survives restart and is checked on
every request before signature verification. The private key never leaves the
agent host.

Legacy entries with `issuedAt`/`expiresAt` are accepted during the upgrade so
the agent is not locked out. Their expiry is ignored, the key object carries no
`expiresAt`, and the broker logs a migration warning naming the key. The
operator should rewrite `clients.json` to the schema above.

## 4. Request authentication and replay protection

Canonical string:

```text
qms-qdn-test-broker-v1
<METHOD>
<path>
<sha256 hex of the exact request body bytes>
<timestamp ms>
<nonce>
```

Headers:

```text
x-qms-key-id: agent-main-2026-11
x-qms-timestamp: 1793700000000
x-qms-nonce: 7vQm...
x-qms-signature: <base64url Ed25519 signature>
```

Checks, all fail-closed:

1. all four headers present and well-formed;
2. keyId known, not disabled in the file, not in `revokedKeys`;
3. timestamp inside `now ± auth.clockSkewMs` (default ±120 s);
4. nonce matches `[A-Za-z0-9_-]{16,128}`;
5. Ed25519 signature verifies over the exact method, path, body bytes,
   timestamp and nonce;
6. nonce is new in the in-memory cache (concurrent duplicate gate);
7. nonce is new in durable broker state (restart-safe gate).

The nonce is remembered only after the signature verifies, so unauthenticated
traffic cannot consume nonce space. Durable entries are pruned at startup and
on every claim; retention is `auth.nonceTtlMs` (default 10 minutes), which is
longer than the timestamp window. A replayed request after a broker restart is
rejected with `401 AUTH_REPLAY`.

## 5. State migration and preserved accounting

State schema is now `qms-test-broker-state@3`.

| Input | Migration |
| --- | --- |
| v1 `qms-test-broker-state@1` | Add `requestNonces: {}`; preserve all fields |
| v2 `qms-test-broker-state@2` | Drop `accessGrants`; add `requestNonces: {}`; preserve all other fields |
| v3 | Validate as-is |

The migration is atomic and happens on first open. It never rewrites
`publications`, `idempotency`, `resourceLocks`, `budget`,
`budget.reservations`, `revokedKeys`, `disabled`, `disabledAt` or
`disabledReason`. Crash recovery still converts any in-flight reservation to
`ambiguous` and charges it rather than restoring budget.

## 6. Operator upgrade on the signing VPS

These commands are templates for the operator. They were **not executed by this
repository** and must be run as root on the signing VPS, where the broker is
currently stopped and commit `ea318e8` is installed.

Substitute:

- `<NEW_SHA>` with the new branch HEAD (see the final report / remote).
- `<APP_ID>` and `<TEST_WALLET_ID>` only where already known to the operator;
  never paste the app secret or a wallet secret into shell history.

### 6.1 Record the pre-upgrade state and back up

```bash
set -euo pipefail
TS=$(date -u +%Y%m%dT%H%M%SZ)
install -d -m 0700 -o root -g root /var/backups/qms-qdn-test-broker
systemctl stop qms-qdn-test-broker.service || true
systemctl stop qms-auth-credential.timer qms-auth-credential.service || true

cp -a /var/lib/qms-qdn-test-broker \
  /var/backups/qms-qdn-test-broker/${TS}-var-lib
cp -a /etc/qms-qdn-test-broker \
  /var/backups/qms-qdn-test-broker/${TS}-etc
chmod -R go-rwx /var/backups/qms-qdn-test-broker

cd /opt/qms-qdn-test-broker
git rev-parse HEAD > /var/backups/qms-qdn-test-broker/${TS}-previous-sha.txt
sha256sum /var/lib/qms-qdn-test-broker/state.json \
  /etc/qms-qdn-test-broker/clients.json \
  /etc/qms-qdn-test-broker/config.json \
  > /var/backups/qms-qdn-test-broker/${TS}-checksums.txt
node broker/src/control.js /run/qms-qdn-test-broker/admin.sock status \
  > /var/backups/qms-qdn-test-broker/${TS}-pre-status.json 2>/dev/null || true
```

The pre-upgrade status or the state file records the current
`budget.spentAtomic`, `budget.windowStart`, publication count and
`revokedKeys`. Keep these to prove preservation after the upgrade.

### 6.2 Deploy the new commit

```bash
cd /opt/qms-qdn-test-broker
git fetch origin
git checkout <NEW_SHA>
git rev-parse HEAD
npm ci --omit=dev
node --test test/phase5.2/*.test.js
```

### 6.3 Migrate `clients.json` to the persistent schema

Use an editor as root, or convert the existing legacy key entries and remove
the expiry fields:

```bash
cd /opt/qms-qdn-test-broker
cp /etc/qms-qdn-test-broker/clients.json \
  /etc/qms-qdn-test-broker/clients.json.pre-v2

node --input-type=module <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
const path = '/etc/qms-qdn-test-broker/clients.json';
const old = JSON.parse(readFileSync(path, 'utf8'));
const keys = (old.keys ?? []).map((key) => ({
  keyId: key.keyId,
  publicKeyPem: key.publicKeyPem,
  createdAt: key.createdAt ?? key.issuedAt ?? new Date().toISOString(),
  enabled: key.enabled !== false && key.disabled !== true
}));
if (keys.length === 0) throw new Error('no client keys found');
writeFileSync(path, JSON.stringify({ schema: 'qms-broker-client-keys@2', keys }, null, 2) + '\n');
NODE

chown root:qms-broker /etc/qms-qdn-test-broker/clients.json
chmod 0640 /etc/qms-qdn-test-broker/clients.json
```

The conversion keeps the keyId and public key, derives `createdAt` from the
old `issuedAt`, and removes both `issuedAt` and `expiresAt`. The agent private
key is untouched and does not exist on this host.

### 6.4 Remove obsolete configuration fields

`validateConfig` ignores unknown keys, but leaving the old fields is
misleading. Remove only the obsolete auth fields:

```bash
cp /etc/qms-qdn-test-broker/config.json \
  /etc/qms-qdn-test-broker/config.json.pre-v3

node -e "
const fs = require('fs');
const p = '/etc/qms-qdn-test-broker/config.json';
const c = JSON.parse(fs.readFileSync(p, 'utf8'));
for (const key of ['accessTtlMs', 'maxAuthorizationLifetimeMs', 'maxGrantsPerKey', 'maxRequestAgeMs']) {
  delete c.auth[key];
}
fs.writeFileSync(p, JSON.stringify(c, null, 2) + '\n');
"
chown root:qms-broker /etc/qms-qdn-test-broker/config.json
chmod 0640 /etc/qms-qdn-test-broker/config.json
```

There are no separate grant files to delete. The obsolete grant entries live
only inside `state.json` under `accessGrants`; the v2→v3 migration drops the
whole map.

### 6.5 Migrate broker state before starting the service

Run the migration as the broker user so ownership stays correct:

```bash
cd /opt/qms-qdn-test-broker
runuser -u qms-broker -- node --input-type=module <<'NODE'
import { BrokerState } from './broker/src/state.js';
const state = await BrokerState.open({
  path: '/var/lib/qms-qdn-test-broker/state.json',
  fsync: true
});
const snapshot = state.snapshot();
console.log(JSON.stringify({
  schema: snapshot.schema,
  version: snapshot.version,
  hasAccessGrants: Object.hasOwn(snapshot, 'accessGrants'),
  requestNonces: Object.keys(snapshot.requestNonces).length,
  spentAtomic: snapshot.budget.spentAtomic,
  windowStart: snapshot.budget.windowStart,
  publications: Object.keys(snapshot.publications).length,
  revokedKeys: snapshot.revokedKeys
}, null, 2));
NODE
```

Expected: `schema` `qms-test-broker-state@3`, `version` `3`,
`hasAccessGrants` `false`, and the same budget/publication/revocation values
recorded in 6.1.

### 6.6 Verify file ownership and permissions

```bash
chown root:qms-broker /etc/qms-qdn-test-broker
chmod 0750 /etc/qms-qdn-test-broker
chown root:qms-broker /etc/qms-qdn-test-broker/clients.json
chmod 0640 /etc/qms-qdn-test-broker/clients.json
chown root:qms-broker /etc/qms-qdn-test-broker/config.json
chmod 0640 /etc/qms-qdn-test-broker/config.json
chown qms-broker:qms-broker /var/lib/qms-qdn-test-broker
chmod 0700 /var/lib/qms-qdn-test-broker
chown qms-broker:qms-broker \
  /var/lib/qms-qdn-test-broker/state.json \
  /var/lib/qms-qdn-test-broker/audit.jsonl \
  /var/lib/qms-qdn-test-broker/external-auth-token
chmod 0600 \
  /var/lib/qms-qdn-test-broker/state.json \
  /var/lib/qms-qdn-test-broker/audit.jsonl \
  /var/lib/qms-qdn-test-broker/external-auth-token
stat -c '%U:%G %a %n' \
  /etc/qms-qdn-test-broker \
  /etc/qms-qdn-test-broker/clients.json \
  /etc/qms-qdn-test-broker/config.json \
  /var/lib/qms-qdn-test-broker \
  /var/lib/qms-qdn-test-broker/state.json
```

No systemd unit change is required for this commit. Keep the existing
`qms-qdn-test-broker.service`, `qms-auth-credential.service` and
`qms-auth-credential.timer`.

### 6.7 Start and verify

```bash
systemctl start qms-qdn-test-broker.service
systemctl enable --now qms-auth-credential.timer
systemctl start qms-auth-credential.service
sleep 2

curl -sS http://127.0.0.1:3199/v1/health
# {"status":"ok","disabled":false}
# or {"status":"ok","disabled":true} if the kill switch is present

curl -sS -o /dev/null -w '%{http_code}\n' \
  -X POST http://127.0.0.1:3199/v1/auth/refresh
# 404

node broker/src/control.js /run/qms-qdn-test-broker/admin.sock status
```

Expected status: `disabled`, `publications`, `revokedKeys`, `budget` and
`replayEntries`; no `activeGrants`, no token. A successful agent request
increments `replayEntries` and appends an `api_request` audit entry. The audit
entry contains keyId, method, path and remote address, never a signature,
nonce, token or payload.

If the broker starts with `DISABLED` present, publication returns 503 while
health stays 200. Verify the kill switch deliberately:

```bash
touch /var/lib/qms-qdn-test-broker/DISABLED
curl -sS http://127.0.0.1:3199/v1/health
# {"status":"ok","disabled":true}
node broker/src/control.js /run/qms-qdn-test-broker/admin.sock \
  enable '{"confirm":"ENABLE"}'
```

Revocation is immediate. Use a throwaway canary key entry if you want to test
without revoking the production agent key:

```bash
node broker/src/control.js /run/qms-qdn-test-broker/admin.sock \
  revoke-key '{"keyId":"canary-key","reason":"upgrade verification"}'
node broker/src/control.js /run/qms-qdn-test-broker/admin.sock \
  unrevoke-key '{"keyId":"canary-key"}'
```

Finally, from the agent host, run one authenticated read (for example
`client.getPublication(...)`) and confirm `200`. Do not publish a live QDN
resource as part of the upgrade unless separately authorized.

### 6.8 Rollback

The new broker writes schema v3; `ea318e8` understands only v1/v2. A rollback
therefore requires restoring the pre-upgrade state copy as well as the old
commit:

```bash
set -euo pipefail
TS=$(date -u +%Y%m%dT%H%M%SZ)
systemctl stop qms-qdn-test-broker.service
systemctl stop qms-auth-credential.timer qms-auth-credential.service

cp -a /var/lib/qms-qdn-test-broker \
  /var/backups/qms-qdn-test-broker/${TS}-failed-upgrade-var-lib

# Restore the pre-upgrade state and configuration from 6.1.
rm -rf /var/lib/qms-qdn-test-broker
cp -a /var/backups/qms-qdn-test-broker/<BACKUP_TS>-var-lib \
  /var/lib/qms-qdn-test-broker
cp -a /etc/qms-qdn-test-broker \
  /var/backups/qms-qdn-test-broker/${TS}-failed-upgrade-etc
rm -rf /etc/qms-qdn-test-broker
cp -a /var/backups/qms-qdn-test-broker/<BACKUP_TS>-etc /etc/qms-qdn-test-broker

cd /opt/qms-qdn-test-broker
git checkout ea318e83b9776815d459f451eaa63d2815dd0181
npm ci --omit=dev
install -m 0644 broker/systemd/qms-qdn-test-broker.service /etc/systemd/system/
systemctl daemon-reload
systemctl start qms-qdn-test-broker.service
```

Recreate `DISABLED` before rollback if publication must remain off. Do not
attempt to run the new commit against the old state file or the old commit
against a v3 state file.

## 7. Verification evidence

- `npm run test:phase5.2`: **93 passed, 0 failed** on the implementation
  branch (the two removed grant suites were replaced by permanent-auth,
  restart/replay and state-migration tests).
- Full repository `npm test`: **264 passed, 0 failed**.
- `npm run test:phase5`: **24 passed, 0 failed**.
- Desktop `npm run typecheck`: passed; `npm test`: **28 passed, 0 failed**
  (10 files).
- Publisher/viewer `npm run migration:build`: passed (Vite production build).
- New coverage: repeated direct signatures with no expiry; legacy expired keys
  accepted with expiry ignored; wrong key, bad signature, stale/future
  timestamp and replayed nonce rejected; revoked/disabled keys rejected;
  revocation survives restart; durable nonce claim survives reopen and prunes
  on expiry; v1→v3 and v2→v3 migrations preserve budget, reservations,
  publications, idempotency, locks and revocations while dropping
  `accessGrants`; credential reload preserves all state; kill switch blocks
  publication while health remains available; source scan proves no
  grant/refresh/7-day/15-minute code paths remain.
- The signing VPS was not contacted. No External Auth call, wallet operation,
  token creation, signing or QDN publication was performed.

## 8. Remaining limitations

1. The signing VPS still runs the old broker (stopped). Installing this branch
   is an operator action and was not performed.
2. Durable replay state grows with authenticated request rate for up to
   `auth.nonceTtlMs`. It is pruned on every claim; a very high request rate
   would increase `state.json` writes. This is acceptable for one agent and
   batch publication traffic.
3. Clock correctness remains an operational requirement: both hosts must stay
   within ±120 s.
4. External Auth session renewal, wallet unlock and the supervisor are
   unchanged and still require the operator-provided app secret and wallet
   unlock policy. External Auth has no token-revoke route.
5. The broker key registry is a file, not a database. Key rotation is an
   operator edit plus a service restart; revocation is immediate without a
   restart.

## 9. Safety statement

No wallet was imported, created, unlocked, backed up or exported. No seed,
private key, wallet password or External Auth app secret was requested or
transmitted. No External Auth instance was installed, configured or called. No
Qortal Core configuration or signing-VPS service was changed. No QDN resource
was published and no transaction was signed or submitted.
