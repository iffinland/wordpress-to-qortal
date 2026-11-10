import { describe, expect, it } from 'vitest';
import { cmsConfig, ensureAdminNavigation, runtimeConfigMatchesHosting } from '../src/config/cmsConfig';
import type { CmsTemplateConfig } from '../src/types';

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
});
