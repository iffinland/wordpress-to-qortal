# Phase 5.2 — Dual-VPS UFW inspection and operator deployment procedure

Status: **inspection and design only**. No firewall was installed, enabled or
changed. No Qortal/Qortium node, Caddy configuration, SSH configuration,
systemd unit or live port binding was modified.

Date: 2026-11-03. Baseline: `de9a188035e36ba96cf02be14b23f795e2774a2d`.

## 1. Scope and evidence rules

The owner authorized firewall **design and preparation**, not activation.
Activation is an operator-controlled maintenance action requiring an inspected
state, a verified out-of-band console and an independent SSH recovery path.

Evidence below is split into:

- **Verified read-only**: observed from the agent host or the development VPS
  with unprivileged commands.
- **Operator-reported**: supplied by the owner in the task (for example
  `apiWhitelistEnabled=false` and "no UFW on either host").
- **Unverified**: could not be read without root or without authorized SSH to
  the test VPS. These must be confirmed before activation.

No credential, API key, token, wallet seed, private key or wallet material was
read, printed or stored while producing this document.

## 2. Host facts

### 2.1 Test / signing VPS — `169.58.135.102`

| Item | Finding | Evidence |
| --- | --- | --- |
| Provider | Contabo GmbH, Lauterbourg, FR; hostname `vmi3490660.contaboserver.net` | `ipinfo.io` read-only lookup |
| Operator SSH user | `iffiolen` | Owner-reported; confirmed by SSH probe target |
| Agent SSH access | **Not available**: `Permission denied (publickey,password)` with BatchMode | Verified 2026-11-03 |
| Qortal Core | 6.1.9 build `108bf19`, mainnet, full node, uptime ~108,374 s | `GET /admin/info` |
| Qortal API | Publicly reachable on `169.58.135.102:12391` from the development VPS; `/admin/info` and `/transactions/unitfee` answered without credentials | Verified read-only |
| ARBITRARY unit fee | `1000000` atomic = 0.01 QORT | `GET /transactions/unitfee?txType=ARBITRARY` |
| Confirmed owner balance | `502000000` atomic = 5.02 QORT at inspection time | Core balance read-only |
| API whitelist | `apiWhitelistEnabled=false` | Owner-reported; consistent with public API reachability |
| UFW | Not in use | Owner-reported; not independently verifiable without root |
| Caddy | Port 80 answers `308 Permanent Redirect` to HTTPS with `Server: Caddy`; TLS by bare IP fails because no certificate covers the IP | Verified read-only |
| DuckDNS hostname(s) | **Unknown**. Caddy serves at least one DuckDNS hostname used by Qortal Hub, but the name was not discoverable without host access or Hub configuration | Unverified |
| SSH port / binding / auth | **Unknown**; assume nothing, including port 22 | Unverified |
| Qortal P2P/QDN listeners | **Unknown**; Qortal defaults are TCP 12392 (P2P) and TCP 12394 (QDN), API 12391 | Core source defaults; live binding unverified |
| Provider recovery console | Contabo Cloud Panel VNC/console expected; owner must confirm access | Operator action |

### 2.2 OpenClaw development VPS — `80.241.221.139`

