import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CheckCircle2, Play, Send, XCircle } from 'lucide-react';
import { CONTENT_BASE, getRouteParams } from '../contentApi';
import { getQortalBridgeDiagnostics, hasQortalBridge, requestQortal } from '../qortalClient';
import { formatBytes } from '../contentApi';

interface PublishResource {
  type: string;
  service: string;
  identifier: string;
  local_path: string;
  source_url?: string;
  bytes?: number;
}

interface PublishPlan {
  resources: {
    posts: PublishResource[];
    pages: PublishResource[];
    indexes: PublishResource[];
    media: PublishResource[];
  };
}

interface PublishRow extends PublishResource {
  status: 'pending' | 'publishing' | 'published' | 'failed';
  message: string;
}

type PublishMode = 'demo' | 'cms-json' | 'full';

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(`${CONTENT_BASE}/${path}`);
  if (!response.ok) {
    throw new Error(`Failed to load ${path}: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

function toBase64(value: string): string {
  return btoa(unescape(encodeURIComponent(value)));
}

function resourceTitle(resource: PublishResource): string {
  if (resource.type === 'post') return 'Imported WordPress post';
  if (resource.type === 'page') return 'Imported WordPress page';
  if (resource.type === 'image') return 'Imported WordPress image';
  if (resource.identifier === 'cr-qdn-manifest') return 'QDN loader manifest';
  if (resource.identifier === 'cr-posts-index') return 'Posts index';
  if (resource.identifier === 'cr-pages-index') return 'Pages index';
  if (resource.identifier === 'cr-categories') return 'Categories';
  if (resource.identifier === 'cr-tags') return 'Tags';
  if (resource.identifier === 'cr-media-map') return 'Media map';
  return resource.identifier;
}

function toRows(resources: PublishResource[]): PublishRow[] {
  const seen = new Set<string>();
  return resources
    .filter((resource) => {
      const key = `${resource.service}:${resource.identifier}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((resource) => ({
      ...resource,
      status: 'pending',
      message: ''
    }));
}

function createRows(plan: PublishPlan, mode: PublishMode): PublishRow[] {
  const firstPost = plan.resources.posts[0];
  const firstImage = plan.resources.media.find((resource) => resource.type === 'image');
  const coreIndexes = ['cr-qdn-manifest', 'cr-posts-index', 'cr-pages-index', 'cr-categories', 'cr-tags', 'cr-media-map', 'cr-url-map']
    .map((identifier) => plan.resources.indexes.find((resource) => resource.identifier === identifier))
    .filter(Boolean) as PublishResource[];

  if (mode === 'demo') {
    return toRows([...(firstImage ? [firstImage] : []), firstPost, ...coreIndexes].filter(Boolean) as PublishResource[]);
  }

  if (mode === 'cms-json') {
    return toRows([...(firstImage ? [firstImage] : []), ...plan.resources.posts, ...plan.resources.pages, ...coreIndexes]);
  }

  return toRows([...plan.resources.posts, ...plan.resources.pages, ...plan.resources.indexes, ...plan.resources.media]);
}

export function PublisherPage({ initialName = '', onBack }: { initialName?: string; onBack?: () => void }) {
  const params = getRouteParams();
  const routeName = params.get('name') || params.get('qdnName') || '';
  const resolvedInitialName = initialName || routeName || import.meta.env.VITE_QDN_NAME || '';
  const [qortalName, setQortalName] = useState(resolvedInitialName);
  const [plan, setPlan] = useState<PublishPlan | null>(null);
  const [mode, setMode] = useState<PublishMode>('cms-json');
  const [rows, setRows] = useState<PublishRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isPublishing, setIsPublishing] = useState(false);
  const hasBridge = hasQortalBridge();
  const bridgeDiagnostics = getQortalBridgeDiagnostics();

  useEffect(() => {
    fetchJson<PublishPlan>('publish-log/publish-plan.json')
      .then((loadedPlan) => {
        setPlan(loadedPlan);
        setRows(createRows(loadedPlan, mode));
      })
      .catch((loadError: Error) => setError(loadError.message));
  }, [mode]);

  function changeMode(nextMode: PublishMode) {
    setMode(nextMode);
    if (plan) setRows(createRows(plan, nextMode));
  }

  const summary = useMemo(() => {
    const bytes = rows.reduce((sum, row) => sum + (row.bytes || 0), 0);
    return {
      count: rows.length,
      bytes,
      published: rows.filter((row) => row.status === 'published').length,
      failed: rows.filter((row) => row.status === 'failed').length
    };
  }, [rows]);

  function updateRow(identifier: string, patch: Partial<PublishRow>) {
    setRows((current) =>
      current.map((row) => (row.identifier === identifier ? { ...row, ...patch } : row))
    );
  }

  async function publishResource(resource: PublishRow) {
    updateRow(resource.identifier, { status: 'publishing', message: '' });

    if (resource.service === 'DOCUMENT' || resource.service === 'JSON') {
      const response = await fetch(`${CONTENT_BASE}/${resource.local_path}`);
      const content = await response.text();
      await requestQortal({
        action: 'PUBLISH_QDN_RESOURCE',
        name: qortalName,
        service: resource.service,
        identifier: resource.identifier,
        data64: toBase64(content),
        encoding: 'base64',
        title: resourceTitle(resource),
        description: `WordPress to Qortal demo resource: ${resource.identifier}`
      });
      updateRow(resource.identifier, { status: 'published', message: 'Published' });
      return;
    }

    const response = await fetch(`${CONTENT_BASE}/${resource.local_path}`);
    const blob = await response.blob();
    const filename = resource.local_path.split('/').pop() || resource.identifier;
    const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' });

    await requestQortal({
      action: 'PUBLISH_QDN_RESOURCE',
      name: qortalName,
      service: resource.service,
      identifier: resource.identifier,
      file,
      filename,
      title: resourceTitle(resource),
      description: `WordPress to Qortal demo media: ${resource.identifier}`
    });
    updateRow(resource.identifier, { status: 'published', message: 'Published' });
  }

  async function publishAll() {
    setIsPublishing(true);
    setError(null);

    for (const row of rows) {
      try {
        await publishResource(row);
      } catch (publishError) {
        updateRow(row.identifier, {
          status: 'failed',
          message: (publishError as Error).message
        });
        break;
      }
    }

    setIsPublishing(false);
  }

  return (
    <main className="publisher-shell">
      <section className="publisher-header">
        {onBack && (
          <button type="button" className="back-button" onClick={onBack}>
            <ArrowLeft size={17} />
            Back to preview
          </button>
        )}
        <p className="eyebrow">WordPress to Qortal</p>
        <h1>Migration Publisher</h1>
        <div className="publisher-controls">
          <label>
            Qortal name
            <input value={qortalName} onChange={(event) => setQortalName(event.target.value)} />
          </label>
          <button type="button" disabled={!hasBridge || isPublishing || !qortalName.trim()} onClick={publishAll}>
            <Send size={17} />
            Publish selected set
          </button>
        </div>
        <div className="publisher-modes">
          <button type="button" className={mode === 'demo' ? 'active' : ''} onClick={() => changeMode('demo')}>
            Demo
          </button>
          <button type="button" className={mode === 'cms-json' ? 'active' : ''} onClick={() => changeMode('cms-json')}>
            CMS JSON
          </button>
          <button type="button" className={mode === 'full' ? 'active' : ''} onClick={() => changeMode('full')}>
            Full media
          </button>
        </div>
        <div className="publisher-summary">
          <span>{summary.count} resources</span>
          <span>{formatBytes(summary.bytes)}</span>
          <span>{summary.published} published</span>
          <span>{summary.failed} failed</span>
        </div>
        <p className="publisher-note">
          Demo publishes a small smoke-test set. CMS JSON publishes imported posts, pages, and indexes. Full media publishes every planned resource, including downloaded media files.
        </p>
        {!hasBridge && (
          <p className="publisher-warning">
            Qortal request API is not available in this browser context. Bridge checks:
            {` window=${bridgeDiagnostics.window}, globalThis=${bridgeDiagnostics.globalThis}, parent=${bridgeDiagnostics.parent}, top=${bridgeDiagnostics.top}, opener=${bridgeDiagnostics.opener}, injected=${bridgeDiagnostics.injectedGlobal}`}
          </p>
        )}
        {error && <p className="publisher-warning">{error}</p>}
      </section>

      <section className="publisher-list">
        {rows.map((row) => (
          <article key={row.identifier} className="publisher-row">
            <div>
              <strong>{row.identifier}</strong>
              <span>
                {row.service} · {row.type} · {row.local_path}
              </span>
            </div>
            <div className="publisher-status">
              {row.status === 'published' && <CheckCircle2 size={18} />}
              {row.status === 'failed' && <XCircle size={18} />}
              {row.status === 'publishing' && <Play size={18} />}
              <span>{row.message || row.status}</span>
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}
