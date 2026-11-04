#!/usr/bin/env bash
# Isolated Debian install test. Run inside a user + PID + mount namespace:
#   unshare -rmpf --mount-proc=<rootfs>/proc bash scripts/release/chroot-install.sh
# It never touches the host beyond the extracted rootfs and mounts inside the
# private namespace.
set -Eeuo pipefail

ROOT="${QMS_ROOTFS:?QMS_ROOTFS is required}"
DISTRO="${QMS_DISTRO:?QMS_DISTRO is required}"
DEB="${QMS_DEB:?QMS_DEB is required}"
SMOKE="${QMS_SMOKE_DIR:?QMS_SMOKE_DIR is required}"
PKG=qortal-migration-studio
INSTALL=/opt/$PKG
DATA_HOME=/home/qms/.local/share
DATA_ROOT=$DATA_HOME/$PKG
RESULT=$ROOT/tmp/qms-result.txt
CHROOT=/usr/sbin/chroot

step() { printf 'STEP_OK %s\n' "$1"; }
fail() { printf 'STEP_FAIL %s\n' "$1"; exit 1; }

mount -t tmpfs -o mode=755 tmpfs "$ROOT/dev"
for device in null zero full random urandom tty ptmx; do
  touch "$ROOT/dev/$device"
  mount --bind "/dev/$device" "$ROOT/dev/$device"
done
mkdir -p "$ROOT/dev/pts" "$ROOT/dev/shm"
mount -t tmpfs -o mode=1777 tmpfs "$ROOT/dev/shm"
mount -t devpts devpts "$ROOT/dev/pts" 2>/dev/null || true
cp /etc/resolv.conf "$ROOT/etc/resolv.conf"
mkdir -p "$ROOT/tmp/qms-smoke"
cp "$SMOKE/installedSmoke.mjs" "$ROOT/tmp/qms-smoke/installedSmoke.mjs"
cp "$SMOKE/fixtureServer.mjs" "$ROOT/tmp/qms-smoke/fixtureServer.mjs"
cp "$SMOKE/verifyData.mjs" "$ROOT/tmp/qms-smoke/verifyData.mjs"
cp "$DEB" "$ROOT/tmp/qms.deb"
step 'namespaces_and_devices_ready'

apt_get() {
  "$CHROOT" "$ROOT" env DEBIAN_FRONTEND=noninteractive apt-get -o APT::Sandbox::User=root "$@"
}

apt_get update -qq
step 'apt_index_updated'
apt_get install -y -qq --no-install-recommends xvfb xauth libsecret-tools procps >/tmp/qms-apt-test-deps.log 2>&1 || fail 'test_dependencies'
step 'test_dependencies_installed'

apt_get install -y --no-install-recommends /tmp/qms.deb >/tmp/qms-apt-install.log 2>&1 || { tail -40 /tmp/qms-apt-install.log; fail 'package_install'; }
step 'package_installed'

"$CHROOT" "$ROOT" dpkg-query -W -f='${Status} ${Version}\n' "$PKG" >/tmp/qms-dpkg-status.txt || fail 'dpkg_status'
grep -q 'install ok installed' /tmp/qms-dpkg-status.txt || fail 'package_not_configured'
test -x "$ROOT$INSTALL/$PKG" || fail 'missing_executable'
test -f "$ROOT/usr/share/applications/$PKG.desktop" || fail 'missing_desktop_entry'
test -L "$ROOT/usr/bin/$PKG" || fail 'missing_usr_bin_launcher'
test -f "$ROOT$INSTALL/resources/app.asar" || fail 'missing_app_asar'
test -f "$ROOT$INSTALL/resources/engine/bin/qms-host.js" || fail 'missing_engine'
test -f "$ROOT$INSTALL/resources/engine/templates/generic-cms/dist/index.html" || fail 'missing_template'
step 'package_layout_verified'

mkdir -p "$ROOT$DATA_HOME" "$ROOT/home/qms/.config"
export HOME=/home/qms
export XDG_DATA_HOME=$DATA_HOME
export XDG_CONFIG_HOME=/home/qms/.config
export DISPLAY=:99
export ELECTRON_DISABLE_SECURITY_WARNINGS=1

"$CHROOT" "$ROOT" sh -c "Xvfb :99 -screen 0 1366x900x24 -nolisten tcp -ac >/tmp/xvfb.log 2>&1 &"
for attempt in $(seq 1 50); do
  [ -S "$ROOT/tmp/.X11-unix/X99" ] && break
  sleep 0.2
done
[ -S "$ROOT/tmp/.X11-unix/X99" ] || { tail -20 "$ROOT/tmp/xvfb.log" 2>/dev/null; fail 'xvfb_start'; }
step 'xvfb_started'

