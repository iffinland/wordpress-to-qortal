import { beforeAll, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import { Layout } from '../src/components/Layout';
import { HomePage } from '../src/pages/HomePage';
import { PostsPage } from '../src/pages/PostsPage';
import { PostPage } from '../src/pages/PostPage';
import { PageView } from '../src/pages/PageView';
import { TermPage } from '../src/pages/TermPage';
import { ArchivePage } from '../src/pages/ArchivePage';
import { SearchPage } from '../src/pages/SearchPage';
import { AdminPage } from '../src/pages/AdminPage';
import { App } from '../src/App';
import { NotFoundPage } from '../src/pages/NotFoundPage';
import { StateNotice } from '../src/components/StateNotice';
import { cmsConfig } from '../src/config/cmsConfig';
import type { AppRoute, CmsDataset, LoadedContent } from '../src/types';
import { loadFixture, loadFixtureContent, ownerIdentity, readerIdentity } from './support/fixtures';

let dataset: CmsDataset;
let helloContent: LoadedContent;
let aboutContent: LoadedContent;

beforeAll(async () => {
  const fixture = await loadFixture();
  dataset = fixture.dataset;
  helloContent = await loadFixtureContent(dataset.posts.find((item) => item.slug === 'hello-qortal') as never);
  aboutContent = await loadFixtureContent(dataset.pages.find((item) => item.slug === 'about') as never);
});

function render(node: ReactNode, route: AppRoute, viewer = ownerIdentity) {
  return renderToStaticMarkup(
    <Layout config={cmsConfig} route={route} viewer={viewer} templateVersion="test">
      {node}
    </Layout>
  );
}

describe('runtime site configuration', () => {
  it('renders a runtime title, tagline, navigation and accent theme', () => {
    const config = {
      ...cmsConfig,
      site: { ...cmsConfig.site, title: 'Runtime Site', tagline: 'Runtime tagline' },
      navigation: [
        { label: 'Home', href: '#/' },
        { label: 'Journal', href: '#/posts' }
      ],
      theme: { ...cmsConfig.theme, colors: { ...cmsConfig.theme.colors, accent: '#ff5500' } }
    };
    const runtimeDataset = { ...dataset, site: { ...dataset.site, title: 'Runtime Site', tagline: 'Runtime tagline' } };
    const html = renderToStaticMarkup(
      <Layout config={config as typeof cmsConfig} route={{ kind: 'home' }} viewer={ownerIdentity} templateVersion="test">
        <HomePage dataset={runtimeDataset} />
      </Layout>
    );
    expect(html).toContain('<h1 id="home-title">Runtime Site</h1>');
    expect(html).toContain('Runtime tagline');
    expect(html).toContain('href="#/posts"');
    expect(html).toContain('>Journal<');
    expect(html).toContain('--qms-accent:#ff5500');
  });
});

describe('generic CMS routes render from the fixture manifest', () => {
  it('renders home with title, tagline, latest posts and primary navigation', () => {
    const html = render(<HomePage dataset={dataset} />, { kind: 'home' });
    expect(html).toContain('<h1 id="home-title">Fixture Site</h1>');
    expect(html).toContain('A neutral fixture publication');
    expect(html).toContain('Hello Qortal');
    expect(html).toContain('Designing for Qortal');
    expect(html).toContain('aria-label="Primary"');
    expect(html).toContain('href="#/search"');
    expect(html).toContain('href="#/admin"');
  });

  it('renders the posts index', () => {
    const html = render(<PostsPage dataset={dataset} page={1} />, { kind: 'posts', page: 1 });
    expect(html).toContain('<h1>Posts</h1>');
    expect(html).toContain('Hello Qortal');
    expect(html).toContain('Designing for Qortal');
    expect(html).toContain('An Older Archive Entry');
  });

  it('renders a post with sanitized content and taxonomy links', () => {
    const html = render(
      <PostPage dataset={dataset} item={dataset.posts.find((item) => item.slug === 'hello-qortal') || null} content={helloContent} loading={false} error="" onRetry={() => undefined} previous={null} next={null} />,
      { kind: 'post', slug: 'hello-qortal' }
    );
    expect(html).toContain('Hello Qortal');
    expect(html).toContain('Fixture Editor');
    expect(html).toContain('neutral fixture site');
    expect(html).toContain('href="#/category/news"');
    expect(html).toContain('href="#/tag/introduction"');
  });

  it('sanitizes malicious post content before rendering', () => {
    const item = dataset.posts.find((entry) => entry.slug === 'hello-qortal');
    const content = { ...helloContent, html: '<p>Safe body</p><script>alert(1)</script><img src="x" onerror="alert(2)"><a href="javascript:alert(3)">bad</a>' };
    const html = render(
      <PostPage dataset={dataset} item={item || null} content={content} loading={false} error="" onRetry={() => undefined} previous={null} next={null} />,
      { kind: 'post', slug: 'hello-qortal' }
    );
    expect(html).toContain('Safe body');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('javascript:');
  });

  it('renders a static page', () => {
    const html = render(
      <PageView dataset={dataset} item={dataset.pages.find((item) => item.slug === 'about') || null} content={aboutContent} loading={false} error="" onRetry={() => undefined} />,
      { kind: 'page', slug: 'about' }
    );
    expect(html).toContain('About');
    expect(html).toContain('What it proves');
    expect(html).toContain('<h1>About</h1>');
  });

  it('renders category and tag routes', () => {
    const category = render(<TermPage dataset={dataset} kind="category" slug="news" page={1} />, { kind: 'category', slug: 'news', page: 1 });
    expect(category).toContain('<h1>News</h1>');
    expect(category).toContain('Hello Qortal');
    const tag = render(<TermPage dataset={dataset} kind="tag" slug="design" page={1} />, { kind: 'tag', slug: 'design', page: 1 });
    expect(tag).toContain('<h1>Design</h1>');
    expect(tag).toContain('Designing for Qortal');
  });

  it('renders archive, search and not-found routes', () => {
    const archive = render(<ArchivePage dataset={dataset} year={2024} page={1} />, { kind: 'archive', year: 2024, page: 1 });
    expect(archive).toContain('An Older Archive Entry');
    expect(archive).toContain('>2024<');
    const search = render(<SearchPage dataset={dataset} query="design" />, { kind: 'search', query: 'design' });
    expect(search).toContain('Search published content');
    expect(search).toContain('Designing for Qortal');
    expect(search).toContain('1 result');
    const missing = render(<NotFoundPage />, { kind: 'not-found' });
    expect(missing).toContain('Page not found');
  });

  it('renders loading, error, empty, partial and stale states honestly', () => {
    const loading = render(<PostPage dataset={dataset} item={null} content={null} loading={true} error="" onRetry={() => undefined} previous={null} next={null} />, { kind: 'post', slug: 'hello-qortal' });
    expect(loading).toContain('Loading post');
    const error = render(<PostPage dataset={dataset} item={null} content={null} loading={false} error="QDN timeout" onRetry={() => undefined} previous={null} next={null} />, { kind: 'post', slug: 'hello-qortal' });
    expect(error).toContain('This post could not be loaded');
    expect(error).toContain('QDN timeout');
    const emptyDataset = { ...dataset, state: 'empty' as const, posts: [], pages: [] };
    const empty = render(<PostsPage dataset={emptyDataset} page={1} />, { kind: 'posts', page: 1 });
    expect(empty).toContain('No published posts yet');
    const partialDataset = { ...dataset, state: 'partial' as const, availability: { ...dataset.availability, posts: false } };
    const partial = render(<HomePage dataset={partialDataset} />, { kind: 'home' });
    expect(partial).toContain('Posts are unavailable');
    const stale = render(<StateNotice state="stale" notices={[{ code: 'catalog-stale', level: 'warning', message: 'The published catalog is old.' }]} />, { kind: 'home' });
    expect(stale).toContain('The catalog may be out of date');
    expect(stale).toContain('The published catalog is old.');
  });

  it('renders admin owner mode and read-only mode', () => {
    const owner = render(
      <AdminPage dataset={dataset} identity={ownerIdentity} identityLoading={false} identityNotice="" adoptionQueue={[]} onAdopt={() => ({ ok: true, message: '' })} onRemove={() => undefined} onRefresh={() => undefined} />,
      { kind: 'admin' },
      ownerIdentity
    );
    expect(owner).toContain('Owner mode');
    expect(owner).toContain('Import and adoption');
    expect(owner).not.toMatch(/<fieldset class="admin-fieldset" disabled/);
    const reader = render(
      <AdminPage dataset={dataset} identity={readerIdentity} identityLoading={false} identityNotice="" adoptionQueue={[]} onAdopt={() => ({ ok: false, message: 'read-only' })} onRemove={() => undefined} onRefresh={() => undefined} />,
      { kind: 'admin' },
      readerIdentity
    );
    expect(reader).toContain('Read-only mode');
    expect(reader).toMatch(/<fieldset class="admin-fieldset" disabled/);
    expect(reader).toContain('disabled');
  });
});

describe('admin preconditions stay visible without a published catalog', () => {
  const noop = {
    onAdopt: () => ({ ok: false, message: 'unavailable' }),
    onRemove: () => undefined,
    onRefresh: () => undefined
  };

  it('explains that publishing must happen first instead of rendering an empty menu', () => {
    const html = render(
      <AdminPage dataset={null} loading={false} identity={null} identityLoading={false} identityNotice="Qortal identity could not be resolved." adoptionQueue={[]} {...noop} />,
      { kind: 'admin' }
    );
    expect(html).toContain('No published catalog is available yet');
    expect(html).toContain('Publish the site with the Migration Publisher first');
    expect(html).toContain('Import is unavailable until a published catalog exists');
    expect(html).toMatch(/<fieldset class="admin-fieldset" disabled/);
    expect(html).toContain('Qortal identity could not be resolved');
  });

  it('keeps the admin page reachable while the catalog is loading', () => {
    const html = render(
      <AdminPage dataset={null} loading identity={null} identityLoading adoptionQueue={[]} identityNotice="" {...noop} />,
      { kind: 'admin' }
    );
    expect(html).toContain('Reading the published catalog...');
    expect(html).toContain('Admin and import');
  });

  it('shows the catalog error and disables import rather than hiding the reason', () => {
    const errorDataset: CmsDataset = {
      ...dataset,
      state: 'error',
      source: 'error',
      message: 'The qms-cms-manifest could not be read.',
      notices: [{ code: 'catalog-load-failed', level: 'error', message: 'The qms-cms-manifest could not be read.' }],
      availability: { posts: false, pages: false, categories: false, tags: false },
      posts: [],
      pages: [],
      categories: [],
      tags: []
    };
    const html = render(
      <AdminPage dataset={errorDataset} loading={false} identity={ownerIdentity} identityLoading={false} identityNotice="" adoptionQueue={[]} {...noop} />,
      { kind: 'admin' }
    );
    expect(html).toContain('Catalog unavailable');
    expect(html).toContain('The qms-cms-manifest could not be read.');
    expect(html).toMatch(/<fieldset class="admin-fieldset" disabled/);
  });

  it('renders the admin route directly instead of the global catalog error', () => {
    window.location.hash = '#/admin';
    const html = renderToStaticMarkup(<App />);
    expect(html).toContain('Admin and import');
    expect(html).toContain('Reading the published catalog...');
    expect(html).not.toContain('Loading the QDN catalog...');
    window.location.hash = '';
  });
});
