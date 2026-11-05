import { app } from 'electron';
import { constants as fsConstants } from 'node:fs';
import { access, mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export interface DesktopConfig {
  schema: 'qms-desktop-config@1';
  dataRoot: string;
  updateNodeUrl?: string;
  updatedAt: string;
}

export function defaultDataRoot(): string {
  const xdg = process.env.XDG_DATA_HOME?.trim();
  const base = xdg && path.isAbsolute(xdg) ? xdg : path.join(os.homedir(), '.local', 'share');
  return path.join(base, 'qortal-migration-studio');
}

export function configFile(): string {
  return path.join(app.getPath('userData'), 'desktop-config.json');
}

export function exportsDir(dataRoot: string): string {
  return path.join(dataRoot, 'exports');
}

const FORBIDDEN_ROOTS = ['/usr', '/etc', '/opt', '/var', '/boot', '/proc', '/sys', '/dev', '/bin', '/sbin', '/lib'];

export async function validateDataRoot(candidate: string): Promise<string> {
  if (typeof candidate !== 'string' || candidate.trim() === '') {
    throw Object.assign(new Error('Workspace location is required.'), { code: 'DATA_ROOT_INVALID' });
  }
  if (candidate.includes('\u0000')) {
    throw Object.assign(new Error('Workspace location contains invalid characters.'), { code: 'DATA_ROOT_INVALID' });
  }
  const resolved = path.resolve(candidate.trim());
  if (!path.isAbsolute(resolved) || resolved === '/') {
    throw Object.assign(new Error('Workspace location must be an absolute directory.'), { code: 'DATA_ROOT_INVALID' });
  }
  const installRoot = path.resolve(app.getAppPath());
  if (resolved === installRoot || resolved.startsWith(installRoot + path.sep)) {
    throw Object.assign(new Error('Workspace location cannot be inside the application installation.'), { code: 'DATA_ROOT_INVALID' });
  }
  await mkdir(resolved, { recursive: true, mode: 0o700 });
  await access(resolved, fsConstants.W_OK);
  // Resolve symlinks after creation so a link inside the home directory cannot
  // redirect project data into a system path or the application installation.
  const resolvedReal = await realpath(resolved);
  if (resolvedReal === installRoot || resolvedReal.startsWith(installRoot + path.sep)) {
    throw Object.assign(new Error('Workspace location resolves inside the application installation.'), { code: 'DATA_ROOT_INVALID' });
  }
  for (const forbidden of FORBIDDEN_ROOTS) {
    if (resolvedReal === forbidden || resolvedReal.startsWith(forbidden + path.sep)) {
      throw Object.assign(new Error('Workspace location resolves to a system directory.'), { code: 'DATA_ROOT_INVALID' });
    }
  }
  return resolvedReal;
}

export async function loadConfig(): Promise<DesktopConfig> {
  const file = configFile();
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8'));
    if (parsed?.schema !== 'qms-desktop-config@1' || typeof parsed.dataRoot !== 'string') {
      throw new Error('invalid config');
    }
    const resolved = path.resolve(parsed.dataRoot);
    return {
      schema: 'qms-desktop-config@1',
      dataRoot: resolved,
      ...(typeof parsed.updateNodeUrl === 'string' && parsed.updateNodeUrl ? { updateNodeUrl: parsed.updateNodeUrl } : {}),
      updatedAt: String(parsed.updatedAt ?? '')
    };
  } catch {
    const dataRoot = defaultDataRoot();
    return { schema: 'qms-desktop-config@1', dataRoot, updatedAt: new Date().toISOString() };
  }
}

export async function saveConfig(config: DesktopConfig): Promise<void> {
  await mkdir(path.dirname(configFile()), { recursive: true, mode: 0o700 });
  const temporary = configFile() + '.tmp';
  await writeFile(temporary, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
  await rename(temporary, configFile());
}

export function desktopSettings(config: DesktopConfig, keyring: { available: boolean; backend: string }, extra: Record<string, unknown>) {
  return {
    dataRoot: config.dataRoot,
    updateNodeUrl: config.updateNodeUrl ?? null,
    configFile: configFile(),
    keyring: { ...keyring, persistentCredentials: keyring.available },
    ...extra
  };
}