"$CHROOT" "$ROOT" env HOME="$HOME" XDG_DATA_HOME="$XDG_DATA_HOME" XDG_CONFIG_HOME="$XDG_CONFIG_HOME" DISPLAY="$DISPLAY" \
  "$INSTALL/$PKG" --qms-smoke-test --no-sandbox --disable-gpu --disable-dev-shm-usage >/tmp/qms-gui-smoke.log 2>&1 || { tail -40 /tmp/qms-gui-smoke.log; fail 'gui_smoke'; }
grep -q 'QMS_SMOKE_OK' /tmp/qms-gui-smoke.log || fail 'gui_smoke_marker'
step 'electron_gui_smoke'

"$CHROOT" "$ROOT" env HOME="$HOME" XDG_DATA_HOME="$XDG_DATA_HOME" XDG_CONFIG_HOME="$XDG_CONFIG_HOME" ELECTRON_RUN_AS_NODE=1 \
  "$INSTALL/$PKG" /tmp/qms-smoke/installedSmoke.mjs --engine="$INSTALL/resources/engine" --data-root="$DATA_ROOT" --report=/tmp/qms-engine-smoke.json >/tmp/qms-engine-smoke.log 2>&1 || { tail -60 /tmp/qms-engine-smoke.log; fail 'engine_flows'; }
grep -q '"ok": true' "$ROOT/tmp/qms-engine-smoke.json" || { tail -40 /tmp/qms-engine-smoke.log; fail 'engine_flows_marker'; }
step 'engine_primary_flows'

test -d "$ROOT$DATA_ROOT/projects" || fail 'project_data_missing'
echo "$DISTRO installed" > "$ROOT$DATA_ROOT/UNINSTALL-PRESERVATION-MARKER"
step 'project_data_created'

# Best-effort keyring check. gnome-keyring/dbus cannot be configured under a
# single-UID user namespace (postinst chown to unmapped service groups fails), so
# a graphical keyring session is explicitly out of scope for this harness.
if "$CHROOT" "$ROOT" sh -c 'command -v secret-tool >/dev/null 2>&1'; then
  echo 'KEYRING_UNAVAILABLE libsecret-tools present, but no graphical keyring session can be created in this single-UID namespace' >> "$RESULT"
else
  echo 'KEYRING_UNAVAILABLE libsecret-tools not installed' >> "$RESULT"
fi

apt_get remove -y -qq "$PKG" >/tmp/qms-apt-remove.log 2>&1 || fail 'package_remove'
step 'package_removed'
test ! -e "$ROOT$INSTALL/$PKG" || fail 'files_removed'
test -f "$ROOT$DATA_ROOT/UNINSTALL-PRESERVATION-MARKER" || fail 'data_survived_removal'
step 'project_data_survived_removal'

apt_get install -y --no-install-recommends /tmp/qms.deb >/tmp/qms-apt-reinstall.log 2>&1 || fail 'package_reinstall'
test -f "$ROOT$DATA_ROOT/UNINSTALL-PRESERVATION-MARKER" || fail 'data_survived_reinstall'
step 'package_reinstalled'

apt_get install --reinstall -y --no-install-recommends /tmp/qms.deb >/tmp/qms-apt-upgrade.log 2>&1 || fail 'package_reinstall_same_version'
test -f "$ROOT$DATA_ROOT/UNINSTALL-PRESERVATION-MARKER" || fail 'data_survived_upgrade'
step 'same_version_reinstall_preserved_data'

"$CHROOT" "$ROOT" env HOME="$HOME" XDG_DATA_HOME="$XDG_DATA_HOME" ELECTRON_RUN_AS_NODE=1 \
  "$INSTALL/$PKG" /tmp/qms-smoke/verifyData.mjs --engine="$INSTALL/resources/engine" --data-root="$DATA_ROOT" >/tmp/qms-verify-data.log 2>&1 || { tail -20 /tmp/qms-verify-data.log; fail 'project_list_after_reinstall'; }
grep -q '"ok": true' /tmp/qms-verify-data.log || fail 'project_list_marker'
step 'existing_project_read_after_reinstall'

"$CHROOT" "$ROOT" pkill Xvfb 2>/dev/null || true

{
  echo "RESULT distro=$DISTRO"
  echo "RESULT status=pass"
  echo "RESULT installed_version=$(sed -n 's/^.* \([^ ]*\)$/\1/p' /tmp/qms-dpkg-status.txt)"
  echo "RESULT gui_smoke=$(grep -o 'QMS_SMOKE_OK.*' /tmp/qms-gui-smoke.log | head -1)"
  echo "RESULT engine_steps=$(grep -c 'SMOKE_STEP_OK' /tmp/qms-engine-smoke.log)"
  echo "RESULT data_root=$DATA_ROOT"
} >> "$RESULT"
echo 'STEP_OK all_install_gates'