| Item | Finding | Evidence |
| --- | --- | --- |
| Provider | Contabo GmbH, Lauterbourg, FR; hostname `vmi3246023.contaboserver.net` | `ipinfo.io`; local hostname |
| OS | Debian 13.7, kernel 6.12.113+deb13-cloud-amd64 | Verified |
| Agent user | `iffi` (uid 1000), member of `sudo`; **sudo requires a password** | Verified |
| IPv4 | `80.241.221.139/24` on `eth0` | `ip -br addr` |
| IPv6 | `2a02:c207:2324:6023::1/64` on `eth0`; Tailscale `fd7a:115c:a1e0::c93a:847f/128` | `ip -br addr` |
| SSH | `ssh.service` active, TCP 22 on `0.0.0.0` and `[::]`; `PasswordAuthentication no`; `PermitRootLogin yes`; `/etc/ssh/sshd_config.d/50-cloud-init.conf` not readable as `iffi` | Verified (partial) |
| Active sessions | Not inspectable as `iffi`; use `who` / `ss -tnp` as root before changes | Unverified |
| UFW | **Not installed** (`dpkg`: `un ufw`) | Verified |
| nftables | **Not installed** (`nft` command absent, no `nftables.service`) | Verified |
| iptables | Package installed, binaries under `/usr/sbin`; current rules **not readable** without root; no evidence of an active host firewall | Partially verified |
| Caddy | `caddy.service` active; `/etc/caddy/Caddyfile` is `qortium.duckdns.org { reverse_proxy 127.0.0.1:24891 }`; TCP 80/443 public; admin endpoint `127.0.0.1:2019` | Verified |
| DuckDNS | `qortium.duckdns.org` → A `80.241.221.139`; **no AAAA record observed** | `getent ahosts` / `getent ahostsv6` |
| Qortium | `qortium.service` runs as `iffi` from `/home/iffi/qortium-preview/preview`; API `*:24891`, P2P `*:24892`, data `*:24894` | systemd unit + redacted settings + `ss` |
| Webmin | `webmin.service` active; TCP 10000 on `0.0.0.0` and `[::]` (process is root, so exact unit-to-port mapping is inferred from the standard Webmin port) | Verified service + listener |
| Tailscale | `tailscaled` active; UDP 41641; tailnet address `100.126.132.126` | Verified |
| I2P | `i2pd.service` active; local client tunnel on `127.0.0.1:6668`; public UDP bind not fully mapped | Verified service + config |
| Unknown public TCP 16118 | Listener on `0.0.0.0:16118`; owner process not visible to `iffi` | Unverified; must be identified as root |
| Other listeners | `127.0.0.1`: 2019 (Caddy admin), 4444/4447, 555, 7070, 7656, 18789 (OpenClaw), 25; UDP 5353/5355 (mDNS/LLMNR), 35301 | Verified |
| Qortal Core on this host | **Not running**; this host runs Qortium, not Qortal | Verified |

> The task brief said both VPS run Qortal nodes. The development VPS actually
> runs a Qortium preview node, Caddy, OpenClaw, Webmin, Tailscale and I2P. The
> firewall plan below is therefore host-specific; a copied "Qortal" ruleset
> would be wrong for this host.

## 3. Required connectivity

### 3.1 Test / signing VPS

| Port/protocol | Direction | Purpose | Required? |
| --- | --- | --- | --- |
| SSH (operator-confirmed, likely 22/tcp) | in | Operator/Termius administration | Yes, exact port must be verified |
| 80/tcp | in | Caddy HTTP→HTTPS and ACME HTTP-01 | Yes |
| 443/tcp | in | Caddy HTTPS, Qortal Hub→node, ACME | Yes |
| 12392/tcp | in/out | Qortal P2P | Yes for a public full node |
| 12394/tcp | in/out | Qortal QDN data transfer | Yes if Qortal peers must fetch QDN data |
| 12391/tcp | in | Qortal Core API | **No public rule**; loopback only (Caddy/broker) |
| 3191/tcp | in | External Auth | **No public rule**; loopback only |
| 3199/tcp | in | QMS broker | **No public rule**; loopback/private only |
| 51820/udp | in | WireGuard | Only if a verified private-network design is adopted |
| DNS 53, HTTP 80, HTTPS 443, NTP 123, all outbound | out | Qortal, Caddy/ACME, OS updates | Yes; default outgoing policy allows this |

If the operator confirms different Qortal ports in `settings.json`, replace
12392/12394 with the actual `listenPort` and QDN listen port. Do not assume.

### 3.2 OpenClaw development VPS

| Port/protocol | Direction | Purpose | Required? |
| --- | --- | --- | --- |
| 22/tcp | in | SSH/Termius | Yes |
| 80/tcp | in | Caddy HTTP→HTTPS and ACME | Yes |
| 443/tcp | in | Caddy HTTPS for `qortium.duckdns.org` | Yes |
| 24892/tcp | in/out | Qortium P2P | Yes |
| 24894/tcp | in/out | Qortium data port | Yes |
| 24891/tcp | in | Qortium API/Home backend | **No public rule**; loopback only, Caddy proxies it |
| 10000/tcp | in | Webmin | **No public rule**; Tailscale or SSH tunnel only |
| 41641/udp | in | Tailscale direct path | Yes if tailnet connectivity is required |
| 16118/tcp | in | Unknown | **Hold** until identified; do not permanently open |
| 51820/udp | in | WireGuard | Only if adopted |
| DNS, HTTP, HTTPS, NTP, all outbound | out | Qortium, Caddy/ACME, updates, I2P | Yes |

