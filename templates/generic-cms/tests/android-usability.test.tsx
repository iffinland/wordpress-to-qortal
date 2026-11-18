import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { useState } from 'react';
import { attachmentVault, attachmentVaultKey, captureForIdentifier } from '../src/lib/attachmentVault.js';
import { buildSitePostUrl } from '../src/lib/crossPublish/plan.js';
import { TaxonomyInput } from '../src/pages/admin/editor/EditorFields';
import { NavigationEditor } from '../src/pages/admin/NavigationEditor';
import { SiteFooter } from '../src/components/SiteFooter';
import { cmsConfig } from '../src/config/cmsConfig';

afterEach(cleanup);

describe('Android attachment persistence and aliases', () => {
  it('keeps one vault per site and resolves a Q-Tube identifier back to the captured video', () => {
    const key = attachmentVaultKey({ name: 'QortalDemo', siteId: 'site-fixture' });
    const vault = attachmentVault(key);
    const capture = { identifier: 'qms-cms-att-from', filename: 'video.mp4' };
    vault.set('qms-cms-att-from', capture as never);
    expect(attachmentVault(key)).toBe(vault);
    expect(captureForIdentifier(vault, 'qtube_vid_to', [{ from: 'qms-cms-att-from', to: 'qtube_vid_to' }])).toBe(capture);
  });
});

describe('cross-publish CMS links', () => {
  it('uses the actual WEBSITE service, keeps the trailing slash and identifier query', () => {
    expect(buildSitePostUrl({
      hosting: { name: 'Owner', service: 'WEBSITE', identifier: 'qms-site' },
      name: 'fallback',
      slug: 'my post'
    })).toBe('qortal://WEBSITE/Owner/#/posts/my%20post');
    expect(buildSitePostUrl({
      hosting: { name: 'Owner', service: 'WEBSITE', identifier: 'default' },
      slug: 'my-post'
    })).toBe('qortal://WEBSITE/Owner/#/posts/my-post');
    // A malformed deployment identifier must never become ?identifier=%23...
    expect(buildSitePostUrl({
      hosting: { name: 'Owner', service: 'WEBSITE', identifier: '#/posts/broken' },
      slug: 'my-post'
    })).toBe('qortal://WEBSITE/Owner/#/posts/my-post');
  });
});

describe('compact taxonomy suggestions', () => {
  const terms = [
    { id: 't1', name: 'News', slug: 'news' },
    { id: 't2', name: 'Notes', slug: 'notes' },
    { id: 't3', name: 'Sports', slug: 'sports' }
  ];

  it('shows filtered suggestions only while the field is active and typed into', () => {
    function Host() {
      const [value, setValue] = useState('');
      return <TaxonomyInput id="categories" label="Categories" value={value} terms={terms} onChange={setValue} />;
    }
    render(<Host />);
    expect(document.querySelector('.taxonomy-suggestions')).toBeNull();
    const input = screen.getByLabelText('Categories') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'n' } });
    const buttons = Array.from(document.querySelectorAll('.taxonomy-suggestions .chip-button')) as HTMLButtonElement[];
    expect(buttons).toHaveLength(2);
    fireEvent.mouseDown(buttons[0]);
    fireEvent.click(buttons[0]);
    expect(input.value).toBe('News');
    fireEvent.change(input, { target: { value: 'zzz' } });
    expect(document.querySelectorAll('.taxonomy-suggestions .chip-button')).toHaveLength(0);
  });
});

describe('public footer ownership', () => {
  it('keeps attribution but no update check or template version', () => {
    const html = renderToStaticMarkup(<SiteFooter config={{ ...cmsConfig, site: { ...cmsConfig.site, footerText: 'Owner footer' } }} />);
    expect(html).toContain('Owner footer');
    expect(html).toContain('Qortal Migration Studio CMS');
    expect(html).not.toContain('Check for updates');
    expect(html).not.toContain('Template v');
  });
});

describe('configurable community chat navigation', () => {
  it('adds the owner-provided group id as a direct use-group link', () => {
    const onChange = vi.fn();
    render(<NavigationEditor items={[{ label: 'Home', href: '#/' }]} pages={[]} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Qortal group ID'), { target: { value: '1214' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add community chat link' }));
    expect(onChange).toHaveBeenCalledWith([
      { label: 'Home', href: '#/' },
      { label: 'Community chat', href: 'qortal://use-group/action-join/groupid-1214' }
    ]);
  });
});
