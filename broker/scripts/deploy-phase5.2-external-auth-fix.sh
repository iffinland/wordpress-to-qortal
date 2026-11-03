#!/usr/bin/env bash
# Phase 5.2 External Auth publishing fix - idempotent signing-VPS procedure.
#
# Deploys exactly two changes:
#   1. broker: fee is sent to External Auth as an atomic integer (Core Long),
#      and signing failures persist a bounded status/code diagnostic.
#   2. External Auth 0.2.0: encode QDN path segments once and reject a
#      fractional QORT fee instead of forwarding it to Core.
#
# Safety: no QDN transaction is submitted, no wallet material or token is
# printed or copied, no public port is opened, and every step is re-runnable.
#
# Usage (on the signing VPS, as root):
#   ./deploy-phase5.2-external-auth-fix.sh --check
#   ./deploy-phase5.2-external-auth-fix.sh --yes
#   ./deploy-phase5.2-external-auth-fix.sh --rollback /var/backups/qms-phase5.2/<stamp>
#
set -Eeuo pipefail
umask 077
export LC_ALL=C

REPO_DIR=${REPO_DIR:-/opt/wordpress-to-qortal}
EA_REPO_DIR=${EA_REPO_DIR:-/opt/qortal-external-auth}
EA_PINNED_COMMIT=${EA_PINNED_COMMIT:-7e5d498221cf15ccbc01e7241efbcd0c6e76d09c}
BROKER_DIR=${BROKER_DIR:-/opt/qms-qdn-test-broker}
BROKER_CONFIG=${BROKER_CONFIG:-/etc/qms-qdn-test-broker/config.json}
STATE_FILE=${STATE_FILE:-/var/lib/qms-qdn-test-broker/state.json}
AUDIT_FILE=${AUDIT_FILE:-/var/lib/qms-qdn-test-broker/audit.jsonl}
KILL_SWITCH_FILE=${KILL_SWITCH_FILE:-/var/lib/qms-qdn-test-broker/DISABLED}
BACKUP_ROOT=${BACKUP_ROOT:-/var/backups/qms-phase5.2}
EA_SERVICE=${EA_SERVICE:-qortal-external-auth}
BROKER_SERVICE=${BROKER_SERVICE:-qms-qdn-test-broker}
CRED_TIMER=${CRED_TIMER:-qms-auth-credential.timer}
CRED_SERVICE=${CRED_SERVICE:-qms-auth-credential.service}
BROKER_USER=${BROKER_USER:-qms-broker}
EA_HEALTH=${EA_HEALTH:-http://127.0.0.1:3191/health}
BROKER_HEALTH=${BROKER_HEALTH:-http://127.0.0.1:3199/v1/health}
VERIFY_KEY_FILE=${VERIFY_KEY_FILE:-/home/qms-maint/.config/qms-broker/deploy-verify.key}
VERIFY_KEY_ID=${VERIFY_KEY_ID:-agent-main-2026-11}
PATCH_FILE="$REPO_DIR/patches/qortal-external-auth-0.2.0-qdn-publish.patch"
MODE=${1:-}
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
BACKUP_DIR="$BACKUP_ROOT/$STAMP"

log()  { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
die()  { log "ERROR: $*"; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "missing required command: $1"; }

require_root() { [ "$(id -u)" -eq 0 ] || die "run as root"; }

preflight() {
  log "preflight: repository and pinned External Auth source"
  [ -d "$REPO_DIR" ] || die "REPO_DIR not found: $REPO_DIR"
  [ -f "$PATCH_FILE" ] || die "patch not found: $PATCH_FILE"
  [ -d "$EA_REPO_DIR/.git" ] || die "External Auth git checkout not found: $EA_REPO_DIR"
  local ea_head
  ea_head=$(git -C "$EA_REPO_DIR" rev-parse HEAD)
  [ "$ea_head" = "$EA_PINNED_COMMIT" ] || die "External Auth HEAD $ea_head is not the pinned $EA_PINNED_COMMIT"
  git -C "$EA_REPO_DIR" apply --check "$PATCH_FILE" 2>/dev/null || \
    git -C "$EA_REPO_DIR" apply --reverse --check "$PATCH_FILE" 2>/dev/null || \
    die "patch neither applies nor is already applied; refusing to guess"

  log "preflight: services, files and permissions"
  for unit in "$EA_SERVICE" "$BROKER_SERVICE" "$CRED_TIMER" "$CRED_SERVICE"; do
    systemctl cat "$unit" >/dev/null 2>&1 || die "systemd unit not found: $unit"
  done
  [ -f "$BROKER_CONFIG" ] || die "broker config not found: $BROKER_CONFIG"
  [ -d "$(dirname "$STATE_FILE")" ] || die "state directory not found: $(dirname "$STATE_FILE")"
  local mode
  mode=$((8#$(stat -c '%a' "$BROKER_CONFIG")))
  (( (mode & 0007) == 0 )) || die "broker config is group/world readable: mode $(stat -c '%a' "$BROKER_CONFIG")"
  mode=$((8#$(stat -c '%a' "$(dirname "$STATE_FILE")")))
  (( (mode & 0007) == 0 )) || die "state directory is group/world accessible: mode $(stat -c '%a' "$(dirname "$STATE_FILE")")"
  if [ -e "$STATE_FILE" ]; then
    mode=$((8#$(stat -c '%a' "$STATE_FILE")))
    (( (mode & 0007) == 0 )) || die "state file is group/world readable: mode $(stat -c '%a' "$STATE_FILE")"
  fi

  log "preflight: no public broker or Tailscale Serve port"
  if ss -H -ltn 2>/dev/null | awk '{print $4}' | grep -Eq '^(0\.0\.0\.0|\[::\]|\*):(8443|3199)$'; then
    die "8443 or 3199 is bound to a wildcard address; refusing to deploy"
  fi

  log "preflight: disk space"
  local avail_kb probe="$BACKUP_ROOT"
  [ -d "$probe" ] || probe="$(dirname "$BACKUP_ROOT")"
  avail_kb=$(df -Pk "$probe" 2>/dev/null | awk 'NR==2 {print $4}' || true)
  [ -n "$avail_kb" ] && [ "$avail_kb" -gt 2097152 ] || die "need at least 2 GiB free under $BACKUP_ROOT"
  log "preflight OK"
}

capture_state() {
  mkdir -p "$BACKUP_DIR"; chmod 0700 "$BACKUP_DIR"
  log "capturing current state to $BACKUP_DIR"
  {
    echo "stamp=$STAMP"
    echo "host=$(hostname)"
    echo "ea_head=$(git -C "$EA_REPO_DIR" rev-parse HEAD)"
    echo "ea_status_porcelain:"
    git -C "$EA_REPO_DIR" status --porcelain || true
    echo "config_sha256=$(sha256sum "$BROKER_CONFIG" | awk '{print $1}')"
    [ -e "$STATE_FILE" ] && echo "state_sha256=$(sha256sum "$STATE_FILE" | awk '{print $1}')"
    [ -e "$AUDIT_FILE" ] && echo "audit_sha256=$(sha256sum "$AUDIT_FILE" | awk '{print $1}')"
    [ -e "$KILL_SWITCH_FILE" ] && echo "kill_switch_preexisting=true" || echo "kill_switch_preexisting=false"
    for unit in "$EA_SERVICE" "$BROKER_SERVICE" "$CRED_TIMER" "$CRED_SERVICE"; do
      echo "unit_${unit}=$(systemctl is-active "$unit" 2>/dev/null || true)/$(systemctl is-enabled "$unit" 2>/dev/null || true)"
    done
  } >"$BACKUP_DIR/current-state.txt"
  chmod 0600 "$BACKUP_DIR/current-state.txt"
  systemctl status "$EA_SERVICE" --no-pager -n 20 >"$BACKUP_DIR/ea-status.txt" 2>&1 || true
  systemctl status "$BROKER_SERVICE" --no-pager -n 20 >"$BACKUP_DIR/broker-status.txt" 2>&1 || true
  tar -C "$EA_REPO_DIR" -czf "$BACKUP_DIR/external-auth-source.tar.gz" packages/auth-daemon/src/index.ts
  if [ -d "$BROKER_DIR/src" ]; then
    tar -C "$BROKER_DIR" -czf "$BACKUP_DIR/broker-src.tar.gz" src scripts 2>/dev/null || \
      tar -C "$BROKER_DIR" -czf "$BACKUP_DIR/broker-src.tar.gz" src
  fi
  cp -a "$BROKER_CONFIG" "$BACKUP_DIR/broker-config.json"
  [ -e "$STATE_FILE" ] && cp -a "$STATE_FILE" "$BACKUP_DIR/state.json"
  [ -e "$AUDIT_FILE" ] && cp -a "$AUDIT_FILE" "$BACKUP_DIR/audit.jsonl"
  chmod 0600 "$BACKUP_DIR"/*
  log "backup complete"
}

apply_ea_patch() {
  if git -C "$EA_REPO_DIR" apply --reverse --check "$PATCH_FILE" 2>/dev/null; then
    log "External Auth patch already applied; rebuilding to refresh dist"
  else
    git -C "$EA_REPO_DIR" apply --check "$PATCH_FILE"
    git -C "$EA_REPO_DIR" apply "$PATCH_FILE"
    log "External Auth patch applied"
  fi
  if [ -d "$EA_REPO_DIR/node_modules" ]; then
    npm --prefix "$EA_REPO_DIR" run build
  else
    die "EA node_modules missing; run npm ci in $EA_REPO_DIR first (build is required)"
  fi
}

deploy_broker() {
  log "deploying broker sources (config and state untouched)"
  [ -d "$BROKER_DIR/src" ] || die "broker install not found: $BROKER_DIR/src"
  [ -d "$REPO_DIR/broker/src" ] || die "repository broker sources not found"
  for file in $(cd "$REPO_DIR" && find broker/src broker/scripts -type f -name '*.js'); do
    node --check "$REPO_DIR/$file"
  done
  mkdir -p "$BROKER_DIR/src" "$BROKER_DIR/scripts"
  cp -a "$REPO_DIR/broker/src/." "$BROKER_DIR/src/"
  cp -a "$REPO_DIR/broker/scripts/." "$BROKER_DIR/scripts/"
  chown -R root:"$BROKER_USER" "$BROKER_DIR/src" "$BROKER_DIR/scripts"
  find "$BROKER_DIR/src" "$BROKER_DIR/scripts" -type f -exec chmod 0640 {} +
  chmod 0750 "$BROKER_DIR/src" "$BROKER_DIR/scripts"
  log "broker sources deployed"
}

budget_snapshot() {
  node -e '
    const fs = require("fs");
    const s = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const c = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
    console.log(JSON.stringify({
      spentAtomic: s.budget?.spentAtomic ?? null,
      budgetAtomic: c.policy?.budgetAtomic ?? null,
      reservations: Object.keys(s.budget?.reservations ?? {}).length,
      disabledState: s.disabled === true
    }));
  ' "$STATE_FILE" "$BROKER_CONFIG"
}

wait_http() {
  local url="$1" attempts=30
  for _ in $(seq 1 "$attempts"); do
    if curl --silent --fail --max-time 2 "$url" >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  return 1
}

verify_all() {
  log "verifying External Auth health"
  curl --silent --fail --max-time 3 "$EA_HEALTH" | grep -q '"status":"ok"' || die "External Auth health failed"

  log "verifying broker health"
  curl --silent --fail --max-time 3 "$BROKER_HEALTH" >"$BACKUP_DIR/broker-health.json"
  node -e 'const h=require(process.argv[1]); if(h.status!=="ok") process.exit(1)' "$BACKUP_DIR/broker-health.json" \
    || die "broker health is not ok"

  log "verifying budget state (read-only)"
  budget_snapshot | tee "$BACKUP_DIR/budget.json"
  node -e '
    const b = require(process.argv[1]);
    if (!Number.isSafeInteger(b.budgetAtomic) || b.budgetAtomic <= 0) process.exit(1);
    if (!Number.isSafeInteger(b.spentAtomic) || b.spentAtomic > b.budgetAtomic) process.exit(1);
  ' "$BACKUP_DIR/budget.json" || die "budget state is invalid or exhausted"

  log "verifying Ed25519 agent authentication (no publication)"
  [ -f "$VERIFY_KEY_FILE" ] || die "verification key not found: $VERIFY_KEY_FILE"
  node "$BROKER_DIR/scripts/operator-verify.js" \
    --base-url "${BROKER_HEALTH%/v1/health}" \
    --key-id "$VERIFY_KEY_ID" \
    --key-file "$VERIFY_KEY_FILE"
}

rollback() {
  local source_dir="$1"
  log "ROLLBACK from $source_dir"
  touch "$KILL_SWITCH_FILE"
  systemctl stop "$BROKER_SERVICE" || true
  systemctl stop "$CRED_TIMER" "$CRED_SERVICE" || true
  if [ -f "$source_dir/external-auth-source.tar.gz" ]; then
    tar -C "$EA_REPO_DIR" -xzf "$source_dir/external-auth-source.tar.gz"
    log "External Auth source restored"
  fi
  if [ -f "$source_dir/broker-src.tar.gz" ]; then
    tar -C "$BROKER_DIR" -xzf "$source_dir/broker-src.tar.gz"
    log "broker sources restored"
  fi
  [ -f "$source_dir/broker-config.json" ] && cp -a "$source_dir/broker-config.json" "$BROKER_CONFIG"
  [ -f "$source_dir/state.json" ] && cp -a "$source_dir/state.json" "$STATE_FILE"
  [ -f "$source_dir/audit.jsonl" ] && cp -a "$source_dir/audit.jsonl" "$AUDIT_FILE"
  if [ -d "$EA_REPO_DIR/node_modules" ]; then
    npm --prefix "$EA_REPO_DIR" run build || log "WARNING: External Auth rebuild failed during rollback"
  fi
  systemctl start "$EA_SERVICE" || true
  systemctl start "$CRED_TIMER" || true
  systemctl start "$CRED_SERVICE" || true
  systemctl start "$BROKER_SERVICE" || true
  log "rollback services restarted; kill switch remains at $KILL_SWITCH_FILE"
  log "ROLLBACK complete; inspect $source_dir and journalctl before retrying"
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
  require_root
  preflight
  if [ "$MODE" = "--check" ]; then
    log "check-only mode: no changes made"
    exit 0
  fi
  [ "$MODE" = "--yes" ] || die "refusing to change the signing VPS without --yes (or use --check)"
  trap on_error ERR

  capture_state
  local kill_preexisting=false
  [ -e "$KILL_SWITCH_FILE" ] && kill_preexisting=true
  log "engaging kill switch"
  touch "$KILL_SWITCH_FILE"
  chown root:"$BROKER_USER" "$KILL_SWITCH_FILE" 2>/dev/null || true
  chmod 0640 "$KILL_SWITCH_FILE"

  log "stopping broker, then credential renewal"
  systemctl stop "$BROKER_SERVICE"
  systemctl stop "$CRED_TIMER" "$CRED_SERVICE" || true

  apply_ea_patch
  systemctl restart "$EA_SERVICE"
  wait_http "$EA_HEALTH" || die "External Auth did not become healthy"

  deploy_broker
  systemctl start "$CRED_TIMER"
  systemctl start "$CRED_SERVICE" || true
  systemctl start "$BROKER_SERVICE"
  wait_http "$BROKER_HEALTH" || die "broker did not become healthy"

  if [ "$kill_preexisting" = "false" ]; then
    log "releasing deployment kill switch"
    rm -f "$KILL_SWITCH_FILE"
  else
    log "kill switch existed before deployment; leaving it engaged"
  fi

  verify_all
  trap - ERR
  log "DEPLOYMENT COMPLETE: fix active; no QDN transaction submitted"
  log "Operator next step: submit ONE new test publication and read back the diagnostic/status."
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
