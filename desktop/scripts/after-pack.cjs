'use strict';
const path = require('node:path');
const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');

/**
 * Apply Electron fuses after packing.
 *
 * RunAsNode stays enabled because the engine host is spawned with
 * ELECTRON_RUN_AS_NODE=1. Node CLI inspect arguments and NODE_OPTIONS are
 * disabled, cookies are encrypted, and the app must load from app.asar.
 */
module.exports = async function afterPack(context) {
  const executableName = context.packager.config.linux?.executableName || 'qortal-migration-studio';
  const executable = path.join(context.appOutDir, executableName);
  await flipFuses(executable, {
    version: FuseVersion.V1,
    [FuseV1Options.RunAsNode]: true,
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    // Linux Electron 33 does not embed asar integrity metadata into the
    // executable; enabling this fuse makes the packaged renderer unloadable.
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: false,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
    [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: false,
    // Required for file:// loading of the packaged renderer from app.asar.
    [FuseV1Options.GrantFileProtocolExtraPrivileges]: true
  });
  console.log('electron fuses applied to ' + executable);
};
