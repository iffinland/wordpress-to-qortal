#!/usr/bin/env bash
# Phase 5.2 final deployment correction - idempotent signing-VPS deployment.
#
# This is the final deployment for the already-deployed atomic-fee broker fix.
# It does NOT patch or rebuild External Auth. It only:
#   1. installs the corrected broker source/scripts;
#   2. configures the existing Qortal Core API key for External Auth through
#      the existing 0600 EnvironmentFile and a systemd drop-in, restarting
#      External Auth only when the key must actually be loaded or changed;
#   3. provisions a valid replacement External Auth session BEFORE the broker
#      starts, writing it to the token path read from the installed broker
#      configuration key signing.externalAuth.tokenFile;
#   4. starts the broker only after that token exists, then lets the normal
#      credential supervisor renew it through the broker credential socket.
#
# External Auth restart (only when needed) invalidates in-memory sessions and
# relocks the wallet. This script never unlocks a wallet, never reads a wallet
# password, and never prints the Core API key, app secret or token. If it
# restarted External Auth it prints exactly one operator unlock action.
#
# It does not change UFW, Tailscale, Caddy, Qortal names, wallet identity,
# app credentials, budgets, revocations or the client registry.
#
# Actual signing-VPS layout:
#   repo checkout:      /home/iffiolen/qms-broker-deploy
#   broker install:     /opt/qms-qdn-test-broker
#   broker source:      /opt/qms-qdn-test-broker/broker/src
#   broker scripts:     /opt/qms-qdn-test-broker/broker/scripts
#   External Auth inst: /opt/qortal-external-auth
#
# Usage (signing VPS, from the repo checkout, as root):
#   sudo ./broker/scripts/deploy-phase5.2-core-rejection-fix.sh --check
#   sudo ./broker/scripts/deploy-phase5.2-core-rejection-fix.sh --yes \
#        --core-api-key-file /qortal/apikey.txt
#   sudo ./broker/scripts/deploy-phase5.2-core-rejection-fix.sh --rollback /var/backups/qms-phase5.2/<stamp>
set -Eeuo pipefail
umask 077
export LC_ALL=C

REPO_DIR=${REPO_DIR:-/home/iffiolen/qms-broker-deploy}
BROKER_DIR=${BROKER_DIR:-/opt/qms-qdn-test-broker}
BROKER_SRC_DIR=${BROKER_SRC_DIR:-$BROKER_DIR/broker/src}
BROKER_SCRIPT_DIR=${BROKER_SCRIPT_DIR:-$BROKER_DIR/broker/scripts}
BROKER_CONFIG=${BROKER_CONFIG:-/etc/qms-qdn-test-broker/config.json}
CLIENTS_FILE=${CLIENTS_FILE:-/etc/qms-qdn-test-broker/clients.json}
STATE_FILE=${STATE_FILE:-/var/lib/qms-qdn-test-broker/state.json}
AUDIT_FILE=${AUDIT_FILE:-/var/lib/qms-qdn-test-broker/audit.jsonl}
KILL_SWITCH_FILE=${KILL_SWITCH_FILE:-/var/lib/qms-qdn-test-broker/DISABLED}
ADMIN_SOCKET=${ADMIN_SOCKET:-/run/qms-qdn-test-broker/admin.sock}
CRED_SOCKET=${CRED_SOCKET:-/run/qms-qdn-test-broker/credential.sock}
BACKUP_ROOT=${BACKUP_ROOT:-/var/backups/qms-phase5.2}
EA_SERVICE=${EA_SERVICE:-qortal-external-auth}
EA_USER=${EA_USER:-qortal-auth}
EA_SUPERVISOR_USER=${EA_SUPERVISOR_USER:-qms-auth-supervisor}
EA_SUPERVISOR_GROUP=${EA_SUPERVISOR_GROUP:-$EA_SUPERVISOR_USER}
SUPERVISOR_CONFIG=${SUPERVISOR_CONFIG:-/etc/qms-qdn-auth-credential/supervisor.json}
EA_KEY_ENV_FILE=${EA_KEY_ENV_FILE:-/etc/qortal-external-auth/node-api-key.env}
EA_DROPIN_DIR=${EA_DROPIN_DIR:-/etc/systemd/system/$EA_SERVICE.service.d}
EA_DROPIN=${EA_DROPIN:-$EA_DROPIN_DIR/10-node-api-key.conf}
CORE_URL=${CORE_URL:-http://127.0.0.1:12391}
BROKER_SERVICE=${BROKER_SERVICE:-qms-qdn-test-broker}
CRED_TIMER=${CRED_TIMER:-qms-auth-credential.timer}
CRED_SERVICE=${CRED_SERVICE:-qms-auth-credential.service}
BROKER_USER=${BROKER_USER:-qms-broker}
BROKER_GROUP=${BROKER_GROUP:-$BROKER_USER}
OWNER_USER=${OWNER_USER:-root}
EA_HEALTH=${EA_HEALTH:-http://127.0.0.1:3191/health}
BROKER_HEALTH=${BROKER_HEALTH:-http://127.0.0.1:3199/v1/health}

# Resolved from the installed broker config, never from a guessed path.
TOKEN_FILE=
# Resolved to the installed (or repo) helper; never a hardcoded private path.
PROVISION_SCRIPT=${PROVISION_SCRIPT:-}
SUPERVISOR_SCRIPT=${SUPERVISOR_SCRIPT:-}
CORE_KEY=
EA_RESTARTED=false
ROLLBACK_ON_DIE=false
RUNUSER_BIN=${RUNUSER_BIN:-}

MODE=${MODE:-}
CORE_API_KEY_FILE=${CORE_API_KEY_FILE:-}
ROLLBACK_DIR=${ROLLBACK_DIR:-}
while [ $# -gt 0 ]; do
  case "$1" in
    --check|--yes) MODE="$1"; shift ;;
    --core-api-key-file) CORE_API_KEY_FILE="${2:-}"; shift 2 ;;
    --core-api-key-file=*) CORE_API_KEY_FILE="${1#*=}"; shift ;;
    --rollback) MODE="--rollback"; ROLLBACK_DIR="${2:-}"; shift 2 ;;
    --rollback=*) MODE="--rollback"; ROLLBACK_DIR="${1#*=}"; shift ;;
    *) echo "usage: $0 --check | --yes [--core-api-key-file PATH] | --rollback <backup-dir>" >&2; exit 2 ;;
  esac
