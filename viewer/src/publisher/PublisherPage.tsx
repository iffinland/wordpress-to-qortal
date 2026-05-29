import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CheckCircle2, Play, Send, XCircle } from 'lucide-react';
import { CONTENT_BASE, getRouteParams } from '../contentApi';
import { getQortalBridgeDiagnostics, hasQortalBridge, requestQortal } from '../qortalClient';
import { formatBytes } from '../contentApi';
import { APP_VERSION } from '../version';

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
type PublishSource = 'bundled' | 'folder';
type FolderFileMap = Map<string, File>;

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(`${CONTENT_BASE}/${path}`);
  if (!response.ok) {
    throw new Error(`Failed to load ${path}: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

function normalizeFolderPath(file: File): string {
  const rawPath = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
  const normalized = rawPath.replace(/\\/g, '/').replace(/^\/+/, '');
  const marker = 'wp-qortal-import/';
  const markerIndex = normalized.indexOf(marker);
  return markerIndex >= 0 ? normalized.slice(markerIndex + marker.length) : normalized.split('/').slice(1).join('/') || normalized;
}

async function readFolderJson<T>(files: FolderFileMap, path: string): Promise<T> {
  const file = files.get(path);
  if (!file) {
    throw new Error(`Selected folder does not contain ${path}. Select the wp-qortal-import folder.`);
  }
  return JSON.parse(await file.text()) as T;
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
  const [source, setSource] = useState<PublishSource>('folder');
  const [folderFiles, setFolderFiles] = useState<FolderFileMap | null>(null);
  const [plan, setPlan] = useState<PublishPlan | null>(null);
  const [mode, setMode] = useState<PublishMode>('cms-json');
  const [rows, setRows] = useState<PublishRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isPublishing, setIsPublishing] = useState(false);
  const hasBridge = hasQortalBridge();
  const bridgeDiagnostics = getQortalBridgeDiagnostics();
  const folderPickerProps = {
    webkitdirectory: '',
    directory: ''
  } as React.InputHTMLAttributes<HTMLInputElement> & { webkitdirectory: string; directory: string };

  useEffect(() => {
    if (source === 'folder') {
      if (!folderFiles) {
        setPlan(null);
        setRows([]);
        return;
      }

      readFolderJson<PublishPlan>(folderFiles, 'publish-log/publish-plan.json')
        .then((loadedPlan) => {
          setPlan(loadedPlan);
          setRows(createRows(loadedPlan, mode));
          setError(null);
        })
        .catch((loadError: Error) => setError(loadError.message));
      return;
    }

    fetchJson<PublishPlan>('publish-log/publish-plan.json')
      .then((loadedPlan) => {
        setPlan(loadedPlan);
        setRows(createRows(loadedPlan, mode));
      })
      .catch((loadError: Error) => setError(loadError.message));
  }, [folderFiles, mode, source]);

  function selectImportFolder(event: React.ChangeEvent<HTMLInputElement>) {
    const selectedFiles = Array.from(event.target.files || []);
    if (!selectedFiles.length) return;
    const nextFiles: FolderFileMap = new Map();
    for (const file of selectedFiles) {
      nextFiles.set(normalizeFolderPath(file), file);
    }
    setSource('folder');
    setFolderFiles(nextFiles);
    setError(null);
  }

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

  async function createPublishResourcePayload(resource: PublishRow) {
    if (resource.service === 'DOCUMENT' || resource.service === 'JSON') {
      const content = source === 'folder'
        ? await readLocalFileText(resource.local_path)
        : await fetch(`${CONTENT_BASE}/${resource.local_path}`).then((response) => response.text());
      return {
        name: qortalName,
        service: resource.service,
        identifier: resource.identifier,
        data64: toBase64(content),
        encoding: 'base64',
        title: resourceTitle(resource),
        description: `WordPress to Qortal demo resource: ${resource.identifier}`
      };
    }

    const filename = resource.local_path.split('/').pop() || resource.identifier;
    const file = source === 'folder'
      ? readLocalFile(resource.local_path)
      : await fetch(`${CONTENT_BASE}/${resource.local_path}`)
        .then(async (response) => {
          const blob = await response.blob();
          return new File([blob], filename, { type: blob.type || 'application/octet-stream' });
        });

    return {
      name: qortalName,
      service: resource.service,
      identifier: resource.identifier,
      file,
      filename,
      title: resourceTitle(resource),
      description: `WordPress to Qortal demo media: ${resource.identifier}`
    };
  }

  function readLocalFile(localPath: string): File {
    const file = folderFiles?.get(localPath);
    if (!file) {
      throw new Error(`Selected folder does not contain ${localPath}.`);
    }
    return file;
  }

  async function readLocalFileText(localPath: string): Promise<string> {
    return readLocalFile(localPath).text();
  }

  async function publishAll() {
    const activeRows = rows.filter((row) => row.status !== 'published');
    if (!activeRows.length) return;

    setIsPublishing(true);
    setError(null);
    setRows((current) =>
      current.map((row) => activeRows.some((active) => active.identifier === row.identifier)
        ? { ...row, status: 'publishing', message: 'Queued in batch' }
        : row)
    );

    try {
      const resources = [];
      for (const row of activeRows) {
        resources.push(await createPublishResourcePayload(row));
      }

      await requestQortal({
        action: 'PUBLISH_MULTIPLE_QDN_RESOURCES',
        resources
      });

      setRows((current) =>
        current.map((row) => activeRows.some((active) => active.identifier === row.identifier)
          ? { ...row, status: 'published', message: 'Published in batch' }
          : row)
      );
    } catch (publishError) {
      const message = (publishError as Error).message;
      setRows((current) =>
        current.map((row) => activeRows.some((active) => active.identifier === row.identifier)
          ? { ...row, status: 'failed', message }
          : row)
      );
      setError(message);
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
        <p className="version-line">Version {APP_VERSION}</p>
        <div className="publisher-controls">
          <label>
            Qortal name
            <input value={qortalName} onChange={(event) => setQortalName(event.target.value)} />
          </label>
          <label>
            Import folder
            <input
              type="file"
              // Chromium-only folder picker. Qortal UI runs on Chromium.
              multiple
              {...folderPickerProps}
              onChange={selectImportFolder}
            />
          </label>
          <button type="button" disabled={!hasBridge || isPublishing || !qortalName.trim() || rows.length === 0} onClick={publishAll}>
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
          <span>{source === 'folder' ? 'local folder' : 'bundled files'}</span>
        </div>
        <p className="publisher-note">
          Select your local wp-qortal-import folder first. Demo publishes a small smoke-test set. CMS JSON publishes imported posts, pages, and indexes. Full media publishes every planned resource, including downloaded media files.
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
