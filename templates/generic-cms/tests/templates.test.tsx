import { beforeAll, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import { Layout } from '../src/components/Layout';
import { cmsConfig } from '../src/config/cmsConfig';
import { getSiteTemplate } from '../src/templates/registry';
import { MagazineHome, MagazinePosts, MagazineTerm, MagazinePost, MagazinePage } from '../src/templates/magazine';
import { PortfolioHome, PortfolioPosts, PortfolioTerm, PortfolioPost, PortfolioPage } from '../src/templates/portfolio';
import { DocsHome, DocsPosts, DocsTerm, DocsPost, DocsPage, DocsSearch, DocsArchive } from '../src/templates/docs';
import { GalleryHome, GalleryPosts, GalleryTerm, GalleryPost, GalleryPage } from '../src/templates/gallery';
import { BusinessHome, BusinessPosts, BusinessTerm, BusinessPost, BusinessPage } from '../src/templates/business';
import { VideoHome, VideoPosts, VideoTerm, VideoPost, VideoPage } from '../src/templates/video';
import { JournalHome, JournalPosts, JournalTerm, JournalPost, JournalPage, JournalArchive } from '../src/templates/journal';
import { SiteFooter } from '../src/components/SiteFooter';
import { defaultTemplate } from '../src/templates/default';
import { defaultSettingsDraft, mergeSettingsIntoConfig, validateSettingsDraft } from '../src/lib/settings.js';
import type { AppRoute, CmsDataset } from '../src/types';
import { loadFixture, loadFixtureContent, ownerIdentity } from './support/fixtures';
import type { LoadedContent } from '../src/types';

let dataset: CmsDataset;
let helloContent: LoadedContent;
let aboutContent: LoadedContent;

beforeAll(async () => {
  dataset = (await loadFixture()).dataset;
  helloContent = await loadFixtureContent(dataset.posts.find((item) => item.slug === 'hello-qortal') as never);
  aboutContent = await loadFixtureContent(dataset.pages.find((item) => item.slug === 'about') as never);
});

const magazineConfig = { ...cmsConfig, appearance: { template: 'magazine' } };
const portfolioConfig = { ...cmsConfig, appearance: { template: 'portfolio' } };
const docsConfig = { ...cmsConfig, appearance: { template: 'docs' } };
const galleryConfig = { ...cmsConfig, appearance: { template: 'gallery' } };
const businessConfig = { ...cmsConfig, appearance: { template: 'business' } };
const videoConfig = { ...cmsConfig, appearance: { template: 'video' } };
const journalConfig = { ...cmsConfig, appearance: { template: 'journal' } };

function render(node: ReactNode, route: AppRoute, config: typeof cmsConfig = magazineConfig, templateId = 'magazine') {
  return renderToStaticMarkup(
    <Layout config={config} route={route} viewer={ownerIdentity} templateVersion="test" templateId={templateId}>
      {node}
    </Layout>
  );
}

describe('site template registry', () => {
  it('registers the original presentation as Default and keeps its home unchanged', () => {
    const template = getSiteTemplate('default');
    expect(template.id).toBe('default');
    expect(template.Home).toBe(defaultTemplate.Home);
    const html = render(<template.Home dataset={dataset} />, { kind: 'home' }, cmsConfig, 'default');
    expect(html).toContain('qms-template--default');
    expect(html).toContain('Latest posts');
    expect(html).not.toContain('magazine-hero');
  });

  it('keeps the Default article label pills unchanged', () => {
    const item = dataset.posts.find((entry) => entry.slug === 'hello-qortal') || null;
    const html = render(
      <defaultTemplate.Post dataset={dataset} item={item} content={helloContent} loading={false} error="" onRetry={() => undefined} previous={null} next={null} />,
      { kind: 'post', slug: 'hello-qortal' },
      cmsConfig,
      'default'
    );
    expect(html).toContain('term-list--inline');
    expect(html).not.toContain('magazine-article__labels');
  });

  it('falls back to Default for an unknown template id', () => {
    expect(getSiteTemplate('does-not-exist').id).toBe('default');
    expect(getSiteTemplate(undefined).id).toBe('default');
    expect(getSiteTemplate(null).id).toBe('default');
  });

  it('exposes the Magazine template with its own home, posts and term views', () => {
    const template = getSiteTemplate('magazine');
    expect(template.id).toBe('magazine');
    expect(template.Home).toBe(MagazineHome);
    expect(template.Posts).toBe(MagazinePosts);
    expect(template.Term).toBe(MagazineTerm);
    expect(template.Post).toBe(MagazinePost);
    expect(template.Page).toBe(MagazinePage);
  });
});

describe('magazine template rendering', () => {
  it('renders an editorial home with a featured story, category strip and image-led cards', () => {
    const html = render(<MagazineHome dataset={dataset} />, { kind: 'home' });
    expect(html).toContain('qms-template--magazine');
    expect(html).toContain('magazine-hero');
    expect(html).toContain('Hello Qortal');
    expect(html).toContain('Top stories');
    expect(html).toContain('Sections');
    expect(html).toContain('News');
    expect(html).toContain('/arbitrary/IMAGE/QortalDemo/qms-fixture-image-hero');
    expect((html.match(/<h1/g) || []).length).toBe(1);
  });

  it('renders the magazine story index with image cards and pagination semantics', () => {
    const html = render(<MagazinePosts dataset={dataset} page={1} />, { kind: 'posts', page: 1 });
    expect(html).toContain('<h1>Stories</h1>');
    expect(html).toContain('magazine-grid');
    expect(html).toContain('Hello Qortal');
    expect(html).toContain('Designing for Qortal');
    expect(html).toContain('magazine-card__media');
  });

  it('renders a category section with the magazine grid', () => {
    const html = render(<MagazineTerm dataset={dataset} kind="category" slug="news" page={1} />, { kind: 'category', slug: 'news', page: 1 });
    expect(html).toContain('<h1>News</h1>');
    expect(html).toContain('Section');
    expect(html).toContain('Hello Qortal');
  });

  it('renders an article with the magazine hero, body column, terms and story navigation', () => {
    const item = dataset.posts.find((entry) => entry.slug === 'hello-qortal') || null;
    const html = render(
      <MagazinePost dataset={dataset} item={item} content={helloContent} loading={false} error="" onRetry={() => undefined} previous={null} next={null} />,
      { kind: 'post', slug: 'hello-qortal' }
    );
    expect(html).toContain('magazine-article');
    expect(html).toContain('magazine-article__hero');
    expect(html).toContain('magazine-article__body');
    expect(html).toContain('Hello Qortal');
    expect(html).toContain('By Fixture Editor');
    expect(html).toContain('href="#/category/news"');
    expect(html).toContain('magazine-tag-list');
    expect(html).toContain('magazine-article__labels');
    expect(html).not.toContain('term-list--inline');
    expect(html).toContain('/arbitrary/IMAGE/QortalDemo/qms-fixture-image-hero');
    expect((html.match(/<h1/g) || []).length).toBe(1);
  });

  it('renders a page with the magazine page header and body', () => {
    const item = dataset.pages.find((entry) => entry.slug === 'about') || null;
    const html = render(
      <MagazinePage dataset={dataset} item={item} content={aboutContent} loading={false} error="" onRetry={() => undefined} />,
      { kind: 'page', slug: 'about' }
    );
    expect(html).toContain('magazine-page');
    expect(html).toContain('magazine-page__body');
    expect(html).toContain(aboutContent.title);
    expect((html.match(/<h1/g) || []).length).toBe(1);
  });

  it('keeps the empty and unavailable states instead of rendering a blank page', () => {
    const empty = { ...dataset, posts: [] };
    const emptyHtml = render(<MagazineHome dataset={empty} />, { kind: 'home' });
    expect(emptyHtml).toContain('No published stories yet');
    const unavailable = { ...dataset, availability: { ...dataset.availability, posts: false } };
    const unavailableHtml = render(<MagazineHome dataset={unavailable} />, { kind: 'home' });
    expect(unavailableHtml).toContain('Stories are unavailable');
  });
});

describe('portfolio template rendering', () => {
  it('registers Portfolio alongside Default and Magazine', () => {
    const template = getSiteTemplate('portfolio');
    expect(template.id).toBe('portfolio');
    expect(template.label).toBe('Portfolio');
    expect(template.Home).toBe(PortfolioHome);
    expect(template.Posts).toBe(PortfolioPosts);
    expect(template.Term).toBe(PortfolioTerm);
    expect(template.Post).toBe(PortfolioPost);
    expect(template.Page).toBe(PortfolioPage);
  });

  it('renders a large hero, image-led project gallery, categories and About/Contact sections', () => {
    const html = render(<PortfolioHome dataset={dataset} />, { kind: 'home' }, portfolioConfig, 'portfolio');
    expect(html).toContain('qms-template--portfolio');
    expect(html).toContain('portfolio-hero');
    expect(html).toContain('Work worth');
    expect(html).toContain(dataset.site.description);
    expect(html).toContain('Selected work');
    expect(html).toContain('Hello Qortal');
    expect(html).toContain('News');
    expect(html).toContain('About');
    expect(html).toContain('Contact');
    expect(html).toContain('#/pages/about');
    expect(html).toContain('#/pages/contact');
    expect(html).toContain('/arbitrary/IMAGE/QortalDemo/qms-fixture-image-hero');
    expect((html.match(/<h1/g) || []).length).toBe(1);
  });

  it('renders the portfolio project index and category view', () => {
    const index = render(<PortfolioPosts dataset={dataset} page={1} />, { kind: 'posts', page: 1 }, portfolioConfig, 'portfolio');
    expect(index).toContain('<h1>Selected work</h1>');
    expect(index).toContain('portfolio-grid');
    expect(index).toContain('portfolio-filter');
    expect(index).toContain('Hello Qortal');
    const category = render(<PortfolioTerm dataset={dataset} kind="category" slug="news" page={1} />, { kind: 'category', slug: 'news', page: 1 }, portfolioConfig, 'portfolio');
    expect(category).toContain('<h1>News</h1>');
    expect(category).toContain('portfolio-card');
  });

  it('renders an individual project with split hero, body and rectangular labels', () => {
    const item = dataset.posts.find((entry) => entry.slug === 'hello-qortal') || null;
    const html = render(
      <PortfolioPost dataset={dataset} item={item} content={helloContent} loading={false} error="" onRetry={() => undefined} previous={null} next={null} />,
      { kind: 'post', slug: 'hello-qortal' },
      portfolioConfig,
      'portfolio'
    );
    expect(html).toContain('portfolio-project');
    expect(html).toContain('portfolio-project__hero');
    expect(html).toContain('portfolio-project__body');
    expect(html).toContain('Hello Qortal');
    expect(html).toContain('portfolio-tags');
    expect(html).toContain('href="#/category/news"');
    expect(html).toContain('/arbitrary/IMAGE/QortalDemo/qms-fixture-image-hero');
    expect((html.match(/<h1/g) || []).length).toBe(1);
  });

  it('renders CMS pages such as About and Contact with portfolio styling', () => {
    const item = dataset.pages.find((entry) => entry.slug === 'about') || null;
    const html = render(
      <PortfolioPage dataset={dataset} item={item} content={aboutContent} loading={false} error="" onRetry={() => undefined} />,
      { kind: 'page', slug: 'about' },
      portfolioConfig,
      'portfolio'
    );
    expect(html).toContain('portfolio-page');
    expect(html).toContain('portfolio-page__body');
    expect(html).toContain(aboutContent.title);
    expect((html.match(/<h1/g) || []).length).toBe(1);
  });
});

describe('documentation template rendering', () => {
  it('registers Documentation alongside the other templates', () => {
    const template = getSiteTemplate('docs');
    expect(template.id).toBe('docs');
    expect(template.label).toBe('Documentation / Knowledge Base');
    expect(template.Home).toBe(DocsHome);
    expect(template.Posts).toBe(DocsPosts);
    expect(template.Term).toBe(DocsTerm);
    expect(template.Post).toBe(DocsPost);
    expect(template.Page).toBe(DocsPage);
    expect(template.Search).toBe(DocsSearch);
    expect(template.Archive).toBe(DocsArchive);
  });

  it('renders a documentation home with an introduction, categories and starting guides', () => {
    const html = render(<DocsHome dataset={dataset} />, { kind: 'home' }, docsConfig, 'docs');
    expect(html).toContain('qms-template--docs');
    expect(html).toContain('docs-hero');
    expect(html).toContain('Answers, guides and reference material.');
    expect(html).toContain(dataset.site.description);
    expect(html).toContain('Documentation categories');
    expect(html).toContain('News');
    expect(html).toContain('Start here');
    expect(html).toContain('Hello Qortal');
    expect(html).toContain('href="#/search"');
    expect((html.match(/<h1/g) || []).length).toBe(1);
  });

  it('renders the guide index with a desktop sidebar and a mobile menu', () => {
    const html = render(<DocsPosts dataset={dataset} page={1} />, { kind: 'posts', page: 1 }, docsConfig, 'docs');
    expect(html).toContain('docs-layout');
    expect(html).toContain('docs-sidebar');
    expect(html).toContain('docs-menu');
    expect(html).toContain('<h1>All guides</h1>');
    expect(html).toContain('Hello Qortal');
    expect(html).toContain('Designing for Qortal');
    expect(html).toContain('href="#/category/news"');
  });

  it('renders a category view with the documentation navigation', () => {
    const html = render(<DocsTerm dataset={dataset} kind="category" slug="news" page={1} />, { kind: 'category', slug: 'news', page: 1 }, docsConfig, 'docs');
    expect(html).toContain('<h1>News</h1>');
    expect(html).toContain('docs-sidebar');
    expect(html).toContain('Hello Qortal');
  });

  it('renders a technical article with code, links and previous/next navigation', () => {
    const item = dataset.posts.find((entry) => entry.slug === 'hello-qortal') || null;
    const next = dataset.posts.find((entry) => entry.slug === 'designing-for-qortal') || null;
    const content = {
      ...helloContent,
      html: '<h2>Install</h2><pre><code>npm install qms</code></pre><p>Read the <a href="https://example.com/guide">full guide</a>.</p>'
    };
    const html = render(
      <DocsPost dataset={dataset} item={item} content={content} loading={false} error="" onRetry={() => undefined} previous={null} next={next} />,
      { kind: 'post', slug: 'hello-qortal' },
      docsConfig,
      'docs'
    );
    expect(html).toContain('docs-article');
    expect(html).toContain('docs-breadcrumb');
    expect(html).toContain('docs-article__body');
    expect(html).toContain('<pre>');
    expect(html).toContain('<code>');
    expect(html).toContain('href="https://example.com/guide"');
    expect(html).toContain('Next guide');
    expect(html).toContain('href="#/posts/designing-for-qortal"');
    expect((html.match(/<h1/g) || []).length).toBe(1);
  });

  it('renders CMS pages inside the documentation layout', () => {
    const item = dataset.pages.find((entry) => entry.slug === 'about') || null;
    const html = render(
      <DocsPage dataset={dataset} item={item} content={aboutContent} loading={false} error="" onRetry={() => undefined} />,
      { kind: 'page', slug: 'about' },
      docsConfig,
      'docs'
    );
    expect(html).toContain('docs-page');
    expect(html).toContain('docs-sidebar');
    expect(html).toContain(aboutContent.title);
    expect((html.match(/<h1/g) || []).length).toBe(1);
  });

  it('integrates the existing CMS search inside the documentation layout', () => {
    const html = render(<DocsSearch dataset={dataset} query="hello" />, { kind: 'search', query: 'hello' }, docsConfig, 'docs');
    expect(html).toContain('docs-layout');
    expect(html).toContain('docs-sidebar');
    expect(html).toContain('docs-menu');
    expect(html).toContain('Search');
  });
});

describe('photography template rendering', () => {
  it('registers Photography alongside the other templates', () => {
    const template = getSiteTemplate('gallery');
    expect(template.id).toBe('gallery');
    expect(template.label).toBe('Photography / Gallery');
    expect(template.Home).toBe(GalleryHome);
    expect(template.Posts).toBe(GalleryPosts);
    expect(template.Term).toBe(GalleryTerm);
    expect(template.Post).toBe(GalleryPost);
    expect(template.Page).toBe(GalleryPage);
  });

  it('renders a full-bleed visual hero, album collections and a masonry gallery', () => {
    const html = render(<GalleryHome dataset={dataset} />, { kind: 'home' }, galleryConfig, 'gallery');
    expect(html).toContain('qms-template--gallery');
    expect(html).toContain('gallery-hero');
    expect(html).toContain('Light, place and story.');
    expect(html).toContain(dataset.site.description);
    expect(html).toContain('Albums');
    expect(html).toContain('News');
    expect(html).toContain('Recent work');
    expect(html).toContain('Hello Qortal');
    expect(html).toContain('gallery-masonry');
    expect(html).toContain('View full size');
    expect(html).toContain('/arbitrary/IMAGE/QortalDemo/qms-fixture-image-hero');
    expect((html.match(/<h1/g) || []).length).toBe(1);
  });

  it('renders the photograph index and a collection view', () => {
    const index = render(<GalleryPosts dataset={dataset} page={1} />, { kind: 'posts', page: 1 }, galleryConfig, 'gallery');
    expect(index).toContain('<h1>Photographs</h1>');
    expect(index).toContain('gallery-filter');
    expect(index).toContain('gallery-masonry');
    expect(index).toContain('Hello Qortal');
    const collection = render(<GalleryTerm dataset={dataset} kind="category" slug="news" page={1} />, { kind: 'category', slug: 'news', page: 1 }, galleryConfig, 'gallery');
    expect(collection).toContain('<h1>News</h1>');
    expect(collection).toContain('gallery-card');
  });

  it('renders an individual photograph with a large image, elegant typography and full-size viewing', () => {
    const item = dataset.posts.find((entry) => entry.slug === 'hello-qortal') || null;
    const content = { ...helloContent, html: '<p>Field notes from the coast.</p><img src="/arbitrary/IMAGE/QortalDemo/qms-fixture-image-hero" alt="Coast detail" /><p>More to come.</p>' };
    const html = render(
      <GalleryPost dataset={dataset} item={item} content={content} loading={false} error="" onRetry={() => undefined} previous={null} next={null} />,
      { kind: 'post', slug: 'hello-qortal' },
      galleryConfig,
      'gallery'
    );
    expect(html).toContain('gallery-article');
    expect(html).toContain('gallery-article__hero');
    expect(html).toContain('gallery-article__body');
    expect(html).toContain('View full size');
    expect(html).toContain('Click any image to view it full size.');
    expect(html).toContain('href="#/category/news"');
    expect((html.match(/<h1/g) || []).length).toBe(1);
  });

  it('renders CMS pages with the gallery reading layout', () => {
    const item = dataset.pages.find((entry) => entry.slug === 'about') || null;
    const html = render(
      <GalleryPage dataset={dataset} item={item} content={aboutContent} loading={false} error="" onRetry={() => undefined} />,
      { kind: 'page', slug: 'about' },
      galleryConfig,
      'gallery'
    );
    expect(html).toContain('gallery-page');
    expect(html).toContain('gallery-article__body');
    expect(html).toContain(aboutContent.title);
    expect((html.match(/<h1/g) || []).length).toBe(1);
  });
});

describe('business template rendering', () => {
  it('registers Business alongside the other templates', () => {
    const template = getSiteTemplate('business');
    expect(template.id).toBe('business');
    expect(template.label).toBe('Business / Services');
    expect(template.Home).toBe(BusinessHome);
    expect(template.Posts).toBe(BusinessPosts);
    expect(template.Term).toBe(BusinessTerm);
    expect(template.Post).toBe(BusinessPost);
    expect(template.Page).toBe(BusinessPage);
  });

  it('renders a professional hero, services, projects, about and contact sections', () => {
    const html = render(<BusinessHome dataset={dataset} />, { kind: 'home' }, businessConfig, 'business');
    expect(html).toContain('qms-template--business');
    expect(html).toContain('business-hero');
    expect(html).toContain(dataset.site.tagline);
    expect(html).toContain(dataset.site.description);
    expect(html).toContain('Services');
    expect(html).toContain('News');
    expect(html).toContain('Completed projects');
    expect(html).toContain('Hello Qortal');
    expect(html).toContain('About');
    expect(html).toContain('Contact');
    expect(html).toContain('business-contact');
    expect((html.match(/<h1/g) || []).length).toBe(1);
  });

  it('renders the project index and a service-area view', () => {
    const index = render(<BusinessPosts dataset={dataset} page={1} />, { kind: 'posts', page: 1 }, businessConfig, 'business');
    expect(index).toContain('<h1>Our work</h1>');
    expect(index).toContain('business-project-grid');
    expect(index).toContain('Hello Qortal');
    const category = render(<BusinessTerm dataset={dataset} kind="category" slug="news" page={1} />, { kind: 'category', slug: 'news', page: 1 }, businessConfig, 'business');
    expect(category).toContain('<h1>News</h1>');
    expect(category).toContain('business-project-card');
  });

  it('renders a completed project with consistent business styling', () => {
    const item = dataset.posts.find((entry) => entry.slug === 'hello-qortal') || null;
    const html = render(
      <BusinessPost dataset={dataset} item={item} content={helloContent} loading={false} error="" onRetry={() => undefined} previous={null} next={null} />,
      { kind: 'post', slug: 'hello-qortal' },
      businessConfig,
      'business'
    );
    expect(html).toContain('business-article');
    expect(html).toContain('business-article__body');
    expect(html).toContain('Hello Qortal');
    expect(html).toContain('href="#/category/news"');
    expect((html.match(/<h1/g) || []).length).toBe(1);
  });

  it('renders About and Contact pages with the service layout and contact aside', () => {
    const item = dataset.pages.find((entry) => entry.slug === 'about') || null;
    const html = render(
      <BusinessPage dataset={dataset} item={item} content={aboutContent} loading={false} error="" onRetry={() => undefined} />,
      { kind: 'page', slug: 'about' },
      businessConfig,
      'business'
    );
    expect(html).toContain('business-page');
    expect(html).toContain('business-page__body');
    expect(html).toContain('business-page__aside');
    expect(html).toContain('href="#/pages/contact"');
    expect(html).toContain(aboutContent.title);
    expect((html.match(/<h1/g) || []).length).toBe(1);
  });
});

describe('video template rendering', () => {
  it('registers Video alongside the other templates', () => {
    const template = getSiteTemplate('video');
    expect(template.id).toBe('video');
    expect(template.label).toBe('Video / Media');
    expect(template.Home).toBe(VideoHome);
    expect(template.Posts).toBe(VideoPosts);
    expect(template.Term).toBe(VideoTerm);
    expect(template.Post).toBe(VideoPost);
    expect(template.Page).toBe(VideoPage);
  });

  it('renders a featured video, series collections and thumbnail gallery', () => {
    const html = render(<VideoHome dataset={dataset} />, { kind: 'home' }, videoConfig, 'video');
    expect(html).toContain('qms-template--video');
    expect(html).toContain('video-featured');
    expect(html).toContain('Featured video');
    expect(html).toContain('Hello Qortal');
    expect(html).toContain('Series');
    expect(html).toContain('News');
    expect(html).toContain('Latest videos');
    expect(html).toContain('video-grid');
    expect(html).toContain('Watch video');
    expect(html).toContain('/arbitrary/IMAGE/QortalDemo/qms-fixture-image-hero');
    expect((html.match(/<h1/g) || []).length).toBe(1);
  });

  it('renders the video index and a series view', () => {
    const index = render(<VideoPosts dataset={dataset} page={1} />, { kind: 'posts', page: 1 }, videoConfig, 'video');
    expect(index).toContain('<h1>Videos</h1>');
    expect(index).toContain('video-filter');
    expect(index).toContain('video-grid');
    expect(index).toContain('Hello Qortal');
    const series = render(<VideoTerm dataset={dataset} kind="category" slug="news" page={1} />, { kind: 'category', slug: 'news', page: 1 }, videoConfig, 'video');
    expect(series).toContain('<h1>News</h1>');
    expect(series).toContain('video-card');
  });

  it('renders an individual video with embedded CMS media and related videos', () => {
    const item = dataset.posts.find((entry) => entry.slug === 'hello-qortal') || null;
    const content = {
      ...helloContent,
      html: '<p>Watch the field recording.</p><div data-qms-attachment="1" data-kind="video" data-service="VIDEO" data-name="QortalDemo" data-identifier="qms-video-1" data-filename="field-recording.mp4" data-title="Field recording">Field recording</div><p>Recorded on the coast.</p>'
    };
    const html = render(
      <VideoPost dataset={dataset} item={item} content={content} loading={false} error="" onRetry={() => undefined} previous={null} next={null} />,
      { kind: 'post', slug: 'hello-qortal' },
      videoConfig,
      'video'
    );
    expect(html).toContain('video-detail');
    expect(html).toContain('video-detail__player');
    expect(html).toContain('data-qms-attachment');
    expect(html).toContain('Field recording');
    expect(html).toContain('Related videos');
    expect(html).toContain('href="#/category/news"');
    expect((html.match(/<h1/g) || []).length).toBe(1);
  });

  it('renders CMS pages inside the video layout', () => {
    const item = dataset.pages.find((entry) => entry.slug === 'about') || null;
    const html = render(
      <VideoPage dataset={dataset} item={item} content={aboutContent} loading={false} error="" onRetry={() => undefined} />,
      { kind: 'page', slug: 'about' },
      videoConfig,
      'video'
    );
    expect(html).toContain('video-page');
    expect(html).toContain('video-page__body');
    expect(html).toContain(aboutContent.title);
    expect((html.match(/<h1/g) || []).length).toBe(1);
  });
});

describe('journal template rendering', () => {
  it('registers Personal Journal alongside the other templates', () => {
    const template = getSiteTemplate('journal');
    expect(template.id).toBe('journal');
    expect(template.label).toBe('Personal Journal');
    expect(template.Home).toBe(JournalHome);
    expect(template.Posts).toBe(JournalPosts);
    expect(template.Term).toBe(JournalTerm);
    expect(template.Post).toBe(JournalPost);
    expect(template.Page).toBe(JournalPage);
    expect(template.Archive).toBe(JournalArchive);
  });

  it('renders a warm introduction, recent entries and a chronological timeline', () => {
    const html = render(<JournalHome dataset={dataset} />, { kind: 'home' }, journalConfig, 'journal');
    expect(html).toContain('qms-template--journal');
    expect(html).toContain('journal-hero');
    expect(html).toContain(dataset.site.tagline);
    expect(html).toContain(dataset.site.description);
    expect(html).toContain('Recent entries');
    expect(html).toContain('Journal timeline');
    expect(html).toContain('Hello Qortal');
    expect(html).toContain('News');
    expect(html).toContain('Introduction');
    expect(html).toContain('/arbitrary/IMAGE/QortalDemo/qms-fixture-image-hero');
    expect((html.match(/<h1/g) || []).length).toBe(1);
  });

  it('renders the journal index and a topic view as a timeline', () => {
    const index = render(<JournalPosts dataset={dataset} page={1} />, { kind: 'posts', page: 1 }, journalConfig, 'journal');
    expect(index).toContain('<h1>Entries</h1>');
    expect(index).toContain('journal-timeline');
    expect(index).toContain('Hello Qortal');
    const topic = render(<JournalTerm dataset={dataset} kind="category" slug="news" page={1} />, { kind: 'category', slug: 'news', page: 1 }, journalConfig, 'journal');
    expect(topic).toContain('<h1>News</h1>');
    expect(topic).toContain('journal-entry');
  });

  it('renders a journal-style article with comfortable reading content and tags', () => {
    const item = dataset.posts.find((entry) => entry.slug === 'hello-qortal') || null;
    const html = render(
      <JournalPost dataset={dataset} item={item} content={helloContent} loading={false} error="" onRetry={() => undefined} previous={null} next={null} />,
      { kind: 'post', slug: 'hello-qortal' },
      journalConfig,
      'journal'
    );
    expect(html).toContain('journal-article');
    expect(html).toContain('journal-article__body');
    expect(html).toContain('Hello Qortal');
    expect(html).toContain('href="#/category/news"');
    expect(html).toContain('journal-tags');
    expect((html.match(/<h1/g) || []).length).toBe(1);
  });

  it('renders CMS pages and the journal archive wrapper', () => {
    const item = dataset.pages.find((entry) => entry.slug === 'about') || null;
    const page = render(
      <JournalPage dataset={dataset} item={item} content={aboutContent} loading={false} error="" onRetry={() => undefined} />,
      { kind: 'page', slug: 'about' },
      journalConfig,
      'journal'
    );
    expect(page).toContain('journal-page');
    expect(page).toContain('journal-article__body');
    expect(page).toContain(aboutContent.title);
    const archive = render(<JournalArchive dataset={dataset} page={1} />, { kind: 'archive', page: 1 }, journalConfig, 'journal');
    expect(archive).toContain('journal-archive');
    expect(archive).toContain('All years');
    expect((page.match(/<h1/g) || []).length).toBe(1);
  });
});

describe('public footer privacy', () => {
  it('renders only footer text and attribution, never update checks or the template version', () => {
    const html = renderToStaticMarkup(
      <SiteFooter config={{ ...cmsConfig, site: { ...cmsConfig.site, footerText: 'Owner footer' } }} />
    );
    expect(html).toContain('Owner footer');
    expect(html).toContain('Qortal Migration Studio CMS');
    expect(html).not.toContain('Check for updates');
    expect(html).not.toContain('Template v');
  });
});

describe('template selection in appearance settings', () => {
  it('defaults the settings draft to the Default template', () => {
    const draft = defaultSettingsDraft(cmsConfig);
    expect(draft.appearance.template).toBe('default');
  });

  it('merges a stored template selection without touching content or admin fields', () => {
    const merged = mergeSettingsIntoConfig(cmsConfig, {
      site: { ...cmsConfig.site },
      navigation: cmsConfig.navigation.map((item) => ({ label: item.label, href: item.href })),
      appearance: { template: 'magazine' },
      theme: { colors: {} }
    }, { qdnName: 'QortalDemo' });
    expect(merged.appearance.template).toBe('magazine');
    expect(merged.content).toEqual(cmsConfig.content);
    expect(merged.admin).toEqual(cmsConfig.admin);
  });

  it('accepts the Personal Journal template in appearance settings', () => {
    const draft = defaultSettingsDraft(cmsConfig);
    draft.appearance.template = 'journal';
    expect(validateSettingsDraft(draft).ok).toBe(true);
    const merged = mergeSettingsIntoConfig(cmsConfig, draft, { qdnName: 'QortalDemo' });
    expect(merged.appearance.template).toBe('journal');
  });

  it('accepts the Video template in appearance settings', () => {
    const draft = defaultSettingsDraft(cmsConfig);
    draft.appearance.template = 'video';
    expect(validateSettingsDraft(draft).ok).toBe(true);
    const merged = mergeSettingsIntoConfig(cmsConfig, draft, { qdnName: 'QortalDemo' });
    expect(merged.appearance.template).toBe('video');
  });

  it('accepts the Business template in appearance settings', () => {
    const draft = defaultSettingsDraft(cmsConfig);
    draft.appearance.template = 'business';
    expect(validateSettingsDraft(draft).ok).toBe(true);
    const merged = mergeSettingsIntoConfig(cmsConfig, draft, { qdnName: 'QortalDemo' });
    expect(merged.appearance.template).toBe('business');
  });

  it('accepts the Photography template in appearance settings', () => {
    const draft = defaultSettingsDraft(cmsConfig);
    draft.appearance.template = 'gallery';
    expect(validateSettingsDraft(draft).ok).toBe(true);
    const merged = mergeSettingsIntoConfig(cmsConfig, draft, { qdnName: 'QortalDemo' });
    expect(merged.appearance.template).toBe('gallery');
  });

  it('accepts the Documentation template in appearance settings', () => {
    const draft = defaultSettingsDraft(cmsConfig);
    draft.appearance.template = 'docs';
    expect(validateSettingsDraft(draft).ok).toBe(true);
    const merged = mergeSettingsIntoConfig(cmsConfig, draft, { qdnName: 'QortalDemo' });
    expect(merged.appearance.template).toBe('docs');
  });

  it('keeps the configured template when older settings have no appearance field', () => {
    const config = { ...cmsConfig, appearance: { template: 'magazine' } };
    const merged = mergeSettingsIntoConfig(config, {
      site: { ...config.site },
      navigation: config.navigation.map((item) => ({ label: item.label, href: item.href })),
      theme: { colors: {} }
    }, { qdnName: 'QortalDemo' });
    expect(merged.appearance.template).toBe('magazine');
  });
});
