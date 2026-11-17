import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Layout } from '../src/components/Layout';
import { cmsConfig } from '../src/config/cmsConfig';
import { QORTAL_COMMUNITY_CHAT_LINK } from '../src/lib/links.js';
import { ownerIdentity } from './support/fixtures';

function renderLayout(config = cmsConfig) {
  return render(
    <Layout config={config} route={{ kind: 'home' }} viewer={ownerIdentity} templateVersion="test">
      <p>Body</p>
    </Layout>
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
});

describe('Back to Top control', () => {
  it('appears only after the reader has scrolled and returns focus to main', () => {
    const scrollTo = vi.fn();
    vi.stubGlobal('scrollTo', scrollTo);
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
    renderLayout();
    expect(screen.queryByRole('button', { name: 'Back to top' })).toBeNull();

    Object.defineProperty(window, 'scrollY', { value: 1600, configurable: true });
    fireEvent.scroll(window);
    const button = screen.getByRole('button', { name: 'Back to top' });
    fireEvent.click(button);

    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: expect.any(String) });
    expect(document.activeElement && document.activeElement.id).toBe('main-content');
  });
});

describe('optional community chat navigation', () => {
  const config = {
    ...cmsConfig,
    navigation: [
      { label: 'Home', href: '#/' },
      { label: 'Community chat', href: QORTAL_COMMUNITY_CHAT_LINK }
    ]
  };

  it('renders one contact action and no duplicate anchor', () => {
    renderLayout(config as typeof cmsConfig);
    const button = screen.getByRole('button', { name: 'Community chat' });
    expect(button).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Community chat' })).toBeNull();
  });

  it('shows the documented link when Hub cannot be reached', async () => {
    renderLayout(config as typeof cmsConfig);
    fireEvent.click(screen.getByRole('button', { name: 'Community chat' }));
    expect(await screen.findByText(QORTAL_COMMUNITY_CHAT_LINK, { selector: 'code' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy chat link' })).toBeTruthy();
  });
});
