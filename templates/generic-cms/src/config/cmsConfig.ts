import type { CmsTemplateConfig } from '../types';
import { validateCmsConfig } from '../lib/config.js';
import { discoverHostedQdnName, discoverHostedQdnResource, safeDecodeQdnName } from '../lib/qortal.js';
import { discoverSiteContent, bindDiscoveredContent } from '../lib/contentDiscovery.js';
import { removeTemplatePlaceholders } from '../lib/settings.js';

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
  discovery?: any;
}

function configUnavailableForHostedSite(notice: string): RuntimeCmsConfig {
  // The build config intentionally contains a generic fixture manifest so the
  // template can be developed in isolation. It is never a safe catalog choice
  // for a hosted per-site CMS: using it would make a missing deployment config
  // look like a QDN catalog 404. Clear both identifiers before constructing the
  // repository so it cannot read another project's defaults or cache.
  return {
    config: {
      ...baseCmsConfig,
      content: {
        ...baseCmsConfig.content,
        manifestIdentifier: '',
        legacyManifestIdentifier: ''
      }
    },
    source: 'build',
    notice
  };
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

function sameName(left: string, right: string): boolean {
  return safeDecodeQdnName(left).replace(/\s+/g, ' ').toLowerCase()
    === safeDecodeQdnName(right).replace(/\s+/g, ' ').toLowerCase();
}

/** A runtime config is usable only when it explicitly belongs to this host. */
export function runtimeConfigMatchesHosting(config: CmsTemplateConfig, hosting: { name: string; service: string; identifier: string }): boolean {
  if (!hosting.name || !sameName(config.site.ownerName, hosting.name) || !sameName(config.admin.qdnName, hosting.name)) return false;
  if (!config.deployment) return true; // Legacy bundles can be read, but cache binding remains host-scoped.
  // The owner can publish the same presentation ZIP as APP or WEBSITE.
  // The explicit catalog identity stays fixed; hosting coordinates are rebound below.
  return sameName(config.deployment.name, hosting.name);
}

async function readRuntimeJson(): Promise<unknown | null> {
  try {
    const response = await fetch('./qms-cms-config.json', { cache: 'no-store' });
    if (response.ok) return await response.json();
  } catch {
    // Fall through to the exact APP member read.
  }
  try {
    const hosted = discoverHostedQdnResource({
      name: baseCmsConfig.deployment?.name || baseCmsConfig.admin.qdnName || '',
      service: baseCmsConfig.deployment?.service || 'APP',
      identifier: baseCmsConfig.deployment?.identifier || 'default'
    });
    if (!hosted.name) return null;
    const url = '/arbitrary/' + encodeURIComponent(hosted.service) + '/' + encodeURIComponent(hosted.name) + '/' + encodeURIComponent(hosted.identifier)
      + '?filepath=qms-cms-config.json&encoding=base64';
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) return null;
    return JSON.parse(decodeBase64(await response.text()));
  } catch {
    return null;
  }
}

function configForDiscoveredContent(
  hosting: { name: string; service: string; identifier: string },
  discovery: any
): RuntimeCmsConfig {
  const config = bindDiscoveredContent(baseCmsConfig, hosting, discovery.selected) as CmsTemplateConfig;
  config.site = removeTemplatePlaceholders(config.site, hosting.name);
  return {
    config: ensureAdminNavigation(config),
    source: 'runtime',
    notice: discovery.status === 'connected' ? '' : discovery.message,
    discovery
  };
}

export async function loadRuntimeCmsConfig(): Promise<RuntimeCmsConfig> {
  try {
    const parsed = await readRuntimeJson();
    if (!parsed) {
      const hosting = discoverHostedQdnResource({ name: '', service: 'APP', identifier: 'default' });
      // A custom template may embed an explicit content identity. The runtime
      // presentation coordinates are derived from the host, not from APP-only defaults.
      const explicit = baseCmsConfig.site.id !== 'generic-site'
        && Boolean(baseCmsConfig.content.manifestIdentifier)
        && baseCmsConfig.content.manifestIdentifier !== 'qms-cms-manifest'
        && sameName(baseCmsConfig.site.ownerName, hosting.name)
        && sameName(baseCmsConfig.admin.qdnName, hosting.name);
      if (explicit) return {
        config: ensureAdminNavigation({
          ...baseCmsConfig,
          deployment: {
            name: hosting.name,
            service: hosting.service === 'WEBSITE' ? 'WEBSITE' : 'APP',
            identifier: hosting.identifier
          }
        }),
        source: 'build',
        notice: ''
      };
      const discovery = await discoverSiteContent(hosting);
      if (discovery.status === 'unavailable') {
        return {
          ...configUnavailableForHostedSite('The project-specific qms-cms-config.json is absent and the public content connection could not be resolved. ' + discovery.message),
          discovery
        };
      }
      return configForDiscoveredContent(hosting, discovery);
    }
    const merged = merge(baseCmsConfig, parsed) as CmsTemplateConfig;
    const hosting = discoverHostedQdnResource({
      name: merged.deployment?.name || merged.admin.qdnName || '',
      service: merged.deployment?.service || 'APP',
      identifier: merged.deployment?.identifier || 'default'
    });
    merged.site = removeTemplatePlaceholders(merged.site, hosting.name || discoverHostedQdnName(merged.admin.qdnName || ''));
    const validation = validateCmsConfig(merged);
    if (!validation.ok) {
      return configUnavailableForHostedSite('Runtime CMS configuration is invalid; generic catalog defaults were not loaded. ' + validation.errors.join(' '));
    }
    if (!runtimeConfigMatchesHosting(merged, hosting)) {
      return configUnavailableForHostedSite('Runtime CMS configuration does not belong to this QDN host; catalog cache and content are unavailable.');
    }
    merged.deployment = {
      name: hosting.name,
      service: hosting.service === 'WEBSITE' ? 'WEBSITE' : 'APP',
      identifier: hosting.identifier
    };
    return { config: ensureAdminNavigation(merged), source: 'runtime', notice: '' };
  } catch {
    return configUnavailableForHostedSite('Runtime CMS configuration is unavailable; generic catalog defaults were not loaded.');
  }
}
