import type { ComponentType } from 'react';
import type { AppRoute, CmsDataset, CmsContentItem, LoadedContent, SectionsDocument } from '../types';

export interface TemplateHomeProps {
  dataset: CmsDataset;
  sections?: SectionsDocument | null;
}

export interface TemplatePostsProps {
  dataset: CmsDataset;
  page: number;
}

export interface TemplateTermProps {
  dataset: CmsDataset;
  kind: 'category' | 'tag';
  slug: string;
  page: number;
}

export interface TemplateArchiveProps {
  dataset: CmsDataset;
  year?: number;
  month?: number;
  page: number;
}

export interface TemplateSearchProps {
  dataset: CmsDataset;
  query: string;
  loadSearchIndex?: () => Promise<any>;
}

export interface TemplatePostProps {
  dataset: CmsDataset;
  item: CmsContentItem | null;
  content: LoadedContent | null;
  loading: boolean;
  error: string;
  onRetry: () => void;
  previous: CmsContentItem | null;
  next: CmsContentItem | null;
  highlightTerms?: string[];
}

export interface TemplatePageProps {
  dataset: CmsDataset;
  item: CmsContentItem | null;
  content: LoadedContent | null;
  loading: boolean;
  error: string;
  onRetry: () => void;
  highlightTerms?: string[];
  sections?: SectionsDocument | null;
  pageNumber?: number;
}

export interface SiteTemplate {
  id: string;
  label: string;
  description: string;
  Home: ComponentType<TemplateHomeProps>;
  Posts: ComponentType<TemplatePostsProps>;
  Term: ComponentType<TemplateTermProps>;
  Archive: ComponentType<TemplateArchiveProps>;
  Search: ComponentType<TemplateSearchProps>;
  Post: ComponentType<TemplatePostProps>;
  Page: ComponentType<TemplatePageProps>;
}

export type TemplateRoute = AppRoute;
