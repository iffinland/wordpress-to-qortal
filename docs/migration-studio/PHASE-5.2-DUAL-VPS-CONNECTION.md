# Phase 5.2 — Dual-VPS broker connection

Status: diagnostic complete; live broker authentication and test publication are
blocked pending one operator command on the signing VPS. No QDN write, wallet
operation or signing-VPS change was performed.

## 1. Verified topology

- Development VPS: `qortium` — public `80.241.221.139`, Tailscale
  `100.126.132.126`.
- Signing VPS: `vmi3490660` — public `169.58.135.102`, Tailscale
  `100.94.134.84`, MagicDNS `vmi3490660.tailb239e8.ts.net`.
- Tailscale peer is online; `tailscale ping 100.94.134.84` succeeds over the
  public path in ~29 ms.
- Development clock is synchronized (NTP active, ~0 s offset).
- Public `169.58.135.102:3199` and `:3191` time out; the broker and External
  Auth are not publicly exposed.
- Broker listens on `127.0.0.1:3199`; direct
  `http://100.94.134.84:3199/v1/health` fails.
- Signing-host ports 80 and 443 are reachable on the Tailscale IP.
- `http://vmi3490660.tailb239e8.ts.net/` returns `308 Permanent Redirect`
  to HTTPS with `Server: Caddy`.
- TLS on `vmi3490660.tailb239e8.ts.net:443` fails with
  `tlsv1 alert internal error`; no peer certificate is presented.
- Port 8443 is closed; 3199 and 3191 are closed on the Tailscale IP.

### Diagnosis

Caddy on the signing VPS owns `*:80` and `*:443` and therefore answers on the
Tailscale IP. It redirects HTTP to HTTPS but has no certificate for the
Tailscale hostname, so the TLS handshake is refused. Tailscale Serve is not
serving on 443. Reconfiguring Caddy or stopping it to free 443 would risk the
existing DuckDNS/Hub routes, so the broker must use a separate Tailscale Serve
HTTPS port.

## 2. Required architecture

```text
OpenClaw (qortium, 100.126.132.126)
  -> https://vmi3490660.tailb239e8.ts.net:8443
  -> Tailscale Serve (signing VPS, TLS terminated by Tailscale)
  -> http://127.0.0.1:3199
  -> QMS broker
  -> http://127.0.0.1:3191 (External Auth)
  -> Qortal Core
```

No Funnel, no public broker port, no External Auth exposure, no SSH/sudo from
the development agent to the signing VPS, and no wallet material on the
development VPS.

## 3. One operator command (signing VPS)

Run as the signing-VPS operator with sudo:

```bash
sudo tailscale serve --bg --https=8443 3199
```

This idempotently maps Tailscale HTTPS port 8443 to the loopback broker on
3199. It does not touch Caddy on 80/443 and does not expose a public port.

Preconditions:

1. Tailscale HTTPS certificates are enabled for the tailnet (MagicDNS is
   already enabled). If the command reports that HTTPS is not enabled, enable
   HTTPS certificates in the Tailscale admin console; no shell-only workaround
   is acceptable.
2. The tailnet ACL restricts `tcp:8443` to the development node
   (`qortium` / `100.126.132.126`). Tailscale Serve is otherwise reachable by
   other tailnet members; broker Ed25519 authentication remains mandatory.
3. Do not use `tailscale funnel`; do not open 8443 in the public firewall.
4. Verify the existing Caddy/DuckDNS/Hub routes are untouched.

Operator verification on the signing VPS:

```bash
sudo tailscale serve status
curl -fsS http://127.0.0.1:3199/v1/health
```

Expected health: `{"status":"ok","disabled":false}`.

## 4. Development-VPS verification (after the operator command)

```bash
curl -fsS https://vmi3490660.tailb239e8.ts.net:8443/v1/health
```

Expected: `{"status":"ok","disabled":false}`.

Then run one authenticated read-only broker request. The agent key is
`/home/iffi/.config/qms-broker/agent.key`; the keyId must match the operator's
`/etc/qms-qdn-test-broker/clients.json` (documented example:
`agent-main-2026-11`).

```js
import { readFileSync } from 'node:fs';
import { BrokerClient } from './broker/src/client.js';

const client = new BrokerClient({
  baseUrl: 'https://vmi3490660.tailb239e8.ts.net:8443',
  keyId: process.env.QMS_AGENT_KEY_ID ?? 'agent-main-2026-11',
  privateKey: readFileSync('/home/iffi/.config/qms-broker/agent.key')
});

try {
  await client.getPublication('pub_000000000000000000000000');
} catch (error) {
  // A valid signature reaches the broker and returns PUBLICATION_NOT_FOUND.
  // A 401 means keyId/signature/clock/ACL is wrong.
  console.log(error.code, error.status);
}
```

