import { BrowserWindow, app, session, shell } from 'electron';
import path from 'node:path';

const DEV_SERVER = process.env.QMS_DEV_SERVER ?? null;

function contentSecurityPolicy(): string {
  const connect = DEV_SERVER ? "connect-src 'self' " + DEV_SERVER + ' ws://127.0.0.1:5173;' : "connect-src 'none';";
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'none'",
    connect
  ].join('; ');
}

export function installSessionPolicy(): void {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [contentSecurityPolicy()],
        'X-Content-Type-Options': ['nosniff']
      }
    });
  });
}

function isTrustedNavigation(target: string): boolean {
  if (DEV_SERVER) {
    return target.startsWith(DEV_SERVER);
  }
  try {
    const url = new URL(target);
    if (url.protocol !== 'file:') return false;
    const allowed = path.join(app.getAppPath(), 'dist');
    return decodeURIComponent(url.pathname).startsWith(allowed);
  } catch {
    return false;
  }
}

export function createMainWindow({ show = true }: { show?: boolean } = {}): BrowserWindow {
  const window = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    show,
    title: 'Qortal Migration Studio',
    backgroundColor: '#0b1620',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      spellcheck: false,
      devTools: !app.isPackaged
    }
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedNavigation(url)) event.preventDefault();
  });
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));

  if (DEV_SERVER) {
    void window.loadURL(DEV_SERVER);
  } else {
    void window.loadFile(path.join(app.getAppPath(), 'dist', 'index.html'));
  }
  return window;
}

export function trustedRendererUrl(url: string): boolean {
  if (!url) return false;
  if (DEV_SERVER) return url.startsWith(DEV_SERVER);
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'file:') return false;
    const allowed = path.join(app.getAppPath(), 'dist');
    return decodeURIComponent(parsed.pathname).startsWith(allowed);
  } catch {
    return false;
  }
}

