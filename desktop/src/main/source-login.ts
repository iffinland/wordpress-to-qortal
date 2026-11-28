import { BrowserWindow, Menu, session } from 'electron';
import { randomUUID } from 'node:crypto';
import { sourceLoginOrigin, sessionFromCookies } from './source-login-policy.js';

const allowedOrigins = new Map<number, string>();
const windows = new Map<string, BrowserWindow>();
export function isSourceLoginNavigation(contentsId: number, target: string): boolean {
  try { return Boolean(allowedOrigins.get(contentsId)) && sourceLoginOrigin(target) === allowedOrigins.get(contentsId); } catch { return false; }
}
export async function openSourceLogin(projectId: string, baseUrl: string, parent: BrowserWindow | null): Promise<{ opened: boolean }> {
  const origin = sourceLoginOrigin(baseUrl);
  const existing = windows.get(projectId);
  if (existing && !existing.isDestroyed()) { existing.show(); existing.focus(); return { opened: true }; }
  const partition = 'qms-wordpress-' + randomUUID();
  const isolated = session.fromPartition(partition, { cache: false });
  isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  isolated.setPermissionCheckHandler(() => false);
  const window = new BrowserWindow({ width: 1050, height: 780, ...(parent ? { parent } : {}), autoHideMenuBar: false,
    title: 'WordPress sign-in - ' + new URL(baseUrl).hostname,
    webPreferences: { partition, contextIsolation: true, nodeIntegration: false, sandbox: true, webviewTag: false, safeDialogs: true } });
  const contentsId = window.webContents.id;
  windows.set(projectId, window); allowedOrigins.set(contentsId, origin);
  window.webContents.on('page-title-updated', event => event.preventDefault());
  const focusParent = () => { if (!window.isDestroyed()) window.hide(); parent?.show(); parent?.focus(); };
  window.setMenu(Menu.buildFromTemplate([
    { label: 'Back to QMS after signing in', click: focusParent },
    { label: 'Other login page', submenu: [{ label: 'Standard WordPress login', click: () => { const url = new URL(baseUrl); url.pathname = url.pathname.replace(/\/$/, '') + '/wp-login.php'; void window.loadURL(url.toString()).catch(() => {}); } }] },
    { label: 'Cancel login', click: () => window.close() }
  ]));
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-redirect', (event, target) => { if (!isSourceLoginNavigation(window.webContents.id, target)) event.preventDefault(); });
  window.on('closed', () => { allowedOrigins.delete(contentsId); windows.delete(projectId); void isolated.clearStorageData().catch(() => {}); focusParent(); });
  const url = new URL(baseUrl); url.search = ''; url.hash = ''; url.pathname = url.pathname.replace(/\/$/, '') + '/login/';
  try { await window.loadURL(url.toString()); }
  catch { window.close(); throw new Error('The WordPress login page could not be opened. Check the website address and connection.'); }
  return { opened: true };
}
export async function completeSourceLogin(projectId: string, baseUrl: string): Promise<Record<string, unknown>> {
  const window = windows.get(projectId);
  if (!window || window.isDestroyed()) throw new Error('Open the WordPress login window again and sign in.');
  if (allowedOrigins.get(window.webContents.id) !== sourceLoginOrigin(baseUrl)) throw new Error('The project address changed. Open a fresh login window for this website.');
  const auth = sessionFromCookies(baseUrl, await window.webContents.session.cookies.get({ url: baseUrl.replace(/\/$/, '') + '/' }));
  return auth;
}

export function closeSourceLogin(projectId: string): void { windows.get(projectId)?.close(); }