## 4. Prepared UFW policy

Both hosts: default **deny incoming**, **allow outgoing**, IPv6 enabled. Loopback
is accepted by UFW's default before-rules; listeners bound only to
`127.0.0.1` remain reachable by Caddy and local services. Blocking a public
port does **not** protect a service that Caddy proxies on 443; Caddy routing and
application authorization must be audited separately.

### 4.1 Test VPS rule set (prepare, do not auto-enable)

```bash
# Operator only, after Section 5 preflight. Replace <SSH_PORT>.
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow <SSH_PORT>/tcp comment 'operator SSH'
sudo ufw allow 80/tcp comment 'Caddy ACME/HTTP'
sudo ufw allow 443/tcp comment 'Caddy HTTPS/Hub'
sudo ufw allow 12392/tcp comment 'Qortal P2P'
sudo ufw allow 12394/tcp comment 'Qortal QDN data'
# Deliberately no rule for 12391, 3191 or 3199.
```

IPv6 is covered by `ufw allow` when `IPV6=yes`. Verify
`/etc/default/ufw` contains `IPV6=yes`. If the host has no public IPv6, keep
IPv6 enabled but confirm the provider does not route it unexpectedly.

### 4.2 Development VPS rule set (prepare, do not auto-enable)

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp comment 'operator SSH'
sudo ufw allow 80/tcp comment 'Caddy ACME/HTTP'
sudo ufw allow 443/tcp comment 'Caddy HTTPS'
sudo ufw allow 24892/tcp comment 'Qortium P2P'
sudo ufw allow 24894/tcp comment 'Qortium data'
sudo ufw allow 41641/udp comment 'Tailscale direct'
# Restrict Webmin to the tailnet, not the public internet:
sudo ufw allow in on tailscale0 to any port 10000 proto tcp comment 'Webmin via tailnet'
# Deliberately no public rule for 24891, 2019, or the loopback-only ports.
# 16118/tcp remains unresolved: identify it before deciding.
```

If the operator does not use Tailscale for Webmin, use an SSH tunnel and add no
public 10000 rule. If 16118 is an agent/control-plane service that must remain
reachable, bind it to loopback or the tailnet rather than opening it publicly.

### 4.3 Explicit non-assumptions

- Do not assume SSH is 22; read the effective `sshd` configuration first.
- Do not assume Qortal P2P is 12392/12394; read the live `settings.json`.
- Do not expose 12391 "because the broker needs it": the broker and External
  Auth must use loopback.
- Do not expose 3191/3199 at all.
- Do not open 24891 on the development VPS; Caddy reaches it on loopback.
- Do not rely on a firewall to fix an over-broad Caddy route.

## 5. Preflight — read-only, root/operator required

Run these **before** creating rules and save the output outside the host.

### 5.1 Both hosts

```bash
# Exact OS, kernel, addresses and routes
cat /etc/os-release; uname -a
ip -brief address; ip route; ip -6 route

# Effective SSH configuration and active sessions
sudo sshd -T | grep -Ei '^(port|listenaddress|passwordauthentication|permitrootlogin|pubkeyauthentication|allowusers|allowgroups)'
who; ss -tnp | grep -E 'ssh|:22\b'

# Every listener, with process and owner
sudo ss -tulpn

# Current packet filter state and installed packages
sudo ufw status verbose || true
sudo iptables-save || true
sudo ip6tables-save || true
sudo nft list ruleset || true
dpkg -l ufw nftables iptables | tail -n +6

# Caddy and certificates
systemctl status caddy --no-pager
sudo cat /etc/caddy/Caddyfile
sudo find /var/lib/caddy -maxdepth 6 -type f -name '*.crt' -o -name '*.json' | head
sudo journalctl -u caddy --since '14 days ago' | grep -Ei 'certificate|acme|error' | tail -50

