import { HomePage } from '../pages/HomePage';
import { PostsPage } from '../pages/PostsPage';
import { TermPage } from '../pages/TermPage';
import { ArchivePage } from '../pages/ArchivePage';
import { SearchPage } from '../pages/SearchPage';
import { PostPage } from '../pages/PostPage';
import { PageView } from '../pages/PageView';
import type { SiteTemplate } from './types';

/**
 * The original QMS presentation. It intentionally reuses the existing public
 * pages unchanged so upgrading to the template registry cannot alter the
 * default site.
 */
export const defaultTemplate: SiteTemplate = {
  id: 'default',
  label: 'Default',
  description: 'The neutral QMS site layout: latest posts, categories, tags and the archive.',
  Home: HomePage,
  Posts: PostsPage,
  Term: TermPage,
  Archive: ArchivePage,
  Search: SearchPage,
  Post: PostPage,
  Page: PageView
};
