import { useEffect, useMemo, useState } from 'react';
import { Layout } from './components/Layout';
import { StateNotice } from './components/StateNotice';
import { AdminPage } from './pages/AdminPage';
import { ArchivePage } from './pages/ArchivePage';
import { HomePage } from './pages/HomePage';
import { NotFoundPage } from './pages/NotFoundPage';
import { PageView } from './pages/PageView';
import { PostPage } from './pages/PostPage';
import { PostsPage } from './pages/PostsPage';
import { SearchPage } from './pages/SearchPage';
import { TermPage } from './pages/TermPage';
import { baseCmsConfig, loadRuntimeCmsConfig, templateVersion } from './config/cmsConfig';
import { useHashRoute } from './hooks/useHashRoute';
import { applyAdoption, readAdoptionQueue, removeAdoption, writeAdoptionQueue } from './lib/adoption.js';
import { previousAndNext } from './lib/archive.js';
import { createCmsRepository } from './lib/repository.js';
import { routeKey } from './lib/routes.js';
import { discoverQdnName, resolveViewerIdentity } from './lib/qortal.js';
import type { AdoptionRecord, AppRoute, CmsContentItem, CmsDataset, LoadedContent, ViewerIdentity } from './types';

function titleForRoute(route: AppRoute): string {
  if (route.kind === 'home') return '';
  if (route.kind === 'posts') return 'Posts';
  if (route.kind === 'post') return 'Post';
  if (route.kind === 'page') return 'Page';
  if (route.kind === 'category') return 'Category';
  if (route.kind === 'tag') return 'Tag';
  if (route.kind === 'archive') return 'Archive';
  if (route.kind === 'search') return 'Search';
  if (route.kind === 'admin') return 'Admin and import';
  return 'Page not found';
}