# DNS from the host that terminates TLS
getent ahosts <duckdns-hostname>
getent ahostsv6 <duckdns-hostname>
```

### 5.2 Test VPS only

```bash
# Redact apiKey, seed and wallet material before sharing.
sudo sed -n '1,200p' /home/iffiolen/qortal/settings.json
# Confirm the live listeners against configured ports.
sudo ss -tulpn | grep -E '1239[1-4]|3191|3199'
curl -sS http://127.0.0.1:12391/admin/info
curl -sS 'http://127.0.0.1:12391/transactions/unitfee?txType=ARBITRARY'
# Is the API bound only to loopback, or to all interfaces?
sudo ss -tlnp | grep 12391
```

Required settings to record (values only; redact secrets):

- `apiPort`, `listenPort`, QDN listen port, `bindAddress`;
- `apiWhitelistEnabled` and every whitelist entry;
- whether Caddy proxies `/admin`, `/transactions`, `/addresses`,
  `/arbitrary` or the whole API;
- whether Qortal Hub reaches the node through Caddy, a direct API port, or a
  tunnel.

### 5.3 Development VPS only

```bash
# Identify the unknown public listener before restricting it.
sudo ss -tlnp 'sport = :16118'
sudo lsof -nP -iTCP:16118 -sTCP:LISTEN
sudo systemctl status webmin --no-pager
sudo cat /etc/webmin/miniserv.conf | grep -E '^(port|listen|ssl)'
```

## 6. Caddy, DuckDNS and ACME requirements

- Caddy must keep inbound TCP 80 and 443 and outbound TCP 80/443 for ACME.
- `qortium.duckdns.org` has an A record to the development VPS and no AAAA
  record. Caddy's automatic HTTPS works over IPv4; do not add an IPv6-only
  expectation until an AAAA record is intentionally published.
- The test VPS DuckDNS hostname(s) were not discoverable. The operator must
  read the Caddyfile and certificate storage and record every hostname and its
  A/AAAA records.
- If Caddy serves Qortal Hub, preserve 443. Do not block Caddy's loopback
  upstream (12391 on the test VPS, 24891 on the development VPS).
- Caddy's admin API is on `127.0.0.1:2019`; it must never be exposed.
- Renewal failure is usually DNS, port 80/443 reachability, or clock skew.
  Verify with `journalctl -u caddy` after activation, not only at once.

## 7. Caddy/API exposure audit (separate from UFW)

A firewall rule on 12391 does **not** prevent HTTPS 443 from reaching the same
Core API if Caddy reverse-proxies it. Record, for each Caddy site:

- upstream address and path;
- whether the route is the whole API or a narrow Qortal Home/UI path;
- whether Core requires an API key for the route;
- whether `/admin/*`, `/transactions/*`, `/addresses/*`,
  `/arbitrary/*` and wallet/signing routes are reachable;
- whether External Auth or the broker is proxied at all (they must not be).

The test VPS currently answers unauthenticated `/admin/info` and
`/transactions/unitfee` directly on 12391. That is read-only information, but
it confirms the API is publicly reachable. The broker/External Auth must be
loopback-only regardless of UFW.

## 8. Controlled activation procedure

Do **one host at a time**, starting with the development VPS only if the owner
accepts the unknown-16118 risk; otherwise start with the test VPS after operator
access is established.

1. **Capture current state**
   ```bash
   sudo tar czf /root/network-state-$(date -u +%Y%m%dT%H%M%SZ).tar.gz \
     /etc/ufw /etc/ssh /etc/caddy /etc/network /etc/systemd/network 2>/dev/null || true
   sudo iptables-save > /root/iptables-before.txt
   sudo ip6tables-save > /root/ip6tables-before.txt
   sudo ss -tulpn > /root/listeners-before.txt
   ```
2. **Verify out-of-band recovery**: log in to the Contabo Cloud Panel VNC
   console and confirm the host is reachable there. Do not rely on the same SSH
   session for rollback.
3. **Open a second, independent SSH session** and keep it open. Confirm the
   exact SSH port from `sshd -T`.
4. **Install UFW only** (`sudo apt-get install ufw`). Do not enable yet.
5. **Set defaults and rules** from Section 4. Use `ufw allow` before
   `ufw enable`.
6. **Dry-run** where supported:
   ```bash
   sudo ufw --dry-run enable
   sudo ufw show added
   sudo ufw status numbered
   ```
7. **Activate** `sudo ufw enable` in the operator's own session.
8. **Immediately** test from a new independent connection:
   - SSH on the verified port;
   - `curl -I http://<host>/` and `https://<duckdns-host>/`;
   - Caddy certificate renewal log;
   - Qortal/Qortium API from loopback;
   - P2P peer count from the node status;
   - Qortal Hub resource read through the public hostname.
9. **Observe** for at least one ACME renewal window or run
   `sudo caddy reload` and confirm no certificate error.
10. **Only after full verification**, repeat on the second VPS.
11. **Rollback** if any check fails:
    ```bash
    sudo ufw disable
    ```
    If SSH is lost, use the Contabo console, then `ufw disable` and restore
    the saved state. Do not attempt to repair the firewall through the same
    broken SSH session.

## 9. Post-activation verification

```bash
sudo ufw status verbose
sudo ufw show added
sudo ss -tulpn
# From another host:
nc -vz <host> <ssh-port>
curl -sSI http://<duckdns-host>/
curl -sSI https://<duckdns-host>/
# From the node host:
curl -sS http://127.0.0.1:12391/admin/info
curl -sS http://127.0.0.1:12391/transactions/unitfee?txType=ARBITRARY
```

Expected results:

- Public 12391/3191/3199 are closed; loopback still works.
- 80/443, SSH, Qortal P2P/QDN ports and required outbound traffic work.
- Caddy serves a valid certificate for every configured DuckDNS name.
- Qortal Hub can still read resources through the public hostname.
- No unexplained public listener remains; 16118 is identified or bound
  privately.

## 10. Rollback and recovery

- Primary rollback: provider VNC/console → `sudo ufw disable`.
- Secondary: restore `/etc/ufw` backup and `iptables-restore` from the
  captured files, then reload.
- Keep the pre-change listener and rule dumps outside the host.
- Do not delete `/etc/ufw` backups until the host has survived one certificate
  renewal and a reboot.
- A firewall change is not a substitute for fixing an over-broad Caddy route or
  a publicly bound API.

## 11. Signing-service isolation status

The required model remains:

```
OpenClaw → authenticated QDN broker → isolated Qortal External Auth → Qortal Core
```

The agent must not have:

- wallet-file, seed, private-key or password access;
- SSH, sudo or root access to the signing host;
- External Auth admin credentials;
- unrestricted transaction signing;
- deployed broker policy edit access;
- emergency-disable control.

Only the broker's authenticated, policy-restricted publication API may
eventually be reachable by the agent. This task did **not** install External
Auth, import or unlock a wallet, sign a transaction, publish a resource, change
a node configuration, or enable UFW. The signing host remains a future
operator-provisioned boundary.

## 12. Remaining blockers

1. No authorized agent SSH access to the test VPS; exact SSH port, Caddy
   configuration, DuckDNS names, UFW state and Qortal listeners remain
   unverified.
2. The test VPS API is publicly reachable on 12391; restricting it requires
   either a UFW rule (operator) or a Qortal `apiWhitelistEnabled` change plus a
   Caddy route audit.
3. The development VPS has an unidentified public TCP listener on 16118 and an
   unverified current iptables state; neither can be safely restricted without
   root.
4. Webmin is exposed on 10000 and should be moved to the tailnet or an SSH
   tunnel before default-deny activation.
5. Contabo VNC/console access must be confirmed by the owner before any
   activation.
6. No UFW rule has been applied. No firewall activation is authorized by this
   document alone; the owner must schedule the maintenance window.

## 13. Exact operator command summary (copy only after review)

```bash
# TEST VPS — after operator SSH access and Section 5 evidence
sudo apt-get update && sudo apt-get install -y ufw
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow <SSH_PORT>/tcp comment 'operator SSH'
sudo ufw allow 80/tcp comment 'Caddy ACME/HTTP'
sudo ufw allow 443/tcp comment 'Caddy HTTPS/Hub'
sudo ufw allow 12392/tcp comment 'Qortal P2P'
sudo ufw allow 12394/tcp comment 'Qortal QDN data'
sudo ufw --dry-run enable
sudo ufw enable

# DEVELOPMENT VPS — identify 16118 and confirm Tailscale first
sudo apt-get update && sudo apt-get install -y ufw
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp comment 'operator SSH'
sudo ufw allow 80/tcp comment 'Caddy ACME/HTTP'
sudo ufw allow 443/tcp comment 'Caddy HTTPS'
sudo ufw allow 24892/tcp comment 'Qortium P2P'
sudo ufw allow 24894/tcp comment 'Qortium data'
sudo ufw allow 41641/udp comment 'Tailscale direct'
sudo ufw allow in on tailscale0 to any port 10000 proto tcp comment 'Webmin via tailnet'
sudo ufw --dry-run enable
sudo ufw enable
```
