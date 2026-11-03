#!/usr/bin/env bash
# Phase 5.2 atomic-fee broker fix - idempotent signing-VPS deployment.
#
# Installs only the corrected broker code. It does not apply or restart
# External Auth: the broker now sends the atomic fee that Core expects, so an
# External Auth restart (which would invalidate sessions and can relock the
# wallet) is not required for this fix.
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
#   sudo ./broker/scripts/deploy-phase5.2-external-auth-fix.sh --check
#   sudo ./broker/scripts/deploy-phase5.2-external-auth-fix.sh --yes
#   sudo ./broker/scripts/deploy-phase5.2-external-auth-fix.sh --rollback /var/backups/qms-phase5.2/<stamp>
# The single deployment command is --yes; it includes preflight, backup,
# install, broker-first startup, verification and automatic rollback.
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
ADMIN_SOCKET=${ADMIN_SOCKET:-/run/qms-qdn-test-broker/admin.sock}
CRED_SOCKET=${CRED_SOCKET:-/run/qms-qdn-test-broker/credential.sock}
BACKUP_ROOT=${BACKUP_ROOT:-/var/backups/qms-phase5.2}
EA_SERVICE=${EA_SERVICE:-qortal-external-auth}
BROKER_SERVICE=${BROKER_SERVICE:-qms-qdn-test-broker}
CRED_TIMER=${CRED_TIMER:-qms-auth-credential.timer}
CRED_SERVICE=${CRED_SERVICE:-qms-auth-credential.service}
BROKER_USER=${BROKER_USER:-qms-broker}
OWNER_USER=${OWNER_USER:-root}
EA_HEALTH=${EA_HEALTH:-http://127.0.0.1:3191/health}
BROKER_HEALTH=${BROKER_HEALTH:-http://127.0.0.1:3199/v1/health}
MODE=${1:-}
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
BACKUP_DIR="$BACKUP_ROOT/$STAMP"

log()  { printf "%s %s\n" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
die()  { log "ERROR: $*"; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "missing required command: $1"; }
require_root() { [ "$(id -u)" -eq 0 ] || die "run as root for --yes/--rollback"; }

ea_health() { curl -fsS --max-time 3 "$EA_HEALTH" 2>/dev/null || return 1; }
broker_health() { curl -fsS --max-time 3 "$BROKER_HEALTH" 2>/dev/null || return 1; }
wait_http() {
  local url="$1"
  for _ in $(seq 1 30); do
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

preflight() {
  log "preflight: actual signing-VPS layout"
  [ -d "$REPO_DIR/broker/src" ] || die "repo broker source missing: $REPO_DIR/broker/src"
  [ -d "$BROKER_SRC_DIR" ] || die "installed broker source missing: $BROKER_SRC_DIR"
  [ -d "$BROKER_SCRIPT_DIR" ] || die "installed broker scripts missing: $BROKER_SCRIPT_DIR"
  [ -d "$EA_REPO_DIR" ] || die "External Auth source checkout missing: $EA_REPO_DIR"
  [ -d "$EA_INSTALL_DIR" ] || die "External Auth install missing: $EA_INSTALL_DIR"
  [ -f "$BROKER_CONFIG" ] || die "broker config missing: $BROKER_CONFIG"
  [ -f "$CLIENTS_FILE" ] || die "clients registry missing: $CLIENTS_FILE"
  [ -d "$(dirname "$STATE_FILE")" ] || die "state directory missing: $(dirname "$STATE_FILE")"
  id "$BROKER_USER" >/dev/null 2>&1 || die "broker user missing: $BROKER_USER"

  for unit in "$EA_SERVICE" "$BROKER_SERVICE" "$CRED_TIMER" "$CRED_SERVICE"; do
    systemctl cat "$unit" >/dev/null 2>&1 || die "systemd unit not found: $unit"
  done
  systemctl is-active --quiet "$EA_SERVICE" || die "External Auth is not active; this script does not restart it"

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

  if ss -H -ltn 2>/dev/null | awk "{print \$4}" | grep -Eq "^(0\.0\.0\.0|\[::\]|\*):(8443|3199)$"; then
    die "8443 or 3199 is bound to a wildcard address"
  fi

  local avail_kb probe="$BACKUP_ROOT"
  [ -d "$probe" ] || probe="$(dirname "$BACKUP_ROOT")"
  avail_kb=$(df -Pk "$probe" 2>/dev/null | awk "NR==2 {print \$4}" || true)
  [ -n "$avail_kb" ] && [ "$avail_kb" -gt 2097152 ] || die "need at least 2 GiB free under $BACKUP_ROOT"
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
    echo "ea_version=$(sed -n "s/.*\"version\": *\"\([^\"]*\)\".*/\1/p" "$EA_INSTALL_DIR/package.json" 2>/dev/null | head -1)"
    echo "config_sha256=$(sha256sum "$BROKER_CONFIG" | awk "{print \$1}")"
    echo "clients_sha256=$(sha256sum "$CLIENTS_FILE" | awk "{print \$1}")"
    [ -e "$STATE_FILE" ] && echo "state_sha256=$(sha256sum "$STATE_FILE" | awk "{print \$1}")"
    [ -e "$AUDIT_FILE" ] && echo "audit_sha256=$(sha256sum "$AUDIT_FILE" | awk "{print \$1}")"
    for unit in "$EA_SERVICE" "$BROKER_SERVICE" "$CRED_TIMER" "$CRED_SERVICE"; do
      echo "unit_${unit}=$(systemctl is-active "$unit" 2>/dev/null || true)/$(systemctl is-enabled "$unit" 2>/dev/null || true)"
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
  chmod 0600 "$BACKUP_DIR"/*
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
  log "broker code installed; config, clients, state and audit untouched"
}

verify_all() {
  local expected_disabled="$1"
  log "verify External Auth health (no restart)"
  ea_health | grep -Eq "\"ok\":true|\"status\":\"ok\"" || die "External Auth health failed"
  log "verify broker health"
  broker_health | tee "$BACKUP_DIR/broker-health.json" | grep -Eq "\"status\":\"ok\"" || die "broker health failed"
  log "verify broker admin status"
  wait_socket "$ADMIN_SOCKET" || die "admin socket not ready: $ADMIN_SOCKET"
  node "$BROKER_SRC_DIR/control.js" "$ADMIN_SOCKET" status > "$BACKUP_DIR/admin-status.json"
  grep -Eq "\"ok\":true" "$BACKUP_DIR/admin-status.json" || die "admin status not ok"
  if [ "$expected_disabled" = "true" ]; then
    [ -e "$KILL_SWITCH_FILE" ] || die "kill switch was preexisting but is now missing"
  else
    [ ! -e "$KILL_SWITCH_FILE" ] || die "kill switch remained engaged after successful deployment"
  fi
  log "verify clients registry and credential socket"
  grep -q "qms-broker-client-keys@2" "$CLIENTS_FILE" || die "clients registry schema missing"
  grep -q "keyId" "$CLIENTS_FILE" || die "clients registry has no keyId"
  wait_socket "$CRED_SOCKET" || die "credential socket not created by broker: $CRED_SOCKET"
  systemctl is-active --quiet "$CRED_TIMER" || die "credential renewal timer is not active"
  log "verification OK (no Ed25519 private key used on this host)"
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
  systemctl start "$BROKER_SERVICE" || true
  wait_http "$BROKER_HEALTH" || log "WARNING: broker health not ready after rollback"
  systemctl start "$CRED_TIMER" || true
  systemctl start "$CRED_SERVICE" || true
  log "rollback complete; kill switch remains engaged at $KILL_SWITCH_FILE"
  log "External Auth was not restarted; wallet and session state are untouched"
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

  deploy_broker

  log "starting broker first"
  systemctl start "$BROKER_SERVICE"
  wait_http "$BROKER_HEALTH" || die "broker health did not become ready"
  wait_socket "$CRED_SOCKET" || die "credential socket was not created by broker"

  if [ "$kill_preexisting" = "false" ]; then
    log "releasing deployment kill switch"
    rm -f "$KILL_SWITCH_FILE"
  else
    log "kill switch existed before deployment; leaving it engaged"
  fi

  log "starting credential renewal after broker"
  systemctl start "$CRED_TIMER"
  systemctl start "$CRED_SERVICE" || true

  verify_all "$kill_preexisting"
  trap - ERR
  log "DEPLOYMENT COMPLETE: atomic-fee broker fix active; no QDN transaction submitted"
  log "Operator next step: submit ONE new test publication and read back its status."
}

run_rollback() {
  require_root
  local source_dir="${2:-}"
  [ -n "$source_dir" ] && [ -d "$source_dir" ] || die "usage: $0 --rollback /var/backups/qms-phase5.2/<stamp>"
  rollback "$source_dir"
}

case "$MODE" in
  --check|--yes) run_deploy ;;
  --rollback) run_rollback "$@" ;;
  *) echo "usage: $0 --check | --yes | --rollback <backup-dir>"; exit 2 ;;
esac
