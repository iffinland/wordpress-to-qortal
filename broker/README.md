# QDN test publication policy broker

This directory contains the Phase 5.2 development-only signing broker. It is
**not** part of the user-facing Migration Studio workflow and it must never be
deployed on the Qortal node or on a host where the development agent has an
account, sudo, Docker control or SSH access.

## Why it exists

Qortal External Auth can sign QDN publications, but it has no target allowlist,
fee budget, transaction-count limit or independent kill switch. Giving that API
to an autonomous agent would be equivalent to giving it the test wallet.

The broker sits between OpenClaw and External Auth:

```text
OpenClaw (agent)
  |  persistent Ed25519 request signature, timestamp + nonce
  v
QDN test broker (unprivileged qms-broker user, loopback/private bind)
  |  bearer token, ONLY POST /qdn/publish, fixed walletId + nodeUrl
  |  <-- renewed token pushed over /run/qms-qdn-test-broker/credential.sock
  |      by qms-auth-supervisor (separate user, holds the app secret)
  v
Qortal External Auth (qortal-auth user, 127.0.0.1:3191, wallet dir 0700)
  |  Qortal Core transaction submission
  v
Qortal Core (existing node; read-only API for name, collision and byte checks)
  |
  v
Exact Phase 5 base64 read-back with SHA-256
```

## Broker API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/v1/health` | Unauthenticated liveness; never blocked by the kill switch |
| POST | `/v1/publications` | Validate, reserve budget, sign and verify one batch |
| GET | `/v1/publications/{id}` | Read the stored publication record |
| POST | `/v1/publications/{id}/verify` | Read-only re-verification; never signs |

There is no `/tx/sign`, `/wallet/*`, `/node/proxy` or `/qortal/request`
route. Requests containing `walletId`, `nodeUrl`, `password`,
`unsignedBytes`, `privateKey` or `seedPhrase` are rejected before policy
evaluation.

### Request schema

```json
{
  "schema": "qms-test-publication-request@2",
  "requestId": "req_00000001",
  "projectId": "prj_corbett-test",
  "target": {
    "name": "developer iffi",
    "ownerAddress": "QipPqwJeLtx89dXcSkY7vimMUNT8Gy5k2E"
  },
  "resources": [
    {
      "id": "res_00000001",
      "service": "DOCUMENT",
      "identifier": "qms-dev-hello-001",
      "contentType": "text/plain",
      "bytes": 14,
      "sha256": "sha256:<64 lowercase hex>",
      "dataBase64": "<canonical base64>"
    }
  ],
  "handoff": null
}
```

`handoff` is optional. When supplied it must be a sealed
`qms-publication-handoff@1` manifest whose project, target, resource triples,
byte lengths and SHA-256 values match the request. The Phase 5
`assertHandoffManifest` validator is reused.

### Policy (default, fail-closed)

- exact target name `developer iffi` and exact configured owner address;
- `DOCUMENT` only;
- identifier prefix `qms-dev-` with a non-empty suffix;
- content types `text/plain`, `text/markdown`, `text/html`,
  `application/json`;
- at most 20 resources and 20 transactions per request;
- 1 MiB per resource and 4 MiB total payload;
- fees are never supplied by the caller: each resource is quoted with the
  node's read-only `POST /transactions/fee` endpoint, cross-checked against
  `GET /transactions/unitfee?txType=ARBITRARY`, and passed explicitly to the
  signing backend;
- 5 QORT rolling 24 h budget with a 0.1 QORT confirmed-wallet reserve; the
  complete batch fee is reserved atomically before signing;
- publication is rejected when the exact fee, confirmed balance or budget
  cannot be proven;
- one persistent Ed25519 identity per agent; authorization has no expiry and
  ends only on explicit operator revocation (state) or `enabled: false`
  (client key file);
- every request is signed directly over method, path, body hash, timestamp and
  nonce; no session, refresh loop or bearer credential;
- existing QDN identities rejected unless `allowResourceUpdates` is explicitly
  enabled by an operator policy (off by default);
- ambiguous and pending outcomes are never resubmitted automatically.

### Authentication

Every broker request is signed directly with the agent's persistent Ed25519
key. There is no login, session, access grant, refresh route or token:

```text
x-qms-key-id: agent-main-2026-11
x-qms-timestamp: 1793700000000
x-qms-nonce: 7vQm...
x-qms-signature: <base64url Ed25519 signature>
```

Canonical string (newline separated):

```text
qms-qdn-test-broker-v1
<METHOD>
<path>
<sha256 hex of the exact request body bytes>
<timestamp ms>
<nonce>
```

The broker verifies:

