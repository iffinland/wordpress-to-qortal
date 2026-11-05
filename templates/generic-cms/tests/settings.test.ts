import { describe, expect, it } from 'vitest';
import {
  buildSettingsDocument,
  defaultSettingsDraft,
  detectSettingsConflict,
  mergeSettingsIntoConfig,
  readSettingsDocument,
  removeTemplatePlaceholders,
  validateSettingsDraft
} from '../src/lib/settings.js';
import { cmsConfig } from '../src/config/cmsConfig';

const identity = { address: 'QOwnerAddress111111111111111111111', qdnName: 'developer iffi' };

describe('versioned site settings', () => {
  it('removes template placeholder copy from an owner site', () => {
    const site = removeTemplatePlaceholders({
      title: 'Qortal Site', tagline: 'Independent publishing on Qortal QDN', description: '',
      footerText: 'Qortal QDN publication'
    }, 'developer iffi');
    expect(site.title).toBe('developer iffi');
    expect(site.tagline).toBe('');
    expect(site.footerText).toBe('');
  });

  it('validates required fields, navigation and colors', () => {
    const draft = defaultSettingsDraft(cmsConfig);
    expect(validateSettingsDraft(draft).ok).toBe(true);
    expect(validateSettingsDraft({ ...draft, site: { ...draft.site, title: '' } }).ok).toBe(false);
    expect(validateSettingsDraft({ ...draft, navigation: [] }).ok).toBe(false);
    expect(validateSettingsDraft({ ...draft, navigation: [{ label: 'Bad', href: 'javascript:alert(1)' }] }).ok).toBe(false);
  });

  it('builds a versioned document with an integrity hash', async () => {
    const draft = defaultSettingsDraft(cmsConfig);
    draft.site.title = 'My site';
    const first = await buildSettingsDocument({ draft, baseRevision: 0, identity, now: 1 });
    expect(first.revision).toBe(1);
    expect(first.previous_revision).toBe(0);
    expect(first.integrity.algorithm).toBe('sha256');
    expect(first.integrity.value).toMatch(/^sha256:[a-f0-9]{64}$/);
    const second = await buildSettingsDocument({ draft, baseRevision: 1, identity, now: 2 });
    expect(second.revision).toBe(2);
    expect(second.integrity.value).not.toBe(first.integrity.value);
  });

  it('reads only supported schemas and rejects a future version', async () => {
    const draft = defaultSettingsDraft(cmsConfig);
    const document = await buildSettingsDocument({ draft, baseRevision: 0, identity });
    expect(readSettingsDocument(document).ok).toBe(true);
    expect(readSettingsDocument({ ...document, schema: 'other@1' }).ok).toBe(false);
    expect(readSettingsDocument({ ...document, version: 99 }).ok).toBe(false);
  });

  it('merges published settings over the build config while preserving admin/content fields', async () => {
    const draft = defaultSettingsDraft(cmsConfig);
    draft.site.title = 'Owner title';
    draft.site.footerText = 'Owner footer';
    draft.navigation = [{ label: 'Home', href: '#/' }, { label: 'Journal', href: '#/posts' }];
    draft.colors.accent = '#ff5500';
    const document = await buildSettingsDocument({ draft, baseRevision: 0, identity });
    const merged = mergeSettingsIntoConfig(cmsConfig, document, { qdnName: 'developer iffi' });
    expect(merged.site.title).toBe('Owner title');
    expect(merged.site.footerText).toBe('Owner footer');
    expect(merged.navigation).toHaveLength(2);
    expect(merged.theme.colors.accent).toBe('#ff5500');
    expect(merged.content.manifestIdentifier).toBe(cmsConfig.content.manifestIdentifier);
    expect(merged.admin).toEqual(cmsConfig.admin);
  });

  it('detects a newer published revision instead of overwriting it', () => {
    expect(detectSettingsConflict({ revision: 3 }, 2).conflict).toBe(true);
    expect(detectSettingsConflict({ revision: 2 }, 2).conflict).toBe(false);
    expect(detectSettingsConflict(null, 0).conflict).toBe(false);
  });
});

