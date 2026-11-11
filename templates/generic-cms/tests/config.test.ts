import { afterEach, describe, expect, it, vi } from 'vitest';
import { cmsConfig, ensureAdminNavigation, loadRuntimeCmsConfig, runtimeConfigMatchesHosting } from '../src/config/cmsConfig';
import { validateCmsConfig } from '../src/lib/config.js';
import type { CmsTemplateConfig } from '../src/types';

const telegramConfig: CmsTemplateConfig = {
  ...cmsConfig,
  deployment: { service: 'APP', name: 'Telegram.EE', identifier: 'default' },
  site: { ...cmsConfig.site, id: 'telegram-site', title: 'Telegram Eesti', tagline: 'Independent Telegram reporting', ownerName: 'Telegram.EE' },
  admin: { ...cmsConfig.admin, qdnName: 'Telegram.EE' },
  content: { ...cmsConfig.content, manifestIdentifier: 'qms-telegram-manifest', legacyManifestIdentifier: 'legacy-telegram' }
};

afterEach(() => {
  vi.unstubAllGlobals();
  delete (window as any)._qdnName;
  delete (window as any)._qdnService;
  delete (window as any)._qdnIdentifier;
  delete (window as any)._qdnResource;
});

describe('runtime CMS navigation', () => {
  it('appends the admin route when a published runtime config omits it', () => {
    const runtime: CmsTemplateConfig = {
      ...cmsConfig,
      navigation: [
        { label: 'Home', href: '#/' },
        { label: 'Journal', href: '#/posts' }
      ]
    };
    const normalized = ensureAdminNavigation(runtime);
    expect(normalized.navigation.map((item) => item.href)).toEqual(['#/', '#/posts', '#/admin']);
    expect(normalized.navigation.filter((item) => item.href === '#/admin')).toHaveLength(1);
  });

  it('keeps an existing admin route without duplicating it', () => {
    const normalized = ensureAdminNavigation({
      ...cmsConfig,
      navigation: [{ label: 'Home', href: '#/' }, { label: 'Admin', href: '#/admin/' }]
    });
    expect(normalized.navigation.filter((item) => item.href.replace(/\/+$/, '') === '#/admin')).toHaveLength(1);
  });

  it('rejects a runtime CMS config whose QDN deployment identity differs from the host', () => {
    const config: CmsTemplateConfig = {
      ...cmsConfig,
      site: { ...cmsConfig.site, ownerName: 'developer iffi' },
      admin: { ...cmsConfig.admin, qdnName: 'developer iffi' },
      deployment: { service: 'APP', name: 'developer iffi', identifier: 'qms-site' }
    };
    expect(runtimeConfigMatchesHosting(config, { name: 'NASA-Official', service: 'APP', identifier: 'qms-site' })).toBe(false);
    expect(runtimeConfigMatchesHosting(config, { name: 'developer iffi', service: 'APP', identifier: 'qms-site' })).toBe(true);
  });

  it('loads the project manifest from the canonical no-identifier APP route', async () => {
    Object.assign(window as any, {
      _qdnName: 'Telegram.EE', _qdnService: 'APP', _qdnIdentifier: 'default'
    });
    expect(validateCmsConfig(telegramConfig).ok).toBe(true);
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe('./qms-cms-config.json');
      return { ok: true, json: async () => telegramConfig } as Response;
    });
    vi.stubGlobal('fetch', fetch);

    const loaded = await loadRuntimeCmsConfig();
    expect(loaded.notice).toBe('');
    expect(loaded.source).toBe('runtime');
    expect(loaded.config.content.manifestIdentifier).toBe('qms-telegram-manifest');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('fails closed instead of requesting generic manifest identifiers when a hosted config is absent', async () => {
    Object.assign(window as any, {
      _qdnName: 'Telegram.EE', _qdnService: 'APP', _qdnIdentifier: 'default'
    });
    const fetch = vi.fn(async () => ({ ok: false, status: 404, text: async () => '' }) as Response);
    vi.stubGlobal('fetch', fetch);

    const loaded = await loadRuntimeCmsConfig();
    expect(loaded.source).toBe('build');
    expect(loaded.config.content.manifestIdentifier).toBe('');
    expect(loaded.config.content.legacyManifestIdentifier).toBe('');
    expect(loaded.notice).toMatch(/project-specific qms-cms-config\.json/i);
  });

  it('also reads an explicitly selected APP identifier through the exact member endpoint', async () => {
    const identifier = 'qms-telegram-cms';
    const explicitConfig = { ...telegramConfig, deployment: { service: 'APP' as const, name: 'Telegram.EE', identifier } };
    Object.assign(window as any, {
      _qdnName: 'Telegram.EE', _qdnService: 'APP', _qdnIdentifier: identifier
    });
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === './qms-cms-config.json') {
        // Core's render router can return the APP shell for a member path when
        // the identifier is carried in the query string, so JSON parsing must
        // fall through to the exact /arbitrary member read.
        return { ok: true, json: async () => { throw new Error('rendered APP shell'); } } as unknown as Response;
      }
      expect(url).toContain('/arbitrary/APP/Telegram.EE/' + identifier + '?filepath=qms-cms-config.json&encoding=base64');
      return { ok: true, text: async () => btoa(JSON.stringify(explicitConfig)) } as Response;
    });
    vi.stubGlobal('fetch', fetch);

    const loaded = await loadRuntimeCmsConfig();
    expect(loaded.source).toBe('runtime');
    expect(loaded.config.deployment?.identifier).toBe(identifier);
    expect(loaded.config.content.manifestIdentifier).toBe('qms-telegram-manifest');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('rejects a valid-looking runtime config for a different hosted identity', async () => {
    Object.assign(window as any, {
      _qdnName: 'Telegram.EE', _qdnService: 'APP', _qdnIdentifier: 'default'
    });
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ ...telegramConfig, deployment: { service: 'APP', name: 'OtherSite', identifier: 'default' } })
    }) as Response));

    const loaded = await loadRuntimeCmsConfig();
    expect(loaded.config.content.manifestIdentifier).toBe('');
    expect(loaded.notice).toMatch(/does not belong to this QDN host/i);
  });
});