done

STAMP=$(date -u +%Y%m%dT%H%M%SZ)
BACKUP_DIR="$BACKUP_ROOT/$STAMP"

log()  { printf "%s %s\n" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
die()  {
  log "ERROR: $*"
  if [ "$ROLLBACK_ON_DIE" = "true" ] && [ -d "$BACKUP_DIR" ]; then
    on_error 1
  fi
  exit 1
}
need() { command -v "$1" >/dev/null 2>&1 || die "missing required command: $1"; }
require_root() { [ "$(id -u)" -eq 0 ] || die "run as root for --yes/--rollback"; }
resolve_runuser() {
  if [ -n "$RUNUSER_BIN" ] && [ -x "$RUNUSER_BIN" ]; then return 0; fi
  RUNUSER_BIN=$(command -v runuser 2>/dev/null || true)
  if [ -z "$RUNUSER_BIN" ] && [ -x /usr/sbin/runuser ]; then RUNUSER_BIN=/usr/sbin/runuser; fi
  [ -n "$RUNUSER_BIN" ] && [ -x "$RUNUSER_BIN" ]
}

ea_health() { curl -fsS --max-time 3 "$EA_HEALTH" 2>/dev/null || return 1; }
broker_health() { curl -fsS --max-time 3 "$BROKER_HEALTH" 2>/dev/null || return 1; }
wait_http() {
  local url="$1"
  for _ in $(seq 1 60); do
    curl --silent --fail --max-time 2 "$url" >/dev/null 2>&1 && return 0
    sleep 1
  done
  return 1
}
wait_socket() {
  local socket="$1"
  for _ in $(seq 1 30); do
    [ -S "$socket" ] && return 0
    sleep 1
  done
  return 1
}

resolve_provisioner() {
  if [ -n "$PROVISION_SCRIPT" ] && [ -f "$PROVISION_SCRIPT" ]; then return 0; fi
  if [ -f "$BROKER_SCRIPT_DIR/provision-external-auth-token.js" ]; then
    PROVISION_SCRIPT="$BROKER_SCRIPT_DIR/provision-external-auth-token.js"
    return 0
  fi
  if [ -f "$REPO_DIR/broker/scripts/provision-external-auth-token.js" ]; then
    PROVISION_SCRIPT="$REPO_DIR/broker/scripts/provision-external-auth-token.js"
    return 0
  fi
  return 1
}

resolve_supervisor() {
  if [ -n "$SUPERVISOR_SCRIPT" ] && [ -f "$SUPERVISOR_SCRIPT" ]; then return 0; fi
  if [ -f "$BROKER_SRC_DIR/credentials/supervisor.js" ]; then
    SUPERVISOR_SCRIPT="$BROKER_SRC_DIR/credentials/supervisor.js"
    return 0
  fi
  if [ -f "$REPO_DIR/broker/src/credentials/supervisor.js" ]; then
    SUPERVISOR_SCRIPT="$REPO_DIR/broker/src/credentials/supervisor.js"
    return 0
  fi
  return 1
}

resolve_token_file() {
  TOKEN_FILE=$(node --input-type=commonjs -e '
    const fs = require("node:fs");
    try {
      const cfg = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      const value = cfg && cfg.signing && cfg.signing.externalAuth && cfg.signing.externalAuth.tokenFile;
      if (typeof value !== "string" || value.length === 0 || value[0] !== "/") {
        console.error("signing.externalAuth.tokenFile must be an absolute path");
        process.exit(3);
      }
      process.stdout.write(value);
    } catch (error) {
      console.error("cannot read broker config: " + error.message);
      process.exit(3);
    }
  ' "$BROKER_CONFIG") || die "cannot read signing.externalAuth.tokenFile from $BROKER_CONFIG"
  log "broker token file from config: $TOKEN_FILE"
}

read_env_file_key() {
  if [ ! -f "$EA_KEY_ENV_FILE" ] || [ ! -r "$EA_KEY_ENV_FILE" ]; then return 1; fi
  sed -n 's/^QORTAL_AUTH_NODE_API_KEY=//p' "$EA_KEY_ENV_FILE" | head -1 | tr -d '\r\n'
}

core_key_present() {
  if [ -n "$CORE_API_KEY_FILE" ] && [ -r "$CORE_API_KEY_FILE" ]; then return 0; fi
  if [ -r "$EA_KEY_ENV_FILE" ] && grep -q '^QORTAL_AUTH_NODE_API_KEY=.' "$EA_KEY_ENV_FILE"; then return 0; fi
  if systemctl show "$EA_SERVICE" -p Environment 2>/dev/null | grep -q 'QORTAL_AUTH_NODE_API_KEY=[^" ]'; then return 0; fi
  return 1
}

resolve_core_key() {
  CORE_KEY=
  if [ -n "$CORE_API_KEY_FILE" ]; then
    [ -r "$CORE_API_KEY_FILE" ] || die "Core API key file is not readable: $CORE_API_KEY_FILE"
    CORE_KEY=$(tr -d '\r\n' <"$CORE_API_KEY_FILE")
    [ -n "$CORE_KEY" ] || die "Core API key file is empty: $CORE_API_KEY_FILE"
    return 0
  fi
  if [ -r "$EA_KEY_ENV_FILE" ]; then
    CORE_KEY=$(read_env_file_key || true)
    [ -n "$CORE_KEY" ] && return 0
  fi
  CORE_KEY=$(systemctl show "$EA_SERVICE" -p Environment 2>/dev/null \
    | tr ' ' '\n' | sed -n 's/^QORTAL_AUTH_NODE_API_KEY=//p' | head -1 | tr -d '"')
  [ -n "$CORE_KEY" ] || die "no Core API key configured; rerun with --core-api-key-file /path/to/apikey.txt"
}

verify_core_key() {
  QMS_CORE_URL="$CORE_URL" QMS_CORE_KEY="$CORE_KEY" node -e '
    const url = process.env.QMS_CORE_URL.replace(/\/+$/, "") + "/admin/apikey/test";
    fetch(url, { headers: { "X-API-KEY": process.env.QMS_CORE_KEY } })
      .then(async (response) => {
        const text = (await response.text()).trim();
        if (!response.ok || text !== "true") {
          console.error("Core API key test failed with HTTP " + response.status);
          process.exit(1);
        }
      })
      .catch((error) => { console.error("Core API key test failed: " + error.message); process.exit(1); });
  ' || die "Core API key validation failed against $CORE_URL"
}

dropin_configured() {
  [ -f "$EA_DROPIN" ] && grep -Fq "EnvironmentFile=-$EA_KEY_ENV_FILE" "$EA_DROPIN"
}

ea_process_has_key() {
  local pid=""
  pid=$(systemctl show "$EA_SERVICE" -p MainPID --value 2>/dev/null || true)
  if [ -z "$pid" ] || [ "$pid" = "0" ]; then return 1; fi
  if [ ! -r "/proc/$pid/environ" ]; then return 1; fi
  tr '\0' '\n' <"/proc/$pid/environ" | grep -q '^QORTAL_AUTH_NODE_API_KEY=.'
}

verify_ea_env() {
  if ! ea_process_has_key; then
    die "External Auth process does not have QORTAL_AUTH_NODE_API_KEY loaded"
  fi
  log "External Auth process has the Core API key loaded (value not printed)"
}

core_key_needs_change() {
  local current=""
  current=$(read_env_file_key || true)
  if [ "$current" != "$CORE_KEY" ]; then return 0; fi
  if ! dropin_configured; then return 0; fi
  if ! systemctl is-active --quiet "$EA_SERVICE"; then return 0; fi
  if ! ea_process_has_key; then return 0; fi
  return 1
}

token_fingerprint() {
  node --input-type=commonjs -e '
    const fs = require("node:fs");
    const crypto = require("node:crypto");
    const token = fs.readFileSync(process.argv[1], "utf8").trim();
    process.stdout.write("sha256:" + crypto.createHash("sha256").update(token, "utf8").digest("hex").slice(0, 16));
  ' "$TOKEN_FILE"
}

admin_credential_fingerprint() {
  node --input-type=commonjs -e '
    const fs = require("node:fs");
    const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    process.stdout.write(data && data.status && data.status.credential ? (data.status.credential.fingerprint || "") : "");
  ' "$BACKUP_DIR/admin-status.json"
}

verify_token_file_shape() {
  node --input-type=commonjs -e '
    const fs = require("node:fs");
    const token = fs.readFileSync(process.argv[1], "utf8").trim();
    if (!/^[A-Za-z0-9._~+\/-]{20,4096}$/.test(token)) {
      console.error("token file content is not a plausible bearer token");
      process.exit(1);
    }
  ' "$TOKEN_FILE"
}

verify_token_file_owner() {
  [ -f "$TOKEN_FILE" ] || die "token file missing: $TOKEN_FILE"
  [ "$(stat -c %U "$TOKEN_FILE")" = "$BROKER_USER" ] || die "token file owner is not $BROKER_USER: $TOKEN_FILE"
  [ "$(stat -c %G "$TOKEN_FILE")" = "$BROKER_GROUP" ] || die "token file group is not $BROKER_GROUP: $TOKEN_FILE"
  local mode
  mode=$((8#$(stat -c %a "$TOKEN_FILE")))
  (( (mode & 0077) == 0 )) || die "token file is group/world accessible: $(stat -c %a "$TOKEN_FILE")"
}

preflight() {
  log "preflight: Phase 5.2 final deployment layout"
  for cmd in node systemctl curl tar sha256sum ss df install id stat sed grep awk head tr mktemp seq; do need "$cmd"; done
  resolve_runuser || die "missing required command: runuser (try /usr/sbin/runuser)"
  [ -d "$REPO_DIR/broker/src" ] || die "repo broker source missing: $REPO_DIR/broker/src"
  [ -f "$REPO_DIR/broker/scripts/provision-external-auth-token.js" ] || die "repo token provisioner missing"
  [ -f "$REPO_DIR/broker/src/credentials/supervisor.js" ] || die "repo credential supervisor missing"
  [ -d "$BROKER_SRC_DIR" ] || die "installed broker source missing: $BROKER_SRC_DIR"
  [ -d "$BROKER_SCRIPT_DIR" ] || die "installed broker scripts missing: $BROKER_SCRIPT_DIR"
  [ -f "$BROKER_CONFIG" ] || die "broker config missing: $BROKER_CONFIG"
  [ -f "$CLIENTS_FILE" ] || die "clients registry missing: $CLIENTS_FILE"
  [ -d "$(dirname "$STATE_FILE")" ] || die "state directory missing: $(dirname "$STATE_FILE")"
  [ -f "$SUPERVISOR_CONFIG" ] || die "supervisor config missing: $SUPERVISOR_CONFIG"
  [ -r "$SUPERVISOR_CONFIG" ] || die "supervisor config is not readable: $SUPERVISOR_CONFIG"
  id "$BROKER_USER" >/dev/null 2>&1 || die "broker user missing: $BROKER_USER"
  id "$BROKER_GROUP" >/dev/null 2>&1 || die "broker group missing: $BROKER_GROUP"
  id "$EA_USER" >/dev/null 2>&1 || die "External Auth user missing: $EA_USER"
  id "$EA_SUPERVISOR_USER" >/dev/null 2>&1 || die "credential supervisor user missing: $EA_SUPERVISOR_USER"
  id "$EA_SUPERVISOR_GROUP" >/dev/null 2>&1 || die "credential supervisor group missing: $EA_SUPERVISOR_GROUP"

  for unit in "$EA_SERVICE" "$BROKER_SERVICE" "$CRED_TIMER" "$CRED_SERVICE"; do
    systemctl cat "$unit" >/dev/null 2>&1 || die "systemd unit not found: $unit"
  done

  resolve_token_file
  [ -d "$(dirname "$TOKEN_FILE")" ] || die "token directory missing: $(dirname "$TOKEN_FILE")"
  if [ -e "$TOKEN_FILE" ]; then
    [ -f "$TOKEN_FILE" ] || die "token path is not a regular file: $TOKEN_FILE"
    local token_mode
    token_mode=$((8#$(stat -c %a "$TOKEN_FILE")))
    if (( (token_mode & 0077) != 0 )); then
      log "WARNING: existing token file is group/world accessible ($(stat -c %a "$TOKEN_FILE")); it will be replaced with 0600"
    fi
  fi

  local mode
  mode=$((8#$(stat -c %a "$BROKER_CONFIG")))
  (( (mode & 0007) == 0 )) || die "broker config is group/world readable: $(stat -c %a "$BROKER_CONFIG")"
  mode=$((8#$(stat -c %a "$CLIENTS_FILE")))
  (( (mode & 0007) == 0 )) || die "clients registry is group/world readable: $(stat -c %a "$CLIENTS_FILE")"
  mode=$((8#$(stat -c %a "$(dirname "$STATE_FILE")")))
  (( (mode & 0007) == 0 )) || die "state directory is group/world accessible"
  if [ -e "$STATE_FILE" ]; then
    mode=$((8#$(stat -c %a "$STATE_FILE")))
    (( (mode & 0007) == 0 )) || die "state file is group/world readable"
  fi

  if ss -H -ltn 2>/dev/null | awk '{print $4}' | grep -Eq "^(0\.0\.0\.0|\[::\]|\*):(8443|3199)$"; then
    die "8443 or 3199 is bound to a wildcard address"
  fi

  local avail_kb probe="$BACKUP_ROOT"
  [ -d "$probe" ] || probe="$(dirname "$BACKUP_ROOT")"
  avail_kb=$(df -Pk "$probe" 2>/dev/null | awk 'NR==2 {print $4}' || true)
  [ -n "$avail_kb" ] && [ "$avail_kb" -gt 2097152 ] || die "need at least 2 GiB free under $BACKUP_ROOT"

  if core_key_present; then
    log "Core API key: configured"
  else
    log "Core API key: NOT configured"
    [ "$MODE" = "--check" ] || die "Core API key missing; rerun with --core-api-key-file /path/to/apikey.txt"
  fi

  if [ "$MODE" = "--check" ]; then
    resolve_core_key 2>/dev/null || true
    if [ -n "$CORE_KEY" ]; then
      if core_key_needs_change; then
        log "External Auth restart required to load the Core API key: yes (this would relock the wallet)"
      else
        log "External Auth restart required to load the Core API key: no"
      fi
    fi
  fi
  log "preflight OK"
}

capture_state() {
  mkdir -p "$BACKUP_DIR"
  chmod 0700 "$BACKUP_DIR"
  log "backup: $BACKUP_DIR"
  {
    echo "stamp=$STAMP"
    echo "host=$(hostname)"
    echo "repo_head=$(git -C "$REPO_DIR" rev-parse HEAD 2>/dev/null || true)"
    echo "config_sha256=$(sha256sum "$BROKER_CONFIG" | awk '{print $1}')"
    echo "clients_sha256=$(sha256sum "$CLIENTS_FILE" | awk '{print $1}')"
    [ -e "$STATE_FILE" ] && echo "state_sha256=$(sha256sum "$STATE_FILE" | awk '{print $1}')"
    [ -e "$AUDIT_FILE" ] && echo "audit_sha256=$(sha256sum "$AUDIT_FILE" | awk '{print $1}')"
    echo "token_path=$TOKEN_FILE"
    if [ -e "$TOKEN_FILE" ]; then
      echo "token_sha256=$(sha256sum "$TOKEN_FILE" | awk '{print $1}')"
      echo "token_mode=$(stat -c %a "$TOKEN_FILE")"
      echo "token_owner=$(stat -c '%U:%G' "$TOKEN_FILE")"
    fi
    for unit in "$EA_SERVICE" "$BROKER_SERVICE" "$CRED_TIMER" "$CRED_SERVICE"; do
      echo "unit_$unit=$(systemctl is-active "$unit" 2>/dev/null || true)/$(systemctl is-enabled "$unit" 2>/dev/null || true)"
    done
  } >"$BACKUP_DIR/current-state.txt"
  chmod 0600 "$BACKUP_DIR/current-state.txt"

  systemctl status "$EA_SERVICE" --no-pager -n 20 >"$BACKUP_DIR/ea-status.txt" 2>&1 || true
  systemctl status "$BROKER_SERVICE" --no-pager -n 20 >"$BACKUP_DIR/broker-status.txt" 2>&1 || true

  tar -C "$BROKER_DIR" -czf "$BACKUP_DIR/broker-installed.tar.gz" broker/src broker/scripts
  cp -a "$BROKER_CONFIG" "$BACKUP_DIR/broker-config.json"
  cp -a "$CLIENTS_FILE" "$BACKUP_DIR/clients.json"
  [ -e "$STATE_FILE" ] && cp -a "$STATE_FILE" "$BACKUP_DIR/state.json"
  [ -e "$AUDIT_FILE" ] && cp -a "$AUDIT_FILE" "$BACKUP_DIR/audit.jsonl"

  if [ -f "$EA_DROPIN" ]; then cp -a "$EA_DROPIN" "$BACKUP_DIR/ea-dropin.conf"; fi
  if [ -f "$EA_KEY_ENV_FILE" ]; then cp -a "$EA_KEY_ENV_FILE" "$BACKUP_DIR/ea-node-api-key.env"; fi
  cp -a "/etc/systemd/system/$EA_SERVICE.service" "$BACKUP_DIR/ea-unit.service" 2>/dev/null || true
  chmod 0600 "$BACKUP_DIR"/* 2>/dev/null || true
  log "backup complete (token metadata only; the token value is never copied)"
}

deploy_broker() {
  log "installing corrected broker code (no External Auth patch or rebuild)"
  [ -d "$REPO_DIR/broker/src" ] || die "repository broker source missing"
  while IFS= read -r file; do node --check "$file"; done < <(find "$REPO_DIR/broker/src" "$REPO_DIR/broker/scripts" -type f -name "*.js")
  mkdir -p "$BROKER_SRC_DIR" "$BROKER_SCRIPT_DIR"
  cp -a "$REPO_DIR/broker/src/." "$BROKER_SRC_DIR/"
  cp -a "$REPO_DIR/broker/scripts/." "$BROKER_SCRIPT_DIR/"
  chown -R "$OWNER_USER":"$BROKER_GROUP" "$BROKER_SRC_DIR" "$BROKER_SCRIPT_DIR"
  find "$BROKER_SRC_DIR" "$BROKER_SCRIPT_DIR" -type d -exec chmod 0750 {} +
  find "$BROKER_SRC_DIR" "$BROKER_SCRIPT_DIR" -type f -exec chmod 0640 {} +
  grep -q 'CORE_API_KEY_MISSING' "$BROKER_SRC_DIR/signing/external-auth.js" \
    || die "installed broker diagnostics marker missing"
  resolve_provisioner || die "token provisioner not installed: $BROKER_SCRIPT_DIR"
  resolve_supervisor || die "credential supervisor not installed: $BROKER_SRC_DIR"
  log "broker code installed; config, clients, state and audit untouched"
}

configure_core_api_key() {
  [ -n "$CORE_KEY" ] || resolve_core_key
  if ! core_key_needs_change; then
    log "Core API key already in $EA_KEY_ENV_FILE, drop-in installed, and loaded by $EA_SERVICE; External Auth will not be restarted"
    verify_ea_env
    return 0
  fi

  log "configuring the Core API key through the External Auth EnvironmentFile/drop-in"
  install -d -m 0750 -o root -g root "$(dirname "$EA_KEY_ENV_FILE")"
  local tmp="$EA_KEY_ENV_FILE.qms-new.$$"
  ( umask 077; printf 'QORTAL_AUTH_NODE_API_KEY=%s\n' "$CORE_KEY" >"$tmp" )
  chown root:root "$tmp"
  chmod 0600 "$tmp"
  mv -f "$tmp" "$EA_KEY_ENV_FILE"

  install -d -m 0755 -o root -g root "$EA_DROPIN_DIR"
  local dropin_tmp="$EA_DROPIN.qms-new.$$"
  printf '[Service]\nEnvironmentFile=-%s\n' "$EA_KEY_ENV_FILE" >"$dropin_tmp"
  chmod 0644 "$dropin_tmp"
  mv -f "$dropin_tmp" "$EA_DROPIN"

  log "restarting External Auth to load the Core API key (wallet will be locked)"
  EA_RESTARTED=true
  systemctl daemon-reload
  systemctl restart "$EA_SERVICE"
  wait_http "$EA_HEALTH" || die "External Auth health did not become ready after restart"
  verify_ea_env
}

provision_token_before_broker() {
  log "provisioning a replacement External Auth session before broker start"
  if ! resolve_provisioner; then log "ERROR: token provisioner missing"; return 1; fi
  if ! resolve_runuser; then log "ERROR: runuser not found"; return 1; fi
  local staging result
  staging=$(mktemp -d "${TMPDIR:-/tmp}/qms-auth-token.XXXXXX")
  chmod 0700 "$staging"
  if ! chown "$EA_SUPERVISOR_USER":"$EA_SUPERVISOR_GROUP" "$staging" 2>/dev/null; then
    rm -rf "$staging"
    log "ERROR: cannot hand token staging directory to $EA_SUPERVISOR_USER"
    return 1
  fi
  if ! result=$("$RUNUSER_BIN" -u "$EA_SUPERVISOR_USER" -g "$EA_SUPERVISOR_GROUP" -G "$BROKER_GROUP" -- node "$PROVISION_SCRIPT" \
      --supervisor-config "$SUPERVISOR_CONFIG" --output "$staging/token"); then
    rm -rf "$staging"
    log "ERROR: pre-broker External Auth session provisioning failed"
    return 1
  fi
  if [ ! -s "$staging/token" ]; then
    rm -rf "$staging"
    log "ERROR: provisioner produced no token"
    return 1
  fi
  if ! install -o "$BROKER_USER" -g "$BROKER_GROUP" -m 0600 "$staging/token" "$TOKEN_FILE"; then
    rm -rf "$staging"
    log "ERROR: cannot install token file at $TOKEN_FILE"
    return 1
  fi
  rm -rf "$staging"
  chown "$BROKER_USER":"$BROKER_GROUP" "$TOKEN_FILE" 2>/dev/null || true
  chmod 0600 "$TOKEN_FILE" 2>/dev/null || true
  if ! verify_token_file_shape; then
    log "ERROR: invalid token file content at $TOKEN_FILE"
    return 1
  fi
  log "replacement session written to $TOKEN_FILE ($result)"
  return 0
}

renew_credential_after_start() {
  log "starting credential timer and one-shot renewal"
  systemctl start "$CRED_TIMER" || die "cannot start $CRED_TIMER"
  systemctl start "$CRED_SERVICE" || log "WARNING: $CRED_SERVICE one-shot failed; forcing a renewal"
  if ! resolve_supervisor; then die "credential supervisor missing for post-start renewal"; fi
  resolve_runuser || die "runuser not found for post-start renewal"
  log "forcing one supervisor renewal through the broker credential socket"
  "$RUNUSER_BIN" -u "$EA_SUPERVISOR_USER" -g "$EA_SUPERVISOR_GROUP" -G "$BROKER_GROUP" -- node "$SUPERVISOR_SCRIPT" --config "$SUPERVISOR_CONFIG" --force \
    || die "post-start credential renewal failed"
  verify_token_file_shape || die "post-start credential renewal wrote an invalid token"
}

verify_all() {
  local expected_disabled="$1"
  log "verify External Auth health"
  ea_health | grep -Eq '"ok":true|"status":"ok"' || die "External Auth health failed"
  verify_ea_env
  log "verify broker health"
  broker_health | tee "$BACKUP_DIR/broker-health.json" | grep -Eq '"status":"ok"' || die "broker health failed"
  log "verify broker admin status"
  wait_socket "$ADMIN_SOCKET" || die "admin socket not ready: $ADMIN_SOCKET"
  node "$BROKER_SRC_DIR/control.js" "$ADMIN_SOCKET" status >"$BACKUP_DIR/admin-status.json"
  grep -Eq '"ok":true' "$BACKUP_DIR/admin-status.json" || die "admin status not ok"

  verify_token_file_owner
  verify_token_file_shape
  local expected actual
  expected=$(token_fingerprint)
  actual=$(admin_credential_fingerprint)
  [ -n "$actual" ] || die "broker admin status has no credential fingerprint"
  [ "$expected" = "$actual" ] || die "broker credential fingerprint does not match $TOKEN_FILE"

  if [ "$expected_disabled" = "true" ]; then
    [ -e "$KILL_SWITCH_FILE" ] || die "kill switch was preexisting but is now missing"
  else
    [ ! -e "$KILL_SWITCH_FILE" ] || die "kill switch remained engaged after successful deployment"
  fi
  log "verify clients registry, credential socket and token"
  grep -q "qms-broker-client-keys@2" "$CLIENTS_FILE" || die "clients registry schema missing"
  grep -q "keyId" "$CLIENTS_FILE" || die "clients registry has no keyId"
  wait_socket "$CRED_SOCKET" || die "credential socket not created by broker: $CRED_SOCKET"
  systemctl is-active --quiet "$CRED_TIMER" || die "credential renewal timer is not active"
  [ -s "$TOKEN_FILE" ] || die "broker External Auth token was not renewed: $TOKEN_FILE"
  log "verification OK (no wallet password, private key or token value used on this host)"
}

print_unlock_action() {
  log "OPERATOR UNLOCK ACTION (exactly one): sudo $BROKER_SCRIPT_DIR/operator-unlock-external-auth.sh --wallet-id <EXTERNAL_AUTH_WALLET_ID>"
}

print_operator_steps() {
  log "--------------------------------------------------------------------------------"
  if [ "$EA_RESTARTED" = "true" ]; then
    log "External Auth was restarted to load the Core API key; its sessions are invalid and the wallet is LOCKED."
    print_unlock_action
    log "Do not publish before that command succeeds. The password is prompted and never logged."
  else
    log "External Auth was NOT restarted; no wallet unlock action is required."
  fi
  log "No QDN transaction was submitted by this script; UFW, Tailscale, Caddy and Qortal names were not changed."
  log "--------------------------------------------------------------------------------"
}

rollback() {
  local source_dir="$1"
  log "ROLLBACK from $source_dir"
  touch "$KILL_SWITCH_FILE"
  chown "$OWNER_USER":"$BROKER_GROUP" "$KILL_SWITCH_FILE" 2>/dev/null || true
  chmod 0640 "$KILL_SWITCH_FILE" 2>/dev/null || true
  systemctl stop "$BROKER_SERVICE" || true
  systemctl stop "$CRED_TIMER" "$CRED_SERVICE" || true

  if [ -f "$source_dir/broker-config.json" ]; then cp -a "$source_dir/broker-config.json" "$BROKER_CONFIG" || return 1; fi
  if [ -f "$source_dir/clients.json" ]; then cp -a "$source_dir/clients.json" "$CLIENTS_FILE" || return 1; fi
  if [ -f "$source_dir/state.json" ]; then cp -a "$source_dir/state.json" "$STATE_FILE" || return 1; fi
  if [ -f "$source_dir/audit.jsonl" ]; then cp -a "$source_dir/audit.jsonl" "$AUDIT_FILE" || return 1; fi

  if [ -f "$source_dir/ea-dropin.conf" ]; then
    install -d -m 0755 -o root -g root "$EA_DROPIN_DIR" || return 1
    install -m 0644 -o root -g root "$source_dir/ea-dropin.conf" "$EA_DROPIN" || return 1
  else
    rm -f "$EA_DROPIN"
  fi
  if [ -f "$source_dir/ea-node-api-key.env" ]; then
    install -m 0600 -o root -g root "$source_dir/ea-node-api-key.env" "$EA_KEY_ENV_FILE" || return 1
  else
    rm -f "$EA_KEY_ENV_FILE"
  fi

  systemctl daemon-reload || true
  systemctl restart "$EA_SERVICE" || true
  EA_RESTARTED=true
  if ! wait_http "$EA_HEALTH"; then
    log "ROLLBACK INCOMPLETE: External Auth health is not ready; broker left stopped and kill switch engaged"
    print_unlock_action
    return 1
  fi

  # Provision before restoring the previous broker tree: the new provisioner
  # may not exist in that tree, and the broker must never start with a stale
  # token after the External Auth restart.
  if ! provision_token_before_broker; then
    log "ROLLBACK INCOMPLETE: no valid External Auth token; broker left stopped and kill switch engaged"
    print_unlock_action
    return 1
  fi

  if [ -f "$source_dir/broker-installed.tar.gz" ]; then
    if ! tar -C "$BROKER_DIR" -xzf "$source_dir/broker-installed.tar.gz"; then
      log "ROLLBACK INCOMPLETE: cannot restore the previous broker tree; broker left stopped and kill switch engaged"
      print_unlock_action
      return 1
    fi
  fi

  if ! systemctl start "$BROKER_SERVICE"; then
    log "ROLLBACK INCOMPLETE: broker failed to start; kill switch remains engaged"
    print_unlock_action
    return 1
  fi
  if ! wait_http "$BROKER_HEALTH"; then
    log "ROLLBACK INCOMPLETE: broker health not ready; kill switch remains engaged"
    print_unlock_action
    return 1
  fi
  wait_socket "$CRED_SOCKET" || log "WARNING: credential socket not ready after rollback"

  systemctl start "$CRED_TIMER" || true
  systemctl start "$CRED_SERVICE" || true
  if wait_socket "$CRED_SOCKET"; then
    if resolve_supervisor && resolve_runuser; then
      "$RUNUSER_BIN" -u "$EA_SUPERVISOR_USER" -g "$EA_SUPERVISOR_GROUP" -G "$BROKER_GROUP" -- node "$SUPERVISOR_SCRIPT" --config "$SUPERVISOR_CONFIG" --force \
        || log "WARNING: post-rollback credential renewal failed; the timer will retry"
    fi
  fi

  log "rollback complete; kill switch remains engaged at $KILL_SWITCH_FILE"
  print_unlock_action
  return 0
}

on_error() {
  local code="${1:-$?}"
  trap - ERR
  ROLLBACK_ON_DIE=false
  log "deployment failed (exit $code)"
  if [ -n "$BACKUP_DIR" ] && [ -d "$BACKUP_DIR" ]; then
    rollback "$BACKUP_DIR" || log "WARNING: rollback incomplete; see messages above"
  fi
  exit "$code"
}

run_deploy() {
  preflight
  if [ "$MODE" = "--check" ]; then
    log "check-only mode: no changes made"
    exit 0
  fi
  require_root
  [ "$MODE" = "--yes" ] || die "refusing to change the signing VPS without --yes"

  # Validate the key before any change so a bad key cannot trigger a rollback
  # that restarts External Auth and relocks the wallet for nothing.
  resolve_core_key
  verify_core_key
  log "Core API key validated against $CORE_URL (value not printed)"

  capture_state
  trap on_error ERR
  ROLLBACK_ON_DIE=true
  local kill_preexisting=false
  [ -e "$KILL_SWITCH_FILE" ] && kill_preexisting=true

  log "engaging kill switch"
  touch "$KILL_SWITCH_FILE"
  chown "$OWNER_USER":"$BROKER_GROUP" "$KILL_SWITCH_FILE" 2>/dev/null || true
  chmod 0640 "$KILL_SWITCH_FILE"

  log "stopping broker, then credential renewal"
  systemctl stop "$BROKER_SERVICE"
  systemctl stop "$CRED_TIMER" "$CRED_SERVICE" || true

  deploy_broker
  configure_core_api_key
  wait_http "$EA_HEALTH" || die "External Auth health is not ready"
  verify_ea_env

  provision_token_before_broker || die "pre-broker External Auth session provisioning failed"

  log "starting broker only after a valid token file exists"
  systemctl start "$BROKER_SERVICE"
  wait_http "$BROKER_HEALTH" || die "broker health did not become ready"
  wait_socket "$CRED_SOCKET" || die "credential socket was not created by broker"

  if [ "$kill_preexisting" = "false" ]; then
    log "releasing deployment kill switch"
    rm -f "$KILL_SWITCH_FILE"
  else
    log "kill switch existed before deployment; leaving it engaged"
  fi

  renew_credential_after_start
  verify_all "$kill_preexisting"
  trap - ERR
  ROLLBACK_ON_DIE=false
  log "DEPLOYMENT COMPLETE: broker code and Core API key active; a valid pre-start token was replaced through the normal supervisor"
  log "No QDN transaction, wallet unlock, token value or private Ed25519 key was used by this script."
  print_operator_steps
}

resolve_rollback_token_file() {
  if [ -f "$ROLLBACK_DIR/current-state.txt" ]; then
    local backed
    backed=$(sed -n 's/^token_path=//p' "$ROLLBACK_DIR/current-state.txt" | head -1)
    if [ -n "$backed" ]; then
      TOKEN_FILE="$backed"
      log "using backed-up token path: $TOKEN_FILE"
      return 0
    fi
  fi
  resolve_token_file
}

run_rollback() {
  require_root
  [ -n "$ROLLBACK_DIR" ] && [ -d "$ROLLBACK_DIR" ] \
    || die "usage: $0 --rollback /var/backups/qms-phase5.2/<stamp>"
  resolve_rollback_token_file
  rollback "$ROLLBACK_DIR"
}

case "$MODE" in
  --check|--yes) run_deploy ;;
  --rollback) run_rollback ;;
  *) echo "usage: $0 --check | --yes [--core-api-key-file PATH] | --rollback <backup-dir>"; exit 2 ;;
esac
