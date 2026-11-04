import { beforeAll, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import axe from 'axe-core';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Layout } from '../src/components/Layout';
import { HomePage } from '../src/pages/HomePage';
import { PostsPage } from '../src/pages/PostsPage';
import { PostPage } from '../src/pages/PostPage';
import { SearchPage } from '../src/pages/SearchPage';
import { AdminPage } from '../src/pages/AdminPage';
import { cmsConfig } from '../src/config/cmsConfig';
import type { AppRoute, CmsDataset, LoadedContent } from '../src/types';
import { loadFixture, loadFixtureContent, ownerIdentity, readerIdentity } from './support/fixtures';

const HERE = path.dirname(fileURLToPath(import.meta.url));

let dataset: CmsDataset;
let helloContent: LoadedContent;

beforeAll(async () => {
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
  const fixture = await loadFixture();
  dataset = fixture.dataset;
  helloContent = await loadFixtureContent(dataset.posts.find((item) => item.slug === 'hello-qortal') as never);
});

function markup(node: ReactNode, route: AppRoute, viewer = ownerIdentity) {
  return renderToStaticMarkup(
    <Layout config={cmsConfig} route={route} viewer={viewer} templateVersion="test">
      {node}
    </Layout>
  );
}

async function violationsFor(html: string) {
  document.documentElement.lang = 'en';
  document.title = 'Accessibility test';
  document.body.innerHTML = html;
  const results = await axe.run(document.body, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
    rules: { 'color-contrast': { enabled: false } }
  });
  return results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    targets: violation.nodes.map((node) => node.target)
  }));
}

async function expectNoViolations(html: string) {
  const violations = await violationsFor(html);
  expect(violations).toEqual([]);
}

describe('accessibility of primary user workflows', () => {
  it('home page has no WCAG A/AA violations', async () => {
    await expectNoViolations(markup(<HomePage dataset={dataset} />, { kind: 'home' }));
  });

  it('posts index has no WCAG A/AA violations', async () => {
    await expectNoViolations(markup(<PostsPage dataset={dataset} page={1} />, { kind: 'posts', page: 1 }));
  });

  it('single post reading flow has no WCAG A/AA violations', async () => {
    await expectNoViolations(markup(
      <PostPage dataset={dataset} item={dataset.posts.find((item) => item.slug === 'hello-qortal') || null} content={helloContent} loading={false} error="" onRetry={() => undefined} previous={null} next={null} />,
      { kind: 'post', slug: 'hello-qortal' }
    ));
  });

  it('search results have no WCAG A/AA violations', async () => {
    await expectNoViolations(markup(<SearchPage dataset={dataset} query="design" />, { kind: 'search', query: 'design' }));
  });

  it('admin owner flow has no WCAG A/AA violations', async () => {
    await expectNoViolations(markup(
      <AdminPage dataset={dataset} identity={ownerIdentity} identityLoading={false} identityNotice="" adoptionQueue={[]} onAdopt={() => ({ ok: true, message: '' })} onRemove={() => undefined} onRefresh={() => undefined} />,
      { kind: 'admin' },
      ownerIdentity
    ));
  });

  it('admin read-only flow has no WCAG A/AA violations', async () => {
    await expectNoViolations(markup(
      <AdminPage dataset={dataset} identity={readerIdentity} identityLoading={false} identityNotice="" adoptionQueue={[]} onAdopt={() => ({ ok: false, message: '' })} onRemove={() => undefined} onRefresh={() => undefined} />,
      { kind: 'admin' },
      readerIdentity
    ));
  });

  it('layout exposes skip link, main landmark and one h1 per flow', async () => {
    const html = markup(<HomePage dataset={dataset} />, { kind: 'home' });
    expect(html).toContain('class="skip-link"');
    expect(html).toContain('href="#main-content"');
    expect(html).toContain('<main id="main-content"');
    expect(html.match(/<h1[\s>]/g)?.length).toBe(1);
    expect(html).toContain('aria-label="Primary"');
  });

  it('stylesheet contains focus-visible and reduced-motion support', () => {
    const css = readFileSync(path.resolve(HERE, '..', 'src', 'styles', 'index.css'), 'utf8');
    expect(css).toContain(':focus-visible');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain('@media (forced-colors: active)');
  });
});