Expected: `PUBLICATION_NOT_FOUND` / 404. A 401 or TLS error means the endpoint
or authentication is not ready; do not publish.

## 5. Minimal DOCUMENT test publication (only after health/auth pass)

Request schema: `qms-test-publication-request@2`.

```json
{
  "schema": "qms-test-publication-request@2",
  "requestId": "req_dualvps001",
  "projectId": "prj_qms-dev-test",
  "target": {
    "name": "developer iffi",
    "ownerAddress": "QipPqwJeLtx89dXcSkY7vimMUNT8Gy5k2E"
  },
  "resources": [
    {
      "id": "res_dualvps001",
      "service": "DOCUMENT",
      "identifier": "qms-dev-hello-001",
      "contentType": "text/plain",
      "bytes": 14,
      "sha256": "sha256:70be144d2672880e1f9bd2841cf8f3d98aa4a2d0159eddef22ab4c4ff7c731df",
      "dataBase64": "aGVsbG8gZnJvbSBxbXM="
    }
  ],
  "handoff": null
}
```

The payload is the 14-byte ASCII string `hello from qms`; the hash and base64
above are exact. Publish once, then poll `GET /v1/publications/{id}` and
`POST /v1/publications/{id}/verify` using the existing client. Record the
transaction signature, identifier, fee and exact read-back result.

Do not publish a second time on timeout or ambiguity; the broker preserves
pending/ambiguous state and does not auto-resubmit.

## 6. Verification and rollback

- Health: unauthenticated `GET /v1/health` must return 200.
- Auth: signed request must reach the broker; 401 means keyId/signature/clock/
  ACL failure.
- Non-public: `http://169.58.135.102:8443/v1/health` must fail; only the
  Tailscale interface may serve 8443.
- Caddy/Hub: existing DuckDNS HTTPS and Qortal Hub routes must still work.
- Broker policy/budget: check `disabled:false`, key revocation state and
  remaining 5 QORT / 24 h budget before publishing.

Rollback on the signing VPS (only if no other Tailscale Serve service is
configured):

```bash
sudo tailscale serve reset
```

If other Serve handlers exist, remove only the 8443 broker handler with
`tailscale serve status` and the appropriate service-specific clear command.
Do not stop Caddy or Qortal Core to fix the broker.

## 7. Execution evidence — 2026-11-03

- Tailscale HTTPS endpoint verified:
  `https://vmi3490660.tailb239e8.ts.net:8443/v1/health` returned
  `{"status":"ok","disabled":false}`.
- Authenticated read-only request with keyId `agent-main-2026-11` reached the
  broker: a signed `GET /v1/publications/pub_000000000000000000000000`
  returned `400 PUBLICATION_NOT_FOUND`, not `401`. The Ed25519 path, clock
  window and ACL are working.
- One minimal DOCUMENT publication was attempted:
  - requestId: `req_dualvps001`
  - publicationId: `pub_6b1dbeb87370fd7bfab9f28c`
  - identifier: `qms-dev-hello-001`, 14 bytes, SHA-256
    `70be144d2672880e1f9bd2841cf8f3d98aa4a2d0159eddef22ab4c4ff7c731df`
  - result: `state=failed`, `code=SIGNING_FAILED`,
    `verification=SIGNING_REJECTED`
  - fee quoted: `1,000,000` atomic = `0.01 QORT`
  - reserved/charged: `0`; `txRef=null`; balance at reservation
    `502,000,000` atomic = `5.02 QORT`
- The broker accepted policy, fee quote and balance, then the signing backend
  rejected or failed the operation. No QDN transaction signature was produced,
  no QDN resource was published and no fee was charged.
- The broker does not expose the External Auth rejection detail to the agent.
  The exact backend reason requires read-only operator inspection on the signing
  VPS:

  ```bash
  journalctl -u qms-qdn-test-broker -n 100 --no-pager
  journalctl -u qortal-external-auth -n 100 --no-pager
  tail -n 50 /var/lib/qms-qdn-test-broker/audit.jsonl
  ```

  Check the External Auth session, `PUBLISH_QDN_RESOURCE` permission, wallet
  unlock state and any rejected payload/name detail. Do not retry the
  publication until the cause is understood; there is no signed transaction to
  duplicate, but repeated failures should not become a probing loop.

## 8. What remains unverified

- Tailscale Serve on 8443 is not configured yet.
- Tailscale HTTPS certificate issuance and tailnet ACL restriction are
  operator-side.
- The exact registered keyId on the signing VPS must be confirmed.
- No authenticated broker request, signer check, fee quote, budget reservation,
  QDN publication or read-back was performed.
- The signing-VPS SSH boundary was not bypassed.
