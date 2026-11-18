import { normalizeTemplateId } from '../lib/template.js';
import { defaultTemplate } from './default';
import { PortfolioHome, PortfolioPosts, PortfolioTerm, PortfolioPost, PortfolioPage } from './portfolio';
import { DocsHome, DocsPosts, DocsTerm, DocsPost, DocsPage, DocsSearch, DocsArchive } from './docs';
import { GalleryHome, GalleryPosts, GalleryTerm, GalleryPost, GalleryPage } from './gallery';
import { BusinessHome, BusinessPosts, BusinessTerm, BusinessPost, BusinessPage } from './business';
import { VideoHome, VideoPosts, VideoTerm, VideoPost, VideoPage } from './video';
import { JournalHome, JournalPosts, JournalTerm, JournalPost, JournalPage, JournalArchive } from './journal';
import { MagazineHome, MagazinePosts, MagazineTerm, MagazinePost, MagazinePage } from './magazine';
import type { SiteTemplate } from './types';

/**
 * The single place that knows which templates exist. Adding a design means
 * adding one entry here plus its components and stylesheet; the CMS core does
 * not change.
 */
export const siteTemplates: Record<string, SiteTemplate> = {
  default: defaultTemplate,
  magazine: {
    id: 'magazine',
    label: 'Magazine / News',
    description: 'Editorial front page with a featured story, image-led cards, category strips and a responsive news grid.',
    Home: MagazineHome,
    Posts: MagazinePosts,
    Term: MagazineTerm,
    Post: MagazinePost,
    Page: MagazinePage,
    // Archive and search keep the CMS behaviour (pagination, sanitizing and
    // query highlighting) and receive magazine styling from CSS.
    Archive: defaultTemplate.Archive,
    Search: defaultTemplate.Search
  },
  portfolio: {
    id: 'portfolio',
    label: 'Portfolio',
    description: 'Image-led project gallery with a large introduction, about and contact sections, and consistent project pages.',
    Home: PortfolioHome,
    Posts: PortfolioPosts,
    Term: PortfolioTerm,
    Post: PortfolioPost,
    Page: PortfolioPage,
    // Archive and search keep the shared CMS behaviour and receive the
    // portfolio typography through scoped CSS.
    Archive: defaultTemplate.Archive,
    Search: defaultTemplate.Search
  },
  docs: {
    id: 'docs',
    label: 'Documentation / Knowledge Base',
    description: 'Clean documentation layout with a category sidebar, guide index, technical article pages and integrated search.',
    Home: DocsHome,
    Posts: DocsPosts,
    Term: DocsTerm,
    Post: DocsPost,
    Page: DocsPage,
    Search: DocsSearch,
    Archive: DocsArchive
  },
  gallery: {
    id: 'gallery',
    label: 'Photography / Gallery',
    description: 'Image-first gallery with a full-bleed hero, masonry photographs, album collections and distraction-free articles.',
    Home: GalleryHome,
    Posts: GalleryPosts,
    Term: GalleryTerm,
    Post: GalleryPost,
    Page: GalleryPage,
    // Archive and search keep the shared CMS behaviour.
    Archive: defaultTemplate.Archive,
    Search: defaultTemplate.Search
  },
  business: {
    id: 'business',
    label: 'Business / Services',
    description: 'Professional business layout with services, company introduction, completed projects, contact sections and consistent service pages.',
    Home: BusinessHome,
    Posts: BusinessPosts,
    Term: BusinessTerm,
    Post: BusinessPost,
    Page: BusinessPage,
    // Archive and search keep the shared CMS behaviour.
    Archive: defaultTemplate.Archive,
    Search: defaultTemplate.Search
  },
  video: {
    id: 'video',
    label: 'Video / Media',
    description: 'Cinematic video library with a featured player, series collections, thumbnail gallery and embedded playback on video pages.',
    Home: VideoHome,
    Posts: VideoPosts,
    Term: VideoTerm,
    Post: VideoPost,
    Page: VideoPage,
    // Archive and search keep the shared CMS behaviour.
    Archive: defaultTemplate.Archive,
    Search: defaultTemplate.Search
  },
  journal: {
    id: 'journal',
    label: 'Personal Journal',
    description: 'Warm personal journal with an introduction, recent entries, a chronological timeline, topics and calm reading pages.',
    Home: JournalHome,
    Posts: JournalPosts,
    Term: JournalTerm,
    Post: JournalPost,
    Page: JournalPage,
    Archive: JournalArchive,
    Search: defaultTemplate.Search
  }
};

export function getSiteTemplate(id: unknown): SiteTemplate {
  const key = normalizeTemplateId(id);
  return siteTemplates[key] || siteTemplates.default;
}