export function App() {
  const route = useHashRoute();
  const [cmsConfig, setCmsConfig] = useState(baseCmsConfig);
  const [configNotice, setConfigNotice] = useState('');
  const repository = useMemo(() => createCmsRepository(cmsConfig), [cmsConfig]);
  const [dataset, setDataset] = useState<CmsDataset | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadToken, setReloadToken] = useState(0);
  const [identity, setIdentity] = useState<ViewerIdentity | null>(null);
  const [identityLoading, setIdentityLoading] = useState(true);
  const [identityNotice, setIdentityNotice] = useState('');
  const [detailItem, setDetailItem] = useState<CmsContentItem | null>(null);
  const [detailContent, setDetailContent] = useState<LoadedContent | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [detailRetry, setDetailRetry] = useState(0);
  const [adoptionQueue, setAdoptionQueue] = useState<AdoptionRecord[]>([]);

  useEffect(() => {
    let cancelled = false;
    loadRuntimeCmsConfig().then((loaded) => {
      if (cancelled) return;
      setCmsConfig(loaded.config);
      setConfigNotice(loaded.notice);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    repository.loadDataset(reloadToken > 0)
      .then((next) => {
        if (!cancelled) {
          setDataset(next);
          setLoading(false);
        }
      })
      .catch((error: Error) => {
        if (!cancelled) {
          setLoading(false);
          setDataset({
            state: 'error',
            source: 'error',
            site: {
              id: cmsConfig.site.id,
              title: cmsConfig.site.title,
              tagline: cmsConfig.site.tagline,
              description: cmsConfig.site.description,
              ownerName: cmsConfig.site.ownerName,
              publicAuthor: cmsConfig.site.publicAuthor
            },
            manifest: null,
            generatedAt: null,
            loadedAt: new Date().toISOString(),
            message: error.message,
            notices: [{ code: 'catalog-load-failed', level: 'error', message: error.message }],
            availability: { posts: false, pages: false, categories: false, tags: false },
            posts: [],
            pages: [],
            categories: [],
            tags: [],
            media: [],
            urls: { bySourceUrl: {} }
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [reloadToken, repository]);

  useEffect(() => {
    let cancelled = false;
    setIdentityLoading(true);
    setIdentityNotice('');
    (resolveViewerIdentity({ qdnName: discoverQdnName(cmsConfig.admin.qdnName || '') }) as Promise<ViewerIdentity>)
      .then((next) => {
        if (!cancelled) {
          setIdentity(next);
          setIdentityLoading(false);
        }
      })
      .catch((error: Error) => {
        if (!cancelled) {
          setIdentityNotice(error.message);
          setIdentity(null);
          setIdentityLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
    // The runtime qms-cms-config.json can supply admin.qdnName after first paint;
    // re-resolve identity so owner mode is not stuck on the build-time default.
  }, [cmsConfig.admin.qdnName]);

  useEffect(() => {
    const siteId = dataset ? dataset.site.id : cmsConfig.site.id;
    setAdoptionQueue(readAdoptionQueue(typeof localStorage === 'undefined' ? null : localStorage, siteId));
  }, [dataset?.site.id]);

  useEffect(() => {
    if (!dataset || (route.kind !== 'post' && route.kind !== 'page')) {
      setDetailItem(null);
      setDetailContent(null);
      setDetailLoading(false);
      setDetailError('');
      return;
    }
    let cancelled = false;
    const kind = route.kind;
    const slug = route.slug;
    setDetailLoading(true);
    setDetailError('');
    setDetailContent(null);
    setDetailItem(null);
    (async () => {
      try {
        const item = kind === 'post' ? await repository.findPost(slug) : await repository.findPage(slug);
        if (cancelled) return;
        setDetailItem(item);
        if (!item) {
          setDetailLoading(false);
          return;
        }
        const content = await repository.loadContent(item);
        if (!cancelled) {
          setDetailContent(content);
          setDetailLoading(false);
        }
      } catch (error) {
        if (!cancelled) {
          setDetailError(error instanceof Error ? error.message : String(error));
          setDetailLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dataset, route.kind, route.kind === 'post' || route.kind === 'page' ? route.slug : '', detailRetry, repository]);

  useEffect(() => {
    const label = titleForRoute(route);
    document.title = label ? label + ' | ' + cmsConfig.site.title : cmsConfig.site.title;
  }, [routeKey(route)]);

  const site = dataset ? dataset.site : {
    id: cmsConfig.site.id,
    title: cmsConfig.site.title,
    tagline: cmsConfig.site.tagline,
    description: cmsConfig.site.description,
    ownerName: cmsConfig.site.ownerName,
    publicAuthor: cmsConfig.site.publicAuthor
  };

  const adopt = (items: CmsContentItem[]) => {
    const siteId = dataset ? dataset.site.id : cmsConfig.site.id;
    const result = applyAdoption(adoptionQueue, { siteId, items, identity });
    if (result.ok) {
      setAdoptionQueue(result.queue);
      writeAdoptionQueue(typeof localStorage === 'undefined' ? null : localStorage, siteId, result.queue);
      return { ok: true, message: 'Adopted ' + result.adopted.length + ' item(s) into the local queue.' };
    }
    return { ok: false, message: result.message };
  };

  const remove = (key: string) => {
    const siteId = dataset ? dataset.site.id : cmsConfig.site.id;
    const result = removeAdoption(adoptionQueue, key, identity);
    if (result.ok) {
      setAdoptionQueue(result.queue);
      writeAdoptionQueue(typeof localStorage === 'undefined' ? null : localStorage, siteId, result.queue);
    }
  };

  function renderPage() {
    if (!dataset) return null;
    if (route.kind === 'home') return <HomePage dataset={dataset} />;
    if (route.kind === 'posts') return <PostsPage dataset={dataset} page={route.page} />;
    if (route.kind === 'category') return <TermPage dataset={dataset} kind="category" slug={route.slug} page={route.page} />;
    if (route.kind === 'tag') return <TermPage dataset={dataset} kind="tag" slug={route.slug} page={route.page} />;
    if (route.kind === 'archive') return <ArchivePage dataset={dataset} year={route.year} month={route.month} page={route.page} />;
    if (route.kind === 'search') return <SearchPage dataset={dataset} query={route.query} />;
    if (route.kind === 'post') {
      const item = dataset.posts.find((entry) => entry.slug === route.slug) || null;
      const related = previousAndNext(dataset.posts, route.slug);
      return (
        <PostPage
          dataset={dataset}
          item={item}
          content={detailContent}
          loading={detailLoading}
          error={detailError}
          onRetry={() => setDetailRetry((value) => value + 1)}
          previous={related.previous}
          next={related.next}
        />
      );
    }
    if (route.kind === 'page') {
      const item = dataset.pages.find((entry) => entry.slug === route.slug) || null;
      return (
        <PageView
          dataset={dataset}
          item={item}
          content={detailContent}
          loading={detailLoading}
          error={detailError}
          onRetry={() => setDetailRetry((value) => value + 1)}
        />
      );
    }
    return <NotFoundPage />;
  }

  const showGlobalNotice = dataset && (dataset.state === 'partial' || dataset.state === 'stale');
  const adminRequested = route.kind === 'admin';

  return (
    <Layout config={cmsConfig} route={route} viewer={identity} viewerLoading={identityLoading} templateVersion={templateVersion}>
      {adminRequested ? (
        <AdminPage
          dataset={dataset}
          loading={loading}
          identity={identity}
          identityLoading={identityLoading}
          identityNotice={identityNotice}
          adoptionQueue={adoptionQueue}
          onAdopt={adopt}
          onRemove={remove}
          onRefresh={() => setReloadToken((value) => value + 1)}
        />
      ) : loading && !dataset ? (
        <div className="page" aria-busy="true">
          <StateNotice state="loading" title="Loading the QDN catalog..." message="Reading the manifest and indexes from QDN." />
        </div>
      ) : dataset && dataset.state === 'error' ? (
        <div className="page">
          <h1>{site.title}</h1>
          <StateNotice state="error" title="The catalog could not be loaded" message={dataset.message} notices={dataset.notices} />
          <button type="button" className="button" onClick={() => setReloadToken((value) => value + 1)}>Retry</button>
        </div>
      ) : (
        <>
          {showGlobalNotice ? <StateNotice state={dataset.state === 'partial' ? 'partial' : 'stale'} notices={dataset.notices} compact /> : null}
          {renderPage()}
        </>
      )}
    </Layout>
  );
}
