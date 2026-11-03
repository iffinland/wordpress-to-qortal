#!/usr/bin/env bash
# Phase 5.2 Core-rejection fix - idempotent signing-VPS deployment.
#
# Deploys, in this order:
#   1. the broker atomic-fee + sanitized-diagnostic code;
#   2. the External Auth 0.2.0 patches (fee/path encoding + Core diagnostics);
#   3. the External Auth -> Qortal Core API key needed by
#      POST /arbitrary/{service}/{name}/{identifier}/base64.
#
# External Auth is restarted by this procedure, so its in-memory sessions are
# invalidated and any unlocked wallet cache is dropped. The script never
# unlocks a wallet and never handles a wallet password. After it finishes the
# operator must run broker/scripts/operator-unlock-external-auth.sh once.
#
# It does not change UFW, Tailscale, Caddy, wallets or Qortal names.
#
# Actual signing-VPS layout:
#   repo checkout:      /home/iffiolen/qms-broker-deploy
#   broker install:     /opt/qms-qdn-test-broker
#   broker source:      /opt/qms-qdn-test-broker/broker/src
#   broker scripts:     /opt/qms-qdn-test-broker/broker/scripts
#   External Auth src:  /home/iffiolen/qortal-external-auth-src
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
EA_REPO_DIR=${EA_REPO_DIR:-/home/iffiolen/qortal-external-auth-src}
EA_INSTALL_DIR=${EA_INSTALL_DIR:-/opt/qortal-external-auth}
BROKER_DIR=${BROKER_DIR:-/opt/qms-qdn-test-broker}
BROKER_SRC_DIR=${BROKER_SRC_DIR:-$BROKER_DIR/broker/src}
BROKER_SCRIPT_DIR=${BROKER_SCRIPT_DIR:-$BROKER_DIR/broker/scripts}
BROKER_CONFIG=${BROKER_CONFIG:-/etc/qms-qdn-test-broker/config.json}
CLIENTS_FILE=${CLIENTS_FILE:-/etc/qms-qdn-test-broker/clients.json}
STATE_FILE=${STATE_FILE:-/var/lib/qms-qdn-test-broker/state.json}
AUDIT_FILE=${AUDIT_FILE:-/var/lib/qms-qdn-test-broker/audit.jsonl}
KILL_SWITCH_FILE=${KILL_SWITCH_FILE:-/var/lib/qms-qdn-test-broker/DISABLED}
TOKEN_FILE=${TOKEN_FILE:-/etc/qms-qdn-test-broker/external-auth-token}
ADMIN_SOCKET=${ADMIN_SOCKET:-/run/qms-qdn-test-broker/admin.sock}
CRED_SOCKET=${CRED_SOCKET:-/run/qms-qdn-test-broker/credential.sock}
BACKUP_ROOT=${BACKUP_ROOT:-/var/backups/qms-phase5.2}
EA_SERVICE=${EA_SERVICE:-qortal-external-auth}
EA_USER=${EA_USER:-qortal-auth}
EA_KEY_ENV_FILE=${EA_KEY_ENV_FILE:-/etc/qortal-external-auth/node-api-key.env}
EA_DROPIN_DIR=${EA_DROPIN_DIR:-/etc/systemd/system/${EA_SERVICE}.service.d}
EA_DROPIN=${EA_DROPIN:-$EA_DROPIN_DIR/10-node-api-key.conf}
CORE_URL=${CORE_URL:-http://127.0.0.1:12391}
BROKER_SERVICE=${BROKER_SERVICE:-qms-qdn-test-broker}
CRED_TIMER=${CRED_TIMER:-qms-auth-credential.timer}
CRED_SERVICE=${CRED_SERVICE:-qms-auth-credential.service}
BROKER_USER=${BROKER_USER:-qms-broker}
OWNER_USER=${OWNER_USER:-root}
EA_HEALTH=${EA_HEALTH:-http://127.0.0.1:3191/health}
BROKER_HEALTH=${BROKER_HEALTH:-http://127.0.0.1:3199/v1/health}

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
PATCH_FEE="$REPO_DIR/patches/qortal-external-auth-0.2.0-qdn-publish.patch"
PATCH_DIAG="$REPO_DIR/patches/qortal-external-auth-0.2.0-core-diagnostics.patch"

log()  { printf "%s %s\n" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
die()  { log "ERROR: $*"; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "missing required command: $1"; }
require_root() { [ "$(id -u)" -eq 0 ] || die "run as root for --yes/--rollback"; }

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

ea_patch_state() {
  local patch="$1"
  local src="$EA_REPO_DIR/packages/auth-daemon/src/index.ts"
  local diag="$EA_REPO_DIR/packages/auth-daemon/src/publishDiagnostics.ts"
  git -C "$EA_REPO_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1 || { echo not-a-repo; return; }
  [ -f "$src" ] || { echo conflict; return; }
  if [ "$patch" = "$PATCH_FEE" ]; then
    if grep -q 'encodeURIComponent(String(resolvedName))' "$src" && grep -q 'let feeValue: number' "$src"; then
      echo applied; return
    fi
  elif [ "$patch" = "$PATCH_DIAG" ]; then
    if [ -f "$diag" ] && grep -q 'nodeErrorDiagnostic' "$src"; then
      echo applied; return
    fi
  fi
  if git -C "$EA_REPO_DIR" apply --check "$patch" >/dev/null 2>&1; then
    echo fresh
  else
    echo conflict
  fi
}

core_key_present() {
  if [ -n "${CORE_API_KEY_FILE:-}" ] && [ -r "$CORE_API_KEY_FILE" ]; then return 0; fi
  if [ -r "$EA_KEY_ENV_FILE" ] && grep -q '^QORTAL_AUTH_NODE_API_KEY=.' "$EA_KEY_ENV_FILE"; then return 0; fi
  if systemctl show "$EA_SERVICE" -p Environment 2>/dev/null | grep -q 'QORTAL_AUTH_NODE_API_KEY=[^" ]'; then return 0; fi
  return 1
}

resolve_core_key() {
  if [ -n "${CORE_API_KEY_FILE:-}" ]; then
    [ -r "$CORE_API_KEY_FILE" ] || die "Core API key file is not readable: $CORE_API_KEY_FILE"
    CORE_KEY=$(tr -d '\r\n' <"$CORE_API_KEY_FILE")
    [ -n "$CORE_KEY" ] || die "Core API key file is empty: $CORE_API_KEY_FILE"
    return 0
  fi
  if [ -r "$EA_KEY_ENV_FILE" ]; then
    CORE_KEY=$(sed -n 's/^QORTAL_AUTH_NODE_API_KEY=//p' "$EA_KEY_ENV_FILE" | head -1 | tr -d '\r\n')
    [ -n "$CORE_KEY" ] && return 0
  fi
  CORE_KEY=$(systemctl show "$EA_SERVICE" -p Environment 2>/dev/null \
    | tr ' ' '\n' | sed -n 's/^QORTAL_AUTH_NODE_API_KEY=//p' | head -1 | tr -d '"')
  [ -n "${CORE_KEY:-}" ] || die "no Core API key configured; rerun with --core-api-key-file /path/to/apikey.txt"
}

verify_core_key() {
  QMS_CORE_URL="$CORE_URL" QMS_CORE_KEY="$CORE_KEY" node -e '
    const url = process.env.QMS_CORE_URL + "/admin/apikey/test";
    fetch(url, { headers: { "X-API-KEY": process.env.QMS_CORE_KEY } })
      .then(async (response) => {
        const text = (await response.text()).trim();
        if (!response.ok || text !== "true") {
          console.error("Core API key test failed with HTTP " + response.status);
          process.exit(1);
        }
      })
      .catch((error) => { console.error("Core API key test failed: " + error.message); process.exit(1); });
  '
}

preflight() {
  log "preflight: actual signing-VPS layout"
  for cmd in git node npm systemctl curl tar sha256sum ss df; do need "$cmd"; done
  [ -d "$REPO_DIR/broker/src" ] || die "repo broker source missing: $REPO_DIR/broker/src"
  [ -d "$BROKER_SRC_DIR" ] || die "installed broker source missing: $BROKER_SRC_DIR"
  [ -d "$BROKER_SCRIPT_DIR" ] || die "installed broker scripts missing: $BROKER_SCRIPT_DIR"
  [ -d "$EA_REPO_DIR" ] || die "External Auth source checkout missing: $EA_REPO_DIR"
  [ -d "$EA_INSTALL_DIR" ] || die "External Auth install missing: $EA_INSTALL_DIR"
  [ -d "$EA_INSTALL_DIR/packages/auth-daemon" ] || die "External Auth install layout missing packages/auth-daemon"
  [ -f "$BROKER_CONFIG" ] || die "broker config missing: $BROKER_CONFIG"
  [ -f "$CLIENTS_FILE" ] || die "clients registry missing: $CLIENTS_FILE"
  [ -d "$(dirname "$STATE_FILE")" ] || die "state directory missing: $(dirname "$STATE_FILE")"
  id "$BROKER_USER" >/dev/null 2>&1 || die "broker user missing: $BROKER_USER"
  id "$EA_USER" >/dev/null 2>&1 || die "External Auth user missing: $EA_USER"
  [ -f "$PATCH_FEE" ] || die "missing External Auth fee patch: $PATCH_FEE"
  [ -f "$PATCH_DIAG" ] || die "missing External Auth diagnostics patch: $PATCH_DIAG"

  for unit in "$EA_SERVICE" "$BROKER_SERVICE" "$CRED_TIMER" "$CRED_SERVICE"; do
    systemctl cat "$unit" >/dev/null 2>&1 || die "systemd unit not found: $unit"
  done

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

  local fee_state diag_state
  fee_state=$(ea_patch_state "$PATCH_FEE")
  diag_state=$(ea_patch_state "$PATCH_DIAG")
  log "External Auth patch state: fee=$fee_state diagnostics=$diag_state"
  [ "$fee_state" != conflict ] || die "fee patch conflicts with the External Auth checkout"
  [ "$diag_state" != conflict ] || die "diagnostics patch conflicts with the External Auth checkout"
  if [ "$fee_state" = fresh ] && [ "$diag_state" = applied ]; then
    die "diagnostics patch is applied but the fee patch is not; refusing an inconsistent checkout"
  fi

  if core_key_present; then
    log "Core API key: configured"
  else
    log "Core API key: NOT configured"
    [ "$MODE" = "--check" ] || die "Core API key missing; rerun with --core-api-key-file /path/to/apikey.txt"
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
    echo "ea_head=$(git -C "$EA_REPO_DIR" rev-parse HEAD 2>/dev/null || true)"
    echo "ea_status=$(git -C "$EA_REPO_DIR" status --porcelain 2>/dev/null | wc -l)"
    echo "ea_version=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$EA_INSTALL_DIR/package.json" 2>/dev/null | head -1)"
    echo "config_sha256=$(sha256sum "$BROKER_CONFIG" | awk '{print $1}')"
    echo "clients_sha256=$(sha256sum "$CLIENTS_FILE" | awk '{print $1}')"
    [ -e "$STATE_FILE" ] && echo "state_sha256=$(sha256sum "$STATE_FILE" | awk '{print $1}')"
    [ -e "$AUDIT_FILE" ] && echo "audit_sha256=$(sha256sum "$AUDIT_FILE" | awk '{print $1}')"
    [ -e "$TOKEN_FILE" ] && echo "token_sha256=$(sha256sum "$TOKEN_FILE" | awk '{print $1}')"
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

  if [ -d "$EA_INSTALL_DIR/packages/auth-daemon/dist" ]; then
    tar -C "$EA_INSTALL_DIR/packages/auth-daemon" -czf "$BACKUP_DIR/ea-dist.tar.gz" dist
  fi
  tar -C /etc/systemd/system --ignore-failed-read -czf "$BACKUP_DIR/ea-systemd.tar.gz" \
    "${EA_SERVICE}.service" "${EA_SERVICE}.service.d" 2>/dev/null || true
  cp -a "$EA_KEY_ENV_FILE" "$BACKUP_DIR/ea-node-api-key.env" 2>/dev/null || true
  chmod 0600 "$BACKUP_DIR"/* 2>/dev/null || true
  log "backup complete"
}

deploy_broker() {
  log "installing corrected broker code"
  [ -d "$REPO_DIR/broker/src" ] || die "repository broker source missing"
  while IFS= read -r file; do node --check "$file"; done < <(find "$REPO_DIR/broker/src" "$REPO_DIR/broker/scripts" -type f -name "*.js")
  mkdir -p "$BROKER_SRC_DIR" "$BROKER_SCRIPT_DIR"
  cp -a "$REPO_DIR/broker/src/." "$BROKER_SRC_DIR/"
  cp -a "$REPO_DIR/broker/scripts/." "$BROKER_SCRIPT_DIR/"
  chown -R "$OWNER_USER":"$BROKER_USER" "$BROKER_SRC_DIR" "$BROKER_SCRIPT_DIR"
  find "$BROKER_SRC_DIR" "$BROKER_SCRIPT_DIR" -type d -exec chmod 0750 {} +
  find "$BROKER_SRC_DIR" "$BROKER_SCRIPT_DIR" -type f -exec chmod 0640 {} +
  grep -q 'CORE_API_KEY_MISSING' "$BROKER_SRC_DIR/signing/external-auth.js" \
    || die "installed broker diagnostics marker missing"
  log "broker code installed; config, clients, state and audit untouched"
}

configure_core_api_key() {
  log "configuring the External Auth Core API key"
  [ -n "${CORE_KEY:-}" ] || resolve_core_key
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
  log "Core API key valid; EnvironmentFile drop-in installed (value never printed)"
}

apply_ea_patches() {
  log "applying External Auth patches to $EA_REPO_DIR"
  git -C "$EA_REPO_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1 \
    || die "External Auth source is not a git checkout: $EA_REPO_DIR"
  local fee_state diag_state
  fee_state=$(ea_patch_state "$PATCH_FEE")
  diag_state=$(ea_patch_state "$PATCH_DIAG")
  case "$fee_state" in
    fresh) git -C "$EA_REPO_DIR" apply "$PATCH_FEE"; log "fee patch applied" ;;
    applied) log "fee patch already applied" ;;
    *) die "fee patch cannot be applied (state=$fee_state)" ;;
  esac
  diag_state=$(ea_patch_state "$PATCH_DIAG")
  case "$diag_state" in
    fresh) git -C "$EA_REPO_DIR" apply "$PATCH_DIAG"; log "diagnostics patch applied" ;;
    applied) log "diagnostics patch already applied" ;;
    *) die "diagnostics patch cannot be applied (state=$diag_state)" ;;
  esac
}

build_and_install_ea() {
  log "building External Auth (typecheck + auth-core + auth-daemon)"
  if [ ! -x "$EA_REPO_DIR/node_modules/typescript/bin/tsc" ]; then
    log "installing External Auth build dependencies (npm ci)"
    ( cd "$EA_REPO_DIR" && npm ci --include=dev --no-audit --no-fund ) \
      || die "npm ci failed for External Auth"
  fi
  ( cd "$EA_REPO_DIR" && npm run build ) || die "External Auth build failed"

  local src="$EA_REPO_DIR/packages/auth-daemon/dist"
  local dst="$EA_INSTALL_DIR/packages/auth-daemon/dist"
  [ -f "$src/index.js" ] || die "External Auth build output missing: $src/index.js"
  grep -q 'CORE_API_KEY_MISSING' "$src/publishDiagnostics.js" \
    || die "External Auth diagnostics module missing from build output"

  local staged="$dst.qms-new.$$"
  rm -rf "$staged"
  cp -a "$src" "$staged"
  chown -R root:root "$staged"
  find "$staged" -type d -exec chmod 0755 {} +
  find "$staged" -type f -exec chmod 0644 {} +
  if [ -d "$dst" ]; then
    local retired="$dst.qms-old.$$"
    mv "$dst" "$retired"
    mv "$staged" "$dst"
    rm -rf "$retired"
  else
    mv "$staged" "$dst"
  fi
  grep -q 'CORE_API_KEY_MISSING' "$dst/publishDiagnostics.js" \
    || die "installed External Auth diagnostics marker missing"
  log "External Auth dist installed (previous dist backed up)"
}

verify_ea_env() {
  local pid
  pid=$(systemctl show -p MainPID --value "$EA_SERVICE")
  [ -n "$pid" ] && [ "$pid" != "0" ] || die "External Auth has no main PID"
  tr '\0' '\n' <"/proc/$pid/environ" | grep -q '^QORTAL_AUTH_NODE_API_KEY=' \
    || die "External Auth process does not have QORTAL_AUTH_NODE_API_KEY loaded"
  log "External Auth process has the Core API key loaded (value not printed)"
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

print_operator_steps() {
  log "--------------------------------------------------------------------------------"
  log "External Auth was restarted: its sessions are invalid and the wallet is LOCKED."
  log "The broker token was renewed by $CRED_SERVICE."
  log "Operator next steps (run these yourself; the password is prompted, never logged):"
  log "  1) sudo $BROKER_SCRIPT_DIR/operator-unlock-external-auth.sh --wallet-id <WALLET_ID>"
  log "  2) submit ONE new publication with a NEW identifier (never qms-dev-final-001)"
  log "  3) read GET /v1/publications/{id} and report diagnostic.errorCode/coreMessage"
  log "--------------------------------------------------------------------------------"
}

rollback() {
  local source_dir="$1"
  log "ROLLBACK from $source_dir"
  touch "$KILL_SWITCH_FILE"
  chmod 0640 "$KILL_SWITCH_FILE" 2>/dev/null || true
  systemctl stop "$BROKER_SERVICE" || true
  systemctl stop "$CRED_TIMER" "$CRED_SERVICE" || true

  if [ -f "$source_dir/broker-installed.tar.gz" ]; then
    tar -C "$BROKER_DIR" -xzf "$source_dir/broker-installed.tar.gz"
  fi
  [ -f "$source_dir/broker-config.json" ] && cp -a "$source_dir/broker-config.json" "$BROKER_CONFIG"
  [ -f "$source_dir/clients.json" ] && cp -a "$source_dir/clients.json" "$CLIENTS_FILE"
  [ -f "$source_dir/state.json" ] && cp -a "$source_dir/state.json" "$STATE_FILE"
  [ -f "$source_dir/audit.jsonl" ] && cp -a "$source_dir/audit.jsonl" "$AUDIT_FILE"

  if [ -f "$source_dir/ea-dist.tar.gz" ]; then
    rm -rf "$EA_INSTALL_DIR/packages/auth-daemon/dist"
    tar -C "$EA_INSTALL_DIR/packages/auth-daemon" -xzf "$source_dir/ea-dist.tar.gz"
  fi
  if [ -f "$source_dir/ea-systemd.tar.gz" ]; then
    rm -rf "$EA_DROPIN_DIR"
    tar -C /etc/systemd/system -xzf "$source_dir/ea-systemd.tar.gz" 2>/dev/null || true
  fi
  if [ -f "$source_dir/ea-node-api-key.env" ]; then
    install -m 0600 -o root -g root "$source_dir/ea-node-api-key.env" "$EA_KEY_ENV_FILE"
  else
    rm -f "$EA_KEY_ENV_FILE"
  fi
  systemctl daemon-reload || true
  systemctl restart "$EA_SERVICE" || true
  wait_http "$EA_HEALTH" || log "WARNING: External Auth health not ready after rollback"

  systemctl start "$BROKER_SERVICE" || true
  wait_http "$BROKER_HEALTH" || log "WARNING: broker health not ready after rollback"
  wait_socket "$CRED_SOCKET" || log "WARNING: credential socket not ready after rollback"
  systemctl start "$CRED_TIMER" || true
  systemctl start "$CRED_SERVICE" || true
  log "rollback complete; kill switch remains engaged at $KILL_SWITCH_FILE"
  log "External Auth was restarted again; run operator-unlock-external-auth.sh before publishing"
}

on_error() {
  local code=$?
  trap - ERR
  log "deployment failed (exit $code)"
  if [ -n "${BACKUP_DIR:-}" ] && [ -d "$BACKUP_DIR" ]; then
    rollback "$BACKUP_DIR"
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
  log "Core API key validated against $CORE_URL"

  trap on_error ERR

  capture_state
  local kill_preexisting=false
  [ -e "$KILL_SWITCH_FILE" ] && kill_preexisting=true

  log "engaging kill switch"
  touch "$KILL_SWITCH_FILE"
  chown "$OWNER_USER":"$BROKER_USER" "$KILL_SWITCH_FILE" 2>/dev/null || true
  chmod 0640 "$KILL_SWITCH_FILE"

  log "stopping broker, then credential renewal"
  systemctl stop "$BROKER_SERVICE"
  systemctl stop "$CRED_TIMER" "$CRED_SERVICE" || true

  configure_core_api_key
  apply_ea_patches
  build_and_install_ea
  deploy_broker

  log "restarting External Auth (sessions invalidated, wallet relocked)"
  systemctl daemon-reload
  systemctl restart "$EA_SERVICE"
  wait_http "$EA_HEALTH" || die "External Auth health did not become ready"
  verify_ea_env

  log "starting broker"
  systemctl start "$BROKER_SERVICE"
  wait_http "$BROKER_HEALTH" || die "broker health did not become ready"
  wait_socket "$CRED_SOCKET" || die "credential socket was not created by broker"

  if [ "$kill_preexisting" = "false" ]; then
    log "releasing deployment kill switch"
    rm -f "$KILL_SWITCH_FILE"
  else
    log "kill switch existed before deployment; leaving it engaged"
  fi

  log "renewing the broker External Auth token after the restart"
  systemctl start "$CRED_TIMER"
  systemctl start "$CRED_SERVICE"

  verify_all "$kill_preexisting"
  trap - ERR
  log "DEPLOYMENT COMPLETE: broker fee fix, External Auth diagnostics and Core API key active"
  log "No QDN transaction, wallet unlock or token value was used by this script."
  print_operator_steps
}

run_rollback() {
  require_root
  [ -n "${ROLLBACK_DIR:-}" ] && [ -d "$ROLLBACK_DIR" ] \
    || die "usage: $0 --rollback /var/backups/qms-phase5.2/<stamp>"
  rollback "$ROLLBACK_DIR"
}

case "$MODE" in
  --check|--yes) run_deploy ;;
  --rollback) run_rollback ;;
  *) echo "usage: $0 --check | --yes [--core-api-key-file PATH] | --rollback <backup-dir>"; exit 2 ;;
esac
