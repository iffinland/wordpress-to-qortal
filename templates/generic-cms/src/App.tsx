import { useEffect, useMemo, useState } from 'react';
import { Layout } from './components/Layout';
import { StateNotice } from './components/StateNotice';
import { AdminPage } from './pages/AdminPage';
import { ArchivePage } from './pages/ArchivePage';
import { GalleryPage } from './pages/GalleryPage';
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
import { discoverHostedQdnName, revalidateViewerIdentity, resolveViewerIdentity } from './lib/qortal.js';
import { applyThemeToDocument, readStoredTheme, resolveThemeMode, writeStoredTheme } from './lib/theme.js';
import { loadPublishedSettings, applyPublishedSettings } from './lib/authoring.js';
import { removeTemplatePlaceholders } from './lib/settings.js';
import type { AdoptionRecord, AppRoute, CmsContentItem, CmsDataset, Gallery, LoadedContent, ViewerIdentity } from './types';

function titleForRoute(route: AppRoute): string {
  if (route.kind === 'home') return '';
  if (route.kind === 'posts') return 'Posts';
  if (route.kind === 'post') return 'Post';
  if (route.kind === 'page') return 'Page';
  if (route.kind === 'category') return 'Category';
  if (route.kind === 'tag') return 'Tag';
  if (route.kind === 'archive') return 'Archive';
  if (route.kind === 'search') return 'Search';
  if (route.kind === 'gallery') return 'Galleries';
  if (route.kind === 'admin') return 'Admin';
  return 'Page not found';
}

