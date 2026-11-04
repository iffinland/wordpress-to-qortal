#!/usr/bin/env bash
# Unlock the External Auth signing wallet after a daemon restart.
#
# External Auth keeps unlocked wallets and sessions in memory. The Phase 5.2
# deployment restarts it, so this helper creates one short-lived session from
# the existing app credentials and unlocks the wallet once. It never prints the
# app secret, the session token or the wallet password.
#
# Usage (signing VPS, as root):
#   sudo /opt/qms-qdn-test-broker/broker/scripts/operator-unlock-external-auth.sh \
#        --wallet-id <EXTERNAL_AUTH_WALLET_ID> [--ttl-seconds 3600]
set -Eeuo pipefail
umask 077
export LC_ALL=C

SUPERVISOR_CONFIG=${SUPERVISOR_CONFIG:-/etc/qms-qdn-auth-credential/supervisor.json}
WALLET_ID=
TTL_SECONDS=
while [ $# -gt 0 ]; do
  case "$1" in
    --wallet-id) WALLET_ID="${2:-}"; shift 2 ;;
    --wallet-id=*) WALLET_ID="${1#*=}"; shift ;;
    --ttl-seconds) TTL_SECONDS="${2:-}"; shift 2 ;;
    --ttl-seconds=*) TTL_SECONDS="${1#*=}"; shift ;;
    *) echo "usage: $0 --wallet-id <id> [--ttl-seconds N]" >&2; exit 2 ;;
  esac
done
[ "$(id -u)" -eq 0 ] || { echo "run as root (reads the supervisor app credential file)" >&2; exit 1; }
[ -n "$WALLET_ID" ] || { echo "--wallet-id is required" >&2; exit 2; }
[ -r "$SUPERVISOR_CONFIG" ] || { echo "supervisor config not readable: $SUPERVISOR_CONFIG" >&2; exit 1; }

echo "Unlocking wallet $WALLET_ID through External Auth."
echo "The password is read without echo and is never written to disk or logs."
read -r -s -p "Wallet password: " WALLET_PASSWORD
echo
[ -n "$WALLET_PASSWORD" ] || { echo "empty password" >&2; exit 1; }

printf '%s' "$WALLET_PASSWORD" \
  | QMS_SUPERVISOR_CONFIG="$SUPERVISOR_CONFIG" QMS_WALLET_ID="$WALLET_ID" QMS_TTL_SECONDS="${TTL_SECONDS:-}" \
    node -e '
      const fs = require("node:fs");
      const supervisor = JSON.parse(fs.readFileSync(process.env.QMS_SUPERVISOR_CONFIG, "utf8"));
      const app = JSON.parse(fs.readFileSync(supervisor.appSecretFile, "utf8"));
      const password = fs.readFileSync(0, "utf8");
      const baseUrl = String(supervisor.baseUrl || "http://127.0.0.1:3191").replace(/\/+$/, "");
      const json = (response) => response.text().then((text) => {
        try { return JSON.parse(text); } catch { return {}; }
      });
      const fail = async (label, response) => {
        const body = await json(response);
        const code = typeof body.error === "string" ? body.error : "HTTP " + response.status;
        console.error(label + " failed: " + code);
        process.exit(1);
      };
      (async () => {
        const sessionResponse = await fetch(baseUrl + "/sessions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ appId: app.appId, appSecret: app.appSecret })
        });
        if (!sessionResponse.ok) return fail("session", sessionResponse);
        const session = await sessionResponse.json();
        const payload = { walletId: process.env.QMS_WALLET_ID, password };
        if (process.env.QMS_TTL_SECONDS) payload.ttlSeconds = Number(process.env.QMS_TTL_SECONDS);
        const unlockResponse = await fetch(baseUrl + "/wallet/unlock", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer " + session.token
          },
          body: JSON.stringify(payload)
        });
        if (!unlockResponse.ok) return fail("wallet unlock", unlockResponse);
        const result = await unlockResponse.json();
        const expires = Number(result.expiresAt);
        console.log(
          "Wallet unlocked until " +
          (Number.isFinite(expires) ? new Date(expires).toISOString() : "the daemon default TTL") +
          " (token discarded)."
        );
      })().catch((error) => {
        console.error("unlock failed: " + error.message);
        process.exit(1);
      });
    '

unset WALLET_PASSWORD
echo "Next: submit ONE new publication with a new identifier, then read its diagnostic."
