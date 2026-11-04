import { BrowserWindow, app } from 'electron';
import path from 'node:path';
import { EngineHost, resolveHostPaths } from './host.js';
import { CredentialStore } from './credentials.js';
import { defaultDataRoot, loadConfig, saveConfig, validateDataRoot, desktopSettings } from './paths.js';
import { createMainWindow, installSessionPolicy, isTrustedNavigation } from './window.js';
import { forwardEngineEvent, registerIpc } from './ipc.js';

const smokeTest = process.argv.includes('--qms-smoke-test') || process.env.QMS_SMOKE_TEST === '1';
const devArg = process.argv.find((arg) => arg.startsWith('--dev-server='));
if (devArg) process.env.QMS_DEV_SERVER = devArg.slice('--dev-server='.length);

let mainWindow: BrowserWindow | null = null;
let host: EngineHost | null = null;
let currentConfig = { schema: 'qms-desktop-config@1' as const, dataRoot: defaultDataRoot(), updatedAt: '' };
let keyringStatus = { available: false, backend: 'session-memory' };
const credentials = new CredentialStore();
let quitting = false;

function settingsPayload(): Record<string, unknown> {
  return desktopSettings(currentConfig, keyringStatus, {
    appVersion: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    packaged: app.isPackaged,
    keyring: { ...keyringStatus, persistentCredentials: keyringStatus.available }
  });
}

async function appInfo(): Promise<Record<string, unknown>> {
  if (!host) throw new Error('Engine host is not available.');
  const info = await host.request<Record<string, unknown>>('engine.info', {}, 15_000);
  return {
    ...info,
    desktopVersion: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node
  };
}

async function startHost(dataRoot: string): Promise<EngineHost> {
  const paths = resolveHostPaths(app.getAppPath(), app.isPackaged, process.resourcesPath, dataRoot, app.getAppPath());
  const instance = new EngineHost(paths);
  await instance.start();
  await instance.request('engine.info', {}, 20_000);
  return instance;
}

async function changeDataRoot(candidate: string): Promise<Record<string, unknown>> {
  const target = await validateDataRoot(candidate);
  if (host) {
    await host.restart(target);
  } else {
    host = await startHost(target);
  }
  currentConfig = { schema: 'qms-desktop-config@1', dataRoot: target, updatedAt: new Date().toISOString() };
  await saveConfig(currentConfig);
  return settingsPayload();
}

app.on('web-contents-created', (_event, contents) => {
  contents.on('will-navigate', (event, url) => {
    if (!isTrustedNavigation(url)) event.preventDefault();
  });
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
});

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    installSessionPolicy();
    currentConfig = await loadConfig();
    await credentials.initialize();
    keyringStatus = credentials.status();
    try {
      currentConfig.dataRoot = await validateDataRoot(currentConfig.dataRoot);
    } catch {
      currentConfig.dataRoot = await validateDataRoot(process.env.HOME + '/.local/share/qortal-migration-studio');
    }
    await saveConfig(currentConfig);
    host = await startHost(currentConfig.dataRoot);

    mainWindow = createMainWindow({ show: !smokeTest });
    mainWindow.on('closed', () => { mainWindow = null; });
    const unsubscribe = host.onEvent((event) => forwardEngineEvent(mainWindow, event));
    app.on('before-quit', () => unsubscribe());

    registerIpc({
      host,
      credentials,
      getWindow: () => mainWindow,
      getSettings: settingsPayload,
      setDataRoot: changeDataRoot,
      appInfo,
      dataRoot: () => currentConfig.dataRoot
    });

    if (smokeTest) {
      const timeout = setTimeout(() => {
        console.error('QMS_SMOKE_FAILED timeout');
        app.exit(1);
      }, 40_000);
      try {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('renderer load timed out')), 30_000);
          mainWindow!.webContents.once('did-finish-load', () => { clearTimeout(timer); resolve(); });
          mainWindow!.webContents.once('did-fail-load', (_event, code, description) => {
            clearTimeout(timer);
            reject(new Error('renderer failed to load: ' + code + ' ' + description));
          });
        });
        const info = await appInfo();
        const renderer = await mainWindow!.webContents.executeJavaScript(
          "JSON.stringify({ shell: Boolean(document.querySelector('[data-testid=\"app-shell\"]')), preload: typeof window.qms === 'object', title: document.title })"
        );
        const parsed = JSON.parse(renderer) as { shell: boolean; preload: boolean; title: string };
        if (!parsed.shell || !parsed.preload) throw new Error('renderer self-check failed: ' + renderer);
        console.log('QMS_SMOKE_OK version=' + String(info.version) + ' title=' + parsed.title);
        clearTimeout(timeout);
        await host?.stop().catch(() => {});
        app.exit(0);
      } catch (error) {
        clearTimeout(timeout);
        console.error('QMS_SMOKE_FAILED ' + (error instanceof Error ? error.message : String(error)));
        await host?.stop().catch(() => {});
        app.exit(1);
      }
    }
  }).catch((error) => {
    console.error('QMS_STARTUP_FAILED ' + (error instanceof Error ? error.stack : String(error)));
    if (smokeTest) app.exit(1);
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', async (event) => {
    if (quitting) return;
    event.preventDefault();
    quitting = true;
    credentials.clearAll();
    if (host) await host.stop().catch(() => {});
    app.quit();
  });
}