export function App() {
  const route = useHashRoute();
  const [cmsConfig, setCmsConfig] = useState(baseCmsConfig);
  const [configNotice, setConfigNotice] = useState('');
  const [publishedSettings, setPublishedSettings] = useState<unknown>(null);
  const [previewSettings, setPreviewSettings] = useState<unknown>(null);
  const [themeMode, setThemeMode] = useState<'light' | 'dark' | 'system'>(() => readStoredTheme(typeof localStorage === 'undefined' ? null : localStorage) as any);
  const [prefersDark, setPrefersDark] = useState(true);
  const [identity, setIdentity] = useState<ViewerIdentity | null>(null);
  const [identityLoading, setIdentityLoading] = useState(true);
  const [identityNotice, setIdentityNotice] = useState('');
  const [dataset, setDataset] = useState<CmsDataset | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadToken, setReloadToken] = useState(0);
  const [galleries, setGalleries] = useState<Gallery[]>([]);
  const [galleriesLoading, setGalleriesLoading] = useState(true);
  const [adoptionQueue, setAdoptionQueue] = useState<AdoptionRecord[]>([]);
  const [detailItem, setDetailItem] = useState<CmsContentItem | null>(null);
  const [detailContent, setDetailContent] = useState<LoadedContent | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [detailRetry, setDetailRetry] = useState(0);

  const hostedName = useMemo(() => discoverHostedQdnName(cmsConfig.admin.qdnName || ''), [cmsConfig.admin.qdnName]);
  const effectiveConfig = useMemo(() => {
    const base = hostedName
      ? { ...cmsConfig, site: removeTemplatePlaceholders(cmsConfig.site, hostedName) }
      : cmsConfig;
    const withPublished = applyPublishedSettings(base, publishedSettings, hostedName);
    return applyPublishedSettings(withPublished, previewSettings, hostedName);
  }, [cmsConfig, publishedSettings, previewSettings, hostedName]);
  const repository = useMemo(() => createCmsRepository(effectiveConfig), [effectiveConfig]);

  useEffect(() => {
    let cancelled = false;
    loadRuntimeCmsConfig().then(async (loaded) => {
      if (cancelled) return;
      setCmsConfig(loaded.config);
      setConfigNotice(loaded.notice);
      const name = discoverHostedQdnName(loaded.config.admin.qdnName || '');
      const settings = await loadPublishedSettings(name);
      if (cancelled) return;
      if (settings.ok && settings.settings) setPublishedSettings(settings.settings);
      else if (!settings.ok) setConfigNotice((current) => current || 'Published settings could not be read: ' + settings.errors.join(' '));
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const media = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    setPrefersDark(media ? media.matches : true);
    const listener = (event: MediaQueryListEvent) => setPrefersDark(event.matches);
    if (media && media.addEventListener) media.addEventListener('change', listener);
    return () => { if (media && media.removeEventListener) media.removeEventListener('change', listener); };
  }, []);

  useEffect(() => {
    const resolved = applyThemeToDocument(document, themeMode, prefersDark);
    document.documentElement.setAttribute('data-theme', resolved);
    writeStoredTheme(typeof localStorage === 'undefined' ? null : localStorage, themeMode);
  }, [themeMode, prefersDark]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    repository.loadDataset(reloadToken > 0).then((next) => {
      if (!cancelled) { setDataset(next); setLoading(false); }
    }).catch((error: Error) => {
      if (!cancelled) {
        setLoading(false);
        setDataset({
          state: 'error', source: 'error',
          site: { id: cmsConfig.site.id, title: cmsConfig.site.title, tagline: cmsConfig.site.tagline, description: cmsConfig.site.description, ownerName: cmsConfig.site.ownerName, publicAuthor: cmsConfig.site.publicAuthor },
          manifest: null, generatedAt: null, loadedAt: new Date().toISOString(), message: error.message,
          notices: [{ code: 'catalog-load-failed', level: 'error', message: error.message }],
          availability: { posts: false, pages: false, categories: false, tags: false },
          posts: [], pages: [], categories: [], tags: [], media: [], urls: { bySourceUrl: {} }
        });
      }
    });
    return () => { cancelled = true; };
  }, [reloadToken, repository]);

  useEffect(() => {
    let cancelled = false;
    setGalleriesLoading(true);
    repository.loadGalleries().then((result) => {
      if (!cancelled) {
        setGalleries(result.ok ? result.catalog.galleries : []);
        setGalleriesLoading(false);
      }
    }).catch(() => { if (!cancelled) { setGalleries([]); setGalleriesLoading(false); } });
    return () => { cancelled = true; };
  }, [repository, reloadToken]);

  useEffect(() => {
    let cancelled = false;
    setIdentityLoading(true);
    setIdentityNotice('');
    (resolveViewerIdentity({ qdnName: hostedName }) as Promise<ViewerIdentity>).then((next) => {
      if (!cancelled) { setIdentity(next); setIdentityLoading(false); }
    }).catch((error: Error) => {
      if (!cancelled) { setIdentityNotice(error.message); setIdentity(null); setIdentityLoading(false); }
    });
    return () => { cancelled = true; };
  }, [hostedName]);

  useEffect(() => {
    const siteId = dataset ? dataset.site.id : cmsConfig.site.id;
    setAdoptionQueue(readAdoptionQueue(typeof localStorage === 'undefined' ? null : localStorage, siteId));
  }, [dataset?.site.id]);

  useEffect(() => {
    if (!dataset || (route.kind !== 'post' && route.kind !== 'page')) {
      setDetailItem(null); setDetailContent(null); setDetailLoading(false); setDetailError('');
      return;
    }
    let cancelled = false;
    const kind = route.kind;
    const slug = route.slug;
    setDetailLoading(true); setDetailError(''); setDetailContent(null); setDetailItem(null);
    (async () => {
      try {
        const item = kind === 'post' ? await repository.findPost(slug) : await repository.findPage(slug);
        if (cancelled) return;
        setDetailItem(item);
        if (!item) { setDetailLoading(false); return; }
        const content = await repository.loadContent(item);
        if (!cancelled) { setDetailContent(content); setDetailLoading(false); }
      } catch (error) {
        if (!cancelled) { setDetailError(error instanceof Error ? error.message : String(error)); setDetailLoading(false); }
      }
    })();
    return () => { cancelled = true; };
  }, [dataset, route.kind, route.kind === 'post' || route.kind === 'page' ? route.slug : '', detailRetry, repository]);

  useEffect(() => {
    const label = titleForRoute(route);
    document.title = label ? label + ' | ' + effectiveConfig.site.title : effectiveConfig.site.title;
  }, [routeKey(route), effectiveConfig.site.title]);

  const site = dataset ? dataset.site : {
    id: effectiveConfig.site.id, title: effectiveConfig.site.title, tagline: effectiveConfig.site.tagline,
    description: effectiveConfig.site.description, ownerName: effectiveConfig.site.ownerName, publicAuthor: effectiveConfig.site.publicAuthor
  };

  const authorize = async () => {
    const result = await revalidateViewerIdentity(identity);
    if (!result.ok) return { ok: false, message: result.message };
    setIdentity(result.identity as ViewerIdentity | null);
    return { ok: true, message: '' };
  };

  const adopt = async (items: CmsContentItem[]) => {
    const authorized = await authorize();
    if (!authorized.ok) return { ok: false, message: authorized.message };
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

  const refresh = () => setReloadToken((value) => value + 1);

  const loadContent = (item: CmsContentItem) => repository.loadContent(item);

  function renderPage() {
    if (!dataset) return null;
    if (route.kind === 'home') return <HomePage dataset={dataset} />;
    if (route.kind === 'posts') return <PostsPage dataset={dataset} page={route.page} />;
    if (route.kind === 'category') return <TermPage dataset={dataset} kind="category" slug={route.slug} page={route.page} />;
    if (route.kind === 'tag') return <TermPage dataset={dataset} kind="tag" slug={route.slug} page={route.page} />;
    if (route.kind === 'archive') return <ArchivePage dataset={dataset} year={route.year} month={route.month} page={route.page} />;
    if (route.kind === 'search') return <SearchPage dataset={dataset} query={route.query} />;
    if (route.kind === 'gallery') return <GalleryPage galleries={galleries} catalogLoading={galleriesLoading} slug={route.slug} />;
    if (route.kind === 'post') {
      const item = dataset.posts.find((entry) => entry.slug === route.slug) || null;
      const related = previousAndNext(dataset.posts, route.slug);
      return <PostPage dataset={dataset} item={item} content={detailContent} loading={detailLoading} error={detailError} onRetry={() => setDetailRetry((value) => value + 1)} previous={related.previous} next={related.next} />;
    }
    if (route.kind === 'page') {
      const item = dataset.pages.find((entry) => entry.slug === route.slug) || null;
      return <PageView dataset={dataset} item={item} content={detailContent} loading={detailLoading} error={detailError} onRetry={() => setDetailRetry((value) => value + 1)} />;
    }
    return <NotFoundPage />;
  }

  const showGlobalNotice = dataset && (dataset.state === 'partial' || dataset.state === 'stale');
  const adminRequested = route.kind === 'admin';
  const resolvedTheme = resolveThemeMode(themeMode, prefersDark);

  return (
    <Layout
      config={effectiveConfig}
      route={route}
      viewer={identity}
      viewerLoading={identityLoading}
      templateVersion={templateVersion}
      themeMode={themeMode}
      resolvedTheme={resolvedTheme}
      onThemeChange={(mode) => setThemeMode(mode)}
      hasGalleries={galleries.length > 0}
    >
      {adminRequested ? (
        <AdminPage
          dataset={dataset}
          loading={loading}
          identity={identity}
          identityLoading={identityLoading}
          identityNotice={identityNotice}
          adoptionQueue={adoptionQueue}
          section={route.section}
          initialEditorId={route.id}
          onAdopt={adopt}
          onRemove={remove}
          onRefresh={refresh}
          onAuthorize={authorize}
          settingsConfig={effectiveConfig}
          qdnName={hostedName}
          siteId={dataset ? dataset.site.id : effectiveConfig.site.id}
          remoteSettings={publishedSettings}
          onSettingsPreview={(draft) => setPreviewSettings(draft)}
          onSettingsPublished={(settings) => setPublishedSettings(settings)}
          galleries={galleries}
          galleriesLoading={galleriesLoading}
          loadContent={loadContent}
        />
      ) : loading && !dataset ? (
        <div className="page" aria-busy="true"><StateNotice state="loading" title="Loading the QDN catalog..." message="Reading the manifest and indexes from QDN." /></div>
      ) : dataset && dataset.state === 'error' ? (
        <div className="page"><h1>{site.title}</h1><StateNotice state="error" title="The catalog could not be loaded" message={dataset.message} notices={dataset.notices} /><button type="button" className="button" onClick={refresh}>Retry</button></div>
      ) : (
        <>
          {showGlobalNotice ? <StateNotice state={dataset.state === 'partial' ? 'partial' : 'stale'} notices={dataset.notices} compact /> : null}
          {configNotice ? <StateNotice state="partial" compact message={configNotice} /> : null}
          {renderPage()}
        </>
      )}
    </Layout>
  );
}

