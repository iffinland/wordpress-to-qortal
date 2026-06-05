import { useEffect, useMemo, useState } from 'react';
import { PublicLayout } from '../components/layout/PublicLayout';
import { contentRepository } from '../data/contentRepository';
import { createSearchIndex } from '../data/searchIndex';
import { ArticlePage } from '../pages/ArticlePage';
import { CategoryPage } from '../pages/CategoryPage';
import { CmsBackendApp } from '../cms/CmsBackendApp';
import { MemberDashboardPage } from '../pages/MemberDashboardPage';
import { NotFoundPage } from '../pages/NotFoundPage';
import { PublicHomePage } from '../pages/PublicHomePage';
import { StaticPage } from '../pages/StaticPage';
import type { ContentPost, PublicPage, SiteDataset } from '../types/content';
import { useHashRoute } from './useHashRoute';

export function App() {
  const route = useHashRoute();
  const [dataset, setDataset] = useState<SiteDataset | null>(null);
  const [detailPost, setDetailPost] = useState<ContentPost | null>(null);
  const [detailPage, setDetailPage] = useState<PublicPage | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (route.kind === 'admin') return;
    setError('');
    contentRepository.loadDataset(true).then(setDataset).catch((loadError: Error) => setError(loadError.message));
  }, [route.kind === 'admin']);

  useEffect(() => {
    let cancelled = false;
    if (route.kind !== 'post' && route.kind !== 'page') {
      setDetailPost(null);
      setDetailPage(null);
      setDetailLoading(false);
      return;
    }

    setDetailLoading(true);
    const request = route.kind === 'post'
      ? contentRepository.findPost(route.slug).then((post) => {
        if (!cancelled) setDetailPost(post);
      })
      : contentRepository.findPage(route.slug).then((page) => {
        if (!cancelled) setDetailPage(page);
      });

    request
      .catch((loadError: Error) => {
        if (!cancelled) setError(loadError.message);
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [route.kind, route.kind === 'post' || route.kind === 'page' ? route.slug : '']);

  const searchIndex = useMemo(() => dataset ? createSearchIndex(dataset) : [], [dataset]);

  if (route.kind === 'admin') return <CmsBackendApp adminOnly />;
  if (error) return <div className="app-message error">{error}</div>;
  if (!dataset) return <div className="app-message">Loading The Corbett Report...</div>;

  function renderPage() {
    if (route.kind === 'home') return <PublicHomePage dataset={dataset!} />;
    if (route.kind === 'category') return <CategoryPage slug={route.slug} posts={dataset!.posts} />;
    if (route.kind === 'tag') return <CategoryPage slug={route.slug} posts={dataset!.posts} taxonomy="tag" />;
    if (route.kind === 'post') {
      if (detailLoading) return <div className="app-message">Loading article...</div>;
      return detailPost ? <ArticlePage post={detailPost} /> : <NotFoundPage />;
    }
    if (route.kind === 'page') {
      if (detailLoading) return <div className="app-message">Loading page...</div>;
      return detailPage ? <StaticPage page={detailPage} /> : <NotFoundPage />;
    }
    if (route.kind === 'member') return <MemberDashboardPage />;
    return <NotFoundPage />;
  }

  return <PublicLayout searchIndex={searchIndex}>{renderPage()}</PublicLayout>;
}
