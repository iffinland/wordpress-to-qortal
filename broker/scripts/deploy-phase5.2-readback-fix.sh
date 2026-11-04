#!/usr/bin/env bash
# Phase 5.2 QDN read-back fix deployment.
#
# Installs only the corrected lib/engine/publication/remote.js module used by
# the installed broker, then restarts only the broker. External Auth, wallet,
# credentials, budget, config and infrastructure are untouched.
#
# Actual signing-VPS layout:
#   repo checkout:  /home/iffiolen/qms-broker-deploy
#   broker install: /opt/qms-qdn-test-broker
#   broker source:  /opt/qms-qdn-test-broker/broker/src
#   broker module:  resolved from broker/src/service.js import
#
# Usage:
#   sudo ./broker/scripts/deploy-phase5.2-readback-fix.sh --check
#   sudo ./broker/scripts/deploy-phase5.2-readback-fix.sh --yes
#   sudo ./broker/scripts/deploy-phase5.2-readback-fix.sh --rollback <backup-dir>
set -Eeuo pipefail
umask 077
export LC_ALL=C

REPO_DIR=${REPO_DIR:-/home/iffiolen/qms-broker-deploy}
BROKER_DIR=${BROKER_DIR:-/opt/qms-qdn-test-broker}
BROKER_SRC_DIR=${BROKER_SRC_DIR:-$BROKER_DIR/broker/src}
BROKER_SERVICE=${BROKER_SERVICE:-qms-qdn-test-broker}
BROKER_USER=${BROKER_USER:-qms-broker}
BROKER_HEALTH=${BROKER_HEALTH:-http://127.0.0.1:3199/v1/health}
BACKUP_ROOT=${BACKUP_ROOT:-/var/backups/qms-phase5.2}
MODE=${1:-}
ROLLBACK_DIR=${2:-}
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
BACKUP_DIR="$BACKUP_ROOT/readback-$STAMP"
SOURCE_REMOTE="$REPO_DIR/lib/engine/publication/remote.js"
INSTALLED_REMOTE=""

log() { printf "%s %s\n" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
die() { log "ERROR: $*"; exit 1; }

wait_health() {
  for _ in $(seq 1 30); do
    curl --silent --fail --max-time 2 "$BROKER_HEALTH" >/dev/null 2>&1 && return 0
    sleep 1
  done
  return 1
}

resolve_installed_module() {
  [ -f "$BROKER_SRC_DIR/service.js" ] || die "broker service source missing: $BROKER_SRC_DIR/service.js"
  local rel
  rel=$(grep -oF "../../lib/engine/publication/remote.js" "$BROKER_SRC_DIR/service.js" | head -1)
  [ -n "$rel" ] || die "broker service.js does not import lib/engine/publication/remote.js"
  INSTALLED_REMOTE=$(realpath -m "$BROKER_SRC_DIR/$rel")
  [ -f "$INSTALLED_REMOTE" ] || die "installed remote module missing: $INSTALLED_REMOTE"
}

preflight() {
  log "preflight: actual signing-VPS module paths"
  [ -d "$REPO_DIR" ] || die "repo checkout missing: $REPO_DIR"
  [ -f "$SOURCE_REMOTE" ] || die "corrected source module missing: $SOURCE_REMOTE"
  [ -d "$BROKER_SRC_DIR" ] || die "installed broker source missing: $BROKER_SRC_DIR"
  id "$BROKER_USER" >/dev/null 2>&1 || die "broker user missing: $BROKER_USER"
  systemctl cat "$BROKER_SERVICE" >/dev/null 2>&1 || die "broker unit missing: $BROKER_SERVICE"
  resolve_installed_module
  node --check "$SOURCE_REMOTE" || die "corrected module does not parse"
  node --check "$INSTALLED_REMOTE" || die "installed module does not parse"
  log "source module: $SOURCE_REMOTE"
  log "installed module: $INSTALLED_REMOTE"
  log "preflight OK"
}

deploy() {
  mkdir -p "$BACKUP_DIR"
  chmod 0700 "$BACKUP_DIR"
  cp -a "$INSTALLED_REMOTE" "$BACKUP_DIR/remote.js"
  chmod 0600 "$BACKUP_DIR/remote.js"
  sha256sum "$INSTALLED_REMOTE" "$SOURCE_REMOTE" >"$BACKUP_DIR/sha256.txt"
  install -m 0640 -o root -g "$BROKER_USER" "$SOURCE_REMOTE" "$INSTALLED_REMOTE"
  node --check "$INSTALLED_REMOTE" || die "installed module does not parse"
  cmp -s "$SOURCE_REMOTE" "$INSTALLED_REMOTE" || die "installed module does not match the corrected source"
  log "module installed; restarting broker only"
  systemctl restart "$BROKER_SERVICE"
  wait_health || die "broker health did not become ready"
  log "broker health OK; External Auth and wallet were not restarted"
  log "read-only verification command (run on the development VPS):"
  log "node broker/scripts/verify-existing-publication.js --publication pub_602a5fbbbb927367b05343ff"
}

rollback() {
  [ -n "$ROLLBACK_DIR" ] && [ -d "$ROLLBACK_DIR" ] || die "rollback directory missing"
  [ -f "$ROLLBACK_DIR/remote.js" ] || die "rollback module missing"
  install -m 0640 -o root -g "$BROKER_USER" "$ROLLBACK_DIR/remote.js" "$INSTALLED_REMOTE"
  systemctl restart "$BROKER_SERVICE"
  wait_health || log "WARNING: broker health not ready after rollback"
  log "rollback complete; broker restarted, External Auth untouched"
}

case "$MODE" in
  --check) preflight; log "check-only mode: no changes made" ;;
  --yes)
    [ "$(id -u)" -eq 0 ] || die "run as root for --yes"
    preflight
    deploy
    ;;
  --rollback)
    [ "$(id -u)" -eq 0 ] || die "run as root for --rollback"
    BROKER_HEALTH="$BROKER_HEALTH" BROKER_SERVICE="$BROKER_SERVICE" BROKER_USER="$BROKER_USER" BROKER_SRC_DIR="$BROKER_SRC_DIR" REPO_DIR="$REPO_DIR" resolve_installed_module
    rollback
    ;;
  *) echo "usage: $0 --check | --yes | --rollback <backup-dir>" >&2; exit 2 ;;
esac