- the key exists in the operator-owned registry and is not disabled;
- the key is not in the state-backed revocation list;
- the timestamp is inside the ±120 s window;
- the nonce is unique for that key inside `auth.nonceTtlMs`;
- the Ed25519 signature matches the exact method, path, body bytes, timestamp
  and nonce.

A key has **no expiry**. It authenticates indefinitely until the operator runs
`revoke-key` or sets `enabled: false` in `clients.json`. Replay claims are
written to broker state, so a restart inside the timestamp window cannot make
a captured request replayable. The in-memory cache remains the fast
concurrent-duplicate gate.

The client registry schema is:

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

Legacy entries with `issuedAt`/`expiresAt` are accepted for upgrade safety,
but their expiry is ignored and the broker logs a migration warning. The agent
holds only its private key; the broker never sees a wallet, seed, password or
External Auth token.

### Operator control

Admin operations use a Unix socket (default
`/run/qms-qdn-test-broker/admin.sock`, mode 0600 in a 0700 directory):

```bash
node broker/src/control.js /run/qms-qdn-test-broker/admin.sock status
node broker/src/control.js /run/qms-qdn-test-broker/admin.sock disable '{"reason":"incident"}'
node broker/src/control.js /run/qms-qdn-test-broker/admin.sock enable '{"confirm":"ENABLE"}'
node broker/src/control.js /run/qms-qdn-test-broker/admin.sock revoke-key '{"keyId":"agent-main-2026-11","reason":"rotation"}'
node broker/src/control.js /run/qms-qdn-test-broker/admin.sock status
```

`revoke-key` takes effect on the next request; there is no cached session to
expire. `unrevoke-key` restores the same persistent key. `status` reports the
signing credential fingerprint and expiry, the budget, replay-entry count and
revocation count, never the token.

An independent emergency stop also works without the broker API: create the
configured kill-switch file (default
`/var/lib/qms-qdn-test-broker/DISABLED`) as the broker user. The broker checks
it on every request and fails closed if the check itself fails.

## Files

- `src/policy.js` — request validation and policy limits;
- `src/service.js` — preflight, budget reservation, signing orchestration,
  Phase 5 exact read-back;
- `src/auth.js` — persistent Ed25519 key registry, direct request
  authentication and in-memory replay gate;
- `src/credentials/store.js` — last-known-good External Auth credential,
  atomic 0600 writes and validated swaps;
- `src/credentials/socket.js` — private Unix-socket credential renewal ingress;
- `src/credentials/supervisor.js` — signing-host-local session renewal CLI;
- `src/state.js` — atomic broker state, budget ledger, resource locks;
- `src/audit.js` — append-only hash-chained audit JSONL;
- `src/signing/external-auth.js` — narrow External Auth client;
- `src/signing/mock.js` — deterministic test backend;
- `src/server.js` — four-route HTTP API and Unix-socket admin server;
- `src/index.js` — process entrypoint;
- `src/control.js` — operator CLI;
- `src/client.js` — agent-side Ed25519 client (`publish`, `getPublication`,
  `verifyPublication`) that signs every request directly; no session, refresh
  loop, wallet or External Auth credential.

## Local development

```bash
cd /path/to/wordpress-to-qortal
node --test test/phase5.2/*.test.js
```

The mock backend is only allowed by the entrypoint with
`QMS_BROKER_ALLOW_MOCK=1`. It must never be used in production.

## Deployment

For the External Auth publishing failure analysis, the fee/atomic-unit fix,
redacted Core signing diagnostics, the Core API key requirement for
`POST /arbitrary/.../base64`, the final operator deployment script
(`broker/scripts/deploy-phase5.2-core-rejection-fix.sh`), the config-resolved
token path, the pre-broker session provisioner, the conditional wallet unlock
step and the restricted SSH maintenance design, see
`docs/migration-studio/PHASE-5.2-EXTERNAL-AUTH-FAILURE-ANALYSIS.md`.

The final deployment does not patch or rebuild External Auth. It reads
`signing.externalAuth.tokenFile` from the installed broker config, provisions a
replacement External Auth session before starting the broker, and lets the
normal credential supervisor renew it through `credential.sock` afterwards. If
the Core API key is already configured and loaded, External Auth is not
restarted and no wallet unlock is required.

See `docs/migration-studio/PHASE-5.2-TEST-PUBLISHING-BROKER.md` for the threat
model, isolation boundaries, External Auth audit and the exact operator
provisioning steps, and
`docs/migration-studio/PHASE-5.2-CREDENTIAL-LIFECYCLE.md` for the automatic
External Auth credential renewal and
`docs/migration-studio/PHASE-5.2-PERMANENT-AGENT-AUTH.md` for the persistent
key model, state migration, upgrade and rollback. The broker itself never creates, imports, unlocks or backs up a
wallet.
