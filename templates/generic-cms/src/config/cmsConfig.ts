import type { CmsTemplateConfig } from '../types';
import { validateCmsConfig } from '../lib/config.js';
import { discoverQdnResource } from '../lib/qortal.js';

/** Build-time defaults embedded by Vite. */
export const baseCmsConfig: CmsTemplateConfig = __CMS_CONFIG__;
export const cmsConfig: CmsTemplateConfig = baseCmsConfig;
export const templateVersion: string = __CMS_TEMPLATE_VERSION__;

/**
 * The runtime config is generated per site and older Publisher builds omitted
 * the Admin entry. Keep the owner-gated admin route reachable for an already
 * published qms-cms-config.json by appending the entry when it is missing.
 */
export function ensureAdminNavigation(config: CmsTemplateConfig): CmsTemplateConfig {
  const hasAdmin = config.navigation.some((item) => {
    const href = String(item.href || '').replace(/\/+$/, '');
    return href === '#/admin';
  });
  if (hasAdmin) return config;
  return { ...config, navigation: [...config.navigation, { label: 'Admin', href: '#/admin' }] };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function merge(base: unknown, override: unknown): unknown {
  if (!isObject(base) || !isObject(override)) return override === undefined ? base : override;
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    out[key] = merge((base as Record<string, unknown>)[key], value);
  }
  return out;
}

export interface RuntimeCmsConfig {
  config: CmsTemplateConfig;
  source: 'runtime' | 'build';
  notice: string;
}

/**
 * A single built CMS bundle serves every migrated site. The Publisher writes
 * qms-cms-config.json at the application-bundle root, and this loader applies the site
 * title, tagline, navigation, theme and manifest identifier at runtime.
 */
function decodeBase64(value: string): string {
  const binary = atob(value.replace(/\s+/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new TextDecoder().decode(bytes);
}

async function readRuntimeJson(): Promise<unknown | null> {
  try {
    const response = await fetch('./qms-cms-config.json', { cache: 'no-store' });
    if (response.ok) return await response.json();
  } catch {
    // Fall through to the exact APP member read.
  }
  try {
    const { name, identifier } = discoverQdnResource(baseCmsConfig.admin.qdnName || '', 'default');
    if (!name) return null;
    const url = '/arbitrary/APP/' + encodeURIComponent(name) + '/' + encodeURIComponent(identifier)
      + '?filepath=qms-cms-config.json&encoding=base64';
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) return null;
    return JSON.parse(decodeBase64(await response.text()));
  } catch {
    return null;
  }
}

export async function loadRuntimeCmsConfig(): Promise<RuntimeCmsConfig> {
  try {
    const parsed = await readRuntimeJson();
    if (!parsed) return { config: baseCmsConfig, source: 'build', notice: '' };
    const merged = merge(baseCmsConfig, parsed);
    const validation = validateCmsConfig(merged);
    if (!validation.ok) {
      return { config: baseCmsConfig, source: 'build', notice: 'Runtime CMS configuration is invalid; using build defaults.' };
    }
    return { config: ensureAdminNavigation(merged as CmsTemplateConfig), source: 'runtime', notice: '' };
  } catch {
    return { config: baseCmsConfig, source: 'build', notice: 'Runtime CMS configuration is unavailable; using build defaults.' };
  }
}
