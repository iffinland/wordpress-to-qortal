import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  createUpdateChecker,
  parseRegistryDocument,
  type UpdateChecker,
  type UpdateCheckerState
} from '../../../lib/update/registry.js';

export const REGISTRY_PATH = '/arbitrary/DOCUMENT/developer%20iffi/qms-update-registry';
export const DEFAULT_UPDATE_NODE = 'http://localhost:12391';
const CACHE_MAX_AGE_MS = 30 * 60 * 1000;
const CACHE_STALE_MS = 7 * 24 * 60 * 60 * 1000;

export function validateUpdateNodeUrl(value: string): string {
  const raw = String(value ?? '').trim();
  if (!raw) throw Object.assign(new Error('Update node URL is required.'), { code: 'UPDATE_NODE_INVALID' });
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw Object.assign(new Error('Update node URL is not valid.'), { code: 'UPDATE_NODE_INVALID' });
  }
  if (parsed.username || parsed.password) {
    throw Object.assign(new Error('Update node URL must not contain credentials.'), { code: 'UPDATE_NODE_INVALID' });
  }
  if (parsed.search || parsed.hash) {
    throw Object.assign(new Error('Update node URL must not contain a query or fragment.'), { code: 'UPDATE_NODE_INVALID' });
  }
  const loopback = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '::1' || parsed.hostname === '[::1]';
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback)) {
    throw Object.assign(new Error('Update node URL must use HTTPS, or HTTP only for a loopback node.'), { code: 'UPDATE_NODE_INVALID' });
  }
  return String(raw).replace(/\/+$/, '');
}

interface CacheFile {
  schema: 'qms-desktop-update-cache@1';
  checkedAt: number;
  document: unknown;
}

export interface DesktopUpdatesDeps {
  appVersion: string;
  userDataDir: string;
  nodeUrl?: string | null;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export class DesktopUpdates {
  private checker: UpdateChecker;
  private nodeUrl: string;
  private cachePath: string;
  private deps: DesktopUpdatesDeps;
  private current: UpdateCheckerState;
  private ready: Promise<UpdateCheckerState> | null = null;

  constructor(deps: DesktopUpdatesDeps) {
    this.deps = deps;
    this.nodeUrl = validateUpdateNodeUrl(deps.nodeUrl || process.env.QMS_UPDATE_NODE_URL || DEFAULT_UPDATE_NODE);
    this.cachePath = path.join(deps.userDataDir, 'update-cache.json');
    this.checker = this.buildChecker();
    this.current = this.checker.getState();
  }

  private buildChecker(): UpdateChecker {
    return createUpdateChecker({
      componentId: 'desktop',
      installedVersion: this.deps.appVersion,
      platform: 'linux-x64',
      dependencies: {},
      fetchRegistry: async () => {
        const fetchImpl = this.deps.fetchImpl ?? fetch;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 9000);
        try {
          const response = await fetchImpl(this.nodeUrl + REGISTRY_PATH, {
            signal: controller.signal,
            redirect: 'follow',
            cache: 'no-store',
            headers: { accept: 'application/json' }
          });
          if (response.status === 404) throw new Error('The update registry has not been published yet.');
          if (!response.ok) throw new Error('Registry request failed with HTTP ' + response.status + '.');
          return await response.text();
        } finally {
          clearTimeout(timer);
        }
      },
      timeoutMs: 10000,
      retries: 2,
      cacheMs: CACHE_MAX_AGE_MS,
      staleMs: CACHE_STALE_MS,
      now: this.deps.now
    });
  }

  get state(): UpdateCheckerState {
    return this.current;
  }

  private async readCache(): Promise<CacheFile | null> {
    try {
      const parsed = JSON.parse(await readFile(this.cachePath, 'utf8')) as CacheFile;
      if (parsed?.schema !== 'qms-desktop-update-cache@1' || !Number.isFinite(parsed.checkedAt)) return null;
      if (!parseRegistryDocument(parsed.document).ok) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  private async writeCache(state: UpdateCheckerState): Promise<void> {
    if (state.stale || !state.checkedAt || (state.status !== 'update_available' && state.status !== 'up_to_date')) return;
    const raw = this.checker.getDocument();
    if (!raw) return;
    try {
      await mkdir(path.dirname(this.cachePath), { recursive: true });
      await writeFile(this.cachePath, JSON.stringify({
        schema: 'qms-desktop-update-cache@1',
        checkedAt: state.checkedAt,
        document: raw
      }, null, 2) + '\n', { mode: 0o600 });
    } catch {
      // A cache write failure must never block startup or the UI.
    }
  }

  private async cachedState(forceReason: string): Promise<UpdateCheckerState | null> {
    const cache = await this.readCache();
    if (!cache) return null;
    const age = (this.deps.now?.() ?? Date.now()) - cache.checkedAt;
    if (age > CACHE_STALE_MS) return null;
    if (!this.checker.assessCached(cache.document, cache.checkedAt, true)) return null;
    this.current = { ...this.checker.getState(), reason: forceReason, networkError: forceReason };
    return this.current;
  }

  start(): Promise<UpdateCheckerState> {
    if (!this.ready) this.ready = this.startInternal();
    return this.ready;
  }

  private async startInternal(): Promise<UpdateCheckerState> {
    const cache = await this.readCache();
    const now = this.deps.now?.() ?? Date.now();
    if (cache && now - cache.checkedAt < CACHE_MAX_AGE_MS) {
      if (this.checker.assessCached(cache.document, cache.checkedAt, false)) {
        this.current = this.checker.getState();
        return this.current;
      }
    }
    return this.check(false);
  }

  async check(force = true): Promise<UpdateCheckerState> {
    if (force) {
      // Force bypasses the in-memory short circuit.
      this.current = await this.checker.check(true);
    } else {
      this.current = await this.checker.check(false);
    }
    if (this.current.status === 'unable_to_check') {
      const cached = await this.cachedState(this.current.reason);
      if (cached) {
        this.current = cached;
        return this.current;
      }
    }
    await this.writeCache(this.current);
    return this.current;
  }

  async setNodeUrl(value: string): Promise<UpdateCheckerState> {
    this.nodeUrl = validateUpdateNodeUrl(value);
    this.checker = this.buildChecker();
    this.current = this.checker.getState();
    return this.check(true);
  }
}
