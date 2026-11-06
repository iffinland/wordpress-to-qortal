import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ContentHtml } from '../src/components/ContentHtml';
import { parseQortalLink, QORTAL_ATTRIBUTION_LINK } from '../src/lib/links.js';
import { sanitizeHtml } from '../src/lib/sanitize.js';
import { ATTRIBUTION_LINK, SiteFooter } from '../src/components/SiteFooter';
import { cmsConfig } from '../src/config/cmsConfig';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete (window as any).qortalRequest;
  Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
  window.location.hash = '';
});

describe('qortal:// link parsing', () => {
  it('preserves percent-encoded names and paths exactly', () => {
    const website = parseQortalLink('qortal://WEBSITE/Qortal%20Web%20Builders/');
    expect(website?.service).toBe('WEBSITE');
    expect(website?.name).toBe('Qortal Web Builders');
    expect(website?.raw).toBe('qortal://WEBSITE/Qortal%20Web%20Builders/');

    const app = parseQortalLink('qortal://APP/developer%20iffi/');
    expect(app?.name).toBe('developer iffi');
    expect(app?.raw).toContain('developer%20iffi');

    const document = parseQortalLink('qortal://DOCUMENT/developer%20iffi/qms-cms-site-settings?x=1#top');
    expect(document?.path).toBe('qms-cms-site-settings');
    expect(document?.query).toBe('x=1');
  });

  it('accepts documented QDN services and rejects unsafe or malformed links', () => {
    for (const service of ['WEBSITE', 'APP', 'DOCUMENT', 'IMAGE', 'AUDIO', 'VIDEO', 'FILE']) {
      expect(parseQortalLink('qortal://' + service + '/name/id')).toBeTruthy();
    }
    expect(parseQortalLink('javascript:alert(1)')).toBeNull();
    expect(parseQortalLink('data:text/html,<script>alert(1)</script>')).toBeNull();
    expect(parseQortalLink('qortal://EVIL/name')).toBeNull();
    expect(parseQortalLink('qortal://WEBSITE/')).toBeNull();
    expect(parseQortalLink('qortal://WEBSITE/%E0%A4%A')).toBeNull();
    expect(parseQortalLink('qortal://WEBSITE/name with spaces')).toBeNull();
    expect(parseQortalLink('qortal://WEBSITE/name\u0000evil')).toBeNull();
  });

  it('keeps valid qortal hrefs through the sanitizer and strips unsafe schemes', () => {
    const clean = sanitizeHtml('<p><a href="qortal://APP/developer%20iffi/">app</a><a href="javascript:alert(1)">x</a><a href="data:text/html,hi">d</a></p>');
    expect(clean).toContain('href="qortal://APP/developer%20iffi/"');
    expect(clean).not.toContain('javascript:');
    expect(clean).not.toContain('data:text/html');
  });
});

describe('rendered link behaviour', () => {
  function renderHtml(html: string) {
    render(<ContentHtml html={html} />);
    return document.querySelector('a[href]') as HTMLAnchorElement;
  }

  it('copies https links, does not navigate, and shows a transient badge', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const link = renderHtml('<p><a href="https://example.com/very/long/path?x=1">Example</a></p>');
    fireEvent.click(link);
    await screen.findByText('Link copied.');
    expect(writeText).toHaveBeenCalledWith('https://example.com/very/long/path?x=1');
    expect(window.location.hash).toBe('');
    expect(link.getAttribute('data-copy-web2-url')).toBe('https://example.com/very/long/path?x=1');
  });

  it('shows an explicit error when clipboard access fails', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: async () => { throw new Error('blocked'); } },
      configurable: true
    });
    (document as any).execCommand = vi.fn(() => false);
    const link = renderHtml('<p><a href="https://example.com/x">X</a></p>');
    fireEvent.click(link);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Could not copy the link'));
    expect(screen.getByRole('alert').textContent).toContain('https://example.com/x');
  });

  it('supports keyboard Space activation', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const link = renderHtml('<p><a href="https://example.com/k">K</a></p>');
    link.focus();
    fireEvent.keyDown(link, { key: ' ' });
    await screen.findByText('Link copied.');
    expect(writeText).toHaveBeenCalledTimes(1);
  });

  it('opens qortal links through the Hub bridge instead of navigating', async () => {
    const calls: any[] = [];
    (window as any).qortalRequest = async (payload: any) => { calls.push(payload); return true; };
    const link = renderHtml('<p><a href="qortal://APP/developer%20iffi/">App</a></p>');
    fireEvent.click(link);
    await waitFor(() => expect(calls.length).toBe(1));
    expect(calls[0]).toEqual({ action: 'OPEN_NEW_TAB', qortalLink: 'qortal://APP/developer%20iffi/' });
    expect(window.location.hash).toBe('');
  });

  it('falls back outside Hub by copying the qortal link and explaining why', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const link = renderHtml('<p><a href="qortal://APP/developer%20iffi/">App</a></p>');
    fireEvent.click(link);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Qortal Hub'));
    expect(writeText).toHaveBeenCalledWith('qortal://APP/developer%20iffi/');
  });

  it('auto-hides the copy badge after about two seconds', async () => {
    vi.useFakeTimers();
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const link = renderHtml('<p><a href="https://example.com/t">T</a></p>');
    await act(async () => { fireEvent.click(link); });
    expect(screen.getByText('Link copied.')).toBeTruthy();
    act(() => { vi.advanceTimersByTime(2300); });
    expect(screen.queryByText('Link copied.')).toBeNull();
  });
});

describe('footer attribution and header branding', () => {
  it('renders the CMS attribution without a QDN name label and keeps footer text separate', () => {
    const html = renderToHtml(<SiteFooter config={{ ...cmsConfig, site: { ...cmsConfig.site, footerText: 'Owner footer' } }} templateVersion="1.2.3" />);
    expect(html).toContain('Owner footer');
    expect(html).toContain('Qortal Migration Studio CMS');
    expect(html).not.toContain('QDN name:');
    expect(html).toContain('href="' + ATTRIBUTION_LINK + '"');
    expect(ATTRIBUTION_LINK).toBe(QORTAL_ATTRIBUTION_LINK);
  });
});

function renderToHtml(node: ReactNode) { return renderToStaticMarkup(node); }
