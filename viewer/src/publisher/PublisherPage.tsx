import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CheckCircle2, Play, Send, Square, SquareCheckBig, XCircle } from 'lucide-react';
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
  status: 'pending' | 'publishing' | 'published' | 'failed' | 'skipped';
  message: string;
}

type PublishMode = 'demo' | 'cms-json' | 'images' | 'documents' | 'audio' | 'video' | 'selected' | 'full';
type PublishSource = 'bundled' | 'folder';
type FolderFileMap = Map<string, File>;
type PublishHistory = Record<string, { published_at: string; service: string; identifier: string; local_path: string; bytes?: number }>;
type PublishProgressPhase = 'idle' | 'preparing' | 'confirming' | 'completed' | 'failed';

interface PublishProgress {
  phase: PublishProgressPhase;
  total: number;
  prepared: number;
  completed: number;
}

const PUBLISH_HISTORY_KEY = 'wp-to-qortal-migration-publish-history-v1';

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

  if (mode === 'images') {
    return toRows(plan.resources.media.filter((resource) => resource.type === 'image'));
  }

  if (mode === 'documents') {
    return toRows(plan.resources.media.filter((resource) => resource.type === 'document' || resource.type === 'file'));
  }

  if (mode === 'audio') {
    return toRows(plan.resources.media.filter((resource) => resource.type === 'audio'));
  }

  if (mode === 'video') {
    return toRows(plan.resources.media.filter((resource) => resource.type === 'video'));
  }

  if (mode === 'selected') {
    return toRows(plan.resources.media);
  }

  return toRows([...plan.resources.posts, ...plan.resources.pages, ...plan.resources.indexes, ...plan.resources.media]);
}

function resourceKey(name: string, resource: Pick<PublishResource, 'service' | 'identifier'>) {
  return `${name}:${resource.service}:${resource.identifier}`;
}

function loadPublishHistory(): PublishHistory {
  try {
    return JSON.parse(localStorage.getItem(PUBLISH_HISTORY_KEY) || '{}') as PublishHistory;
  } catch {
    return {};
  }
}

function savePublishHistory(history: PublishHistory) {
  localStorage.setItem(PUBLISH_HISTORY_KEY, JSON.stringify(history));
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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [skipExisting, setSkipExisting] = useState(true);
  const [history, setHistory] = useState<PublishHistory>(() => loadPublishHistory());
  const [error, setError] = useState<string | null>(null);
  const [isPublishing, setIsPublishing] = useState(false);
  const [progress, setProgress] = useState<PublishProgress>({ phase: 'idle', total: 0, prepared: 0, completed: 0 });
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
          applyRows(createRows(loadedPlan, mode), mode);
          setError(null);
        })
        .catch((loadError: Error) => setError(loadError.message));
      return;
    }

    fetchJson<PublishPlan>('publish-log/publish-plan.json')
      .then((loadedPlan) => {
        setPlan(loadedPlan);
        applyRows(createRows(loadedPlan, mode), mode);
      })
      .catch((loadError: Error) => setError(loadError.message));
  }, [folderFiles, mode, source]);

  useEffect(() => {
    if (plan) applyRows(createRows(plan, mode), mode);
  }, [qortalName]);

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
    if (plan) applyRows(createRows(plan, nextMode), nextMode);
  }

  function applyRows(nextRows: PublishRow[], nextMode: PublishMode) {
    const rowsWithHistory = nextRows.map((row) => {
      const key = resourceKey(qortalName, row);
      return history[key]
        ? { ...row, status: 'published' as const, message: 'Published earlier' }
        : row;
    });
    setRows(rowsWithHistory);
    setSelectedIds(nextMode === 'selected'
      ? new Set()
      : new Set(rowsWithHistory.filter((row) => row.status !== 'published').map((row) => row.identifier)));
  }

  const summary = useMemo(() => {
    const bytes = rows.reduce((sum, row) => sum + (row.bytes || 0), 0);
    return {
      count: rows.length,
      selected: rows.filter((row) => selectedIds.has(row.identifier) && row.status !== 'published').length,
      bytes,
      published: rows.filter((row) => row.status === 'published').length,
      failed: rows.filter((row) => row.status === 'failed').length
    };
  }, [rows, selectedIds]);

  const progressPercent = progress.total
    ? Math.round(((progress.phase === 'completed' ? progress.completed : progress.prepared) / progress.total) * 100)
    : 0;

  function progressLabel() {
    if (progress.phase === 'preparing') return 'Preparing resources';
    if (progress.phase === 'confirming') return 'Waiting for Qortal confirmation';
    if (progress.phase === 'completed') return 'Batch completed';
    if (progress.phase === 'failed') return 'Batch failed';
    return '';
  }

  function toggleRow(identifier: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(identifier)) next.delete(identifier);
      else next.add(identifier);
      return next;
    });
  }

  function selectAllRows() {
    setSelectedIds(new Set(rows.filter((row) => row.status !== 'published').map((row) => row.identifier)));
  }

  function clearSelectedRows() {
    setSelectedIds(new Set());
  }

  function markHistoryPublished(publishedRows: PublishRow[]) {
    const nextHistory = { ...history };
    const publishedAt = new Date().toISOString();
    for (const row of publishedRows) {
      nextHistory[resourceKey(qortalName, row)] = {
        published_at: publishedAt,
        service: row.service,
        identifier: row.identifier,
        local_path: row.local_path,
        bytes: row.bytes
      };
    }
    setHistory(nextHistory);
    savePublishHistory(nextHistory);
  }

  async function qdnResourceExists(resource: PublishRow) {
    try {
      await requestQortal({
        action: 'FETCH_QDN_RESOURCE',
        service: resource.service,
        name: qortalName,
        identifier: resource.identifier
      });
      return true;
    } catch {
      return false;
    }
  }

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
    const activeRows = rows.filter((row) => selectedIds.has(row.identifier) && row.status !== 'published');
    if (!activeRows.length) return;

    setIsPublishing(true);
    setError(null);
    setProgress({ phase: 'preparing', total: activeRows.length, prepared: 0, completed: 0 });
    setRows((current) =>
      current.map((row) => activeRows.some((active) => active.identifier === row.identifier)
        ? { ...row, status: 'publishing', message: 'Queued in batch' }
        : row)
    );

    try {
      const resources = [];
      const alreadyPublishedRows: PublishRow[] = [];
      const publishRows: PublishRow[] = [];
      for (const [index, row] of activeRows.entries()) {
        if (skipExisting && await qdnResourceExists(row)) {
          alreadyPublishedRows.push(row);
          setProgress({ phase: 'preparing', total: activeRows.length, prepared: index + 1, completed: alreadyPublishedRows.length });
          continue;
        }
        resources.push(await createPublishResourcePayload(row));
        publishRows.push(row);
        setProgress({ phase: 'preparing', total: activeRows.length, prepared: index + 1, completed: alreadyPublishedRows.length });
      }

      if (resources.length) {
        setProgress({ phase: 'confirming', total: activeRows.length, prepared: activeRows.length, completed: alreadyPublishedRows.length });
        await requestQortal({
          action: 'PUBLISH_MULTIPLE_QDN_RESOURCES',
          resources
        });
      }

      markHistoryPublished([...alreadyPublishedRows, ...publishRows]);

      setRows((current) =>
        current.map((row) => alreadyPublishedRows.some((active) => active.identifier === row.identifier)
          ? { ...row, status: 'published', message: 'Already in QDN' }
          : publishRows.some((active) => active.identifier === row.identifier)
            ? { ...row, status: 'published', message: resources.length ? 'Published in batch' : 'Already in QDN' }
            : activeRows.some((active) => active.identifier === row.identifier)
              ? { ...row, status: 'skipped', message: 'Skipped' }
              : row)
      );
      setSelectedIds((current) => {
        const next = new Set(current);
        for (const row of activeRows) next.delete(row.identifier);
        return next;
      });
      setProgress({ phase: 'completed', total: activeRows.length, prepared: activeRows.length, completed: activeRows.length });
    } catch (publishError) {
      const message = (publishError as Error).message;
      setRows((current) =>
        current.map((row) => activeRows.some((active) => active.identifier === row.identifier)
          ? { ...row, status: 'failed', message }
          : row)
      );
      setError(message);
      setProgress((current) => ({ ...current, phase: 'failed' }));
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
          <button type="button" disabled={!hasBridge || isPublishing || !qortalName.trim() || summary.selected === 0} onClick={publishAll}>
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
          <button type="button" className={mode === 'images' ? 'active' : ''} onClick={() => changeMode('images')}>
            Images
          </button>
          <button type="button" className={mode === 'documents' ? 'active' : ''} onClick={() => changeMode('documents')}>
            Documents
          </button>
          <button type="button" className={mode === 'audio' ? 'active' : ''} onClick={() => changeMode('audio')}>
            Audio
          </button>
          <button type="button" className={mode === 'video' ? 'active' : ''} onClick={() => changeMode('video')}>
            Video
          </button>
          <button type="button" className={mode === 'selected' ? 'active' : ''} onClick={() => changeMode('selected')}>
            Selected media
          </button>
          <button type="button" className={mode === 'full' ? 'active' : ''} onClick={() => changeMode('full')}>
            Full media
          </button>
        </div>
        <div className="publisher-toolbar">
          <label className="publisher-toggle">
            <input type="checkbox" checked={skipExisting} onChange={(event) => setSkipExisting(event.target.checked)} />
            Skip already published
          </label>
          <button type="button" onClick={selectAllRows} disabled={rows.length === 0}>Select all</button>
          <button type="button" onClick={clearSelectedRows} disabled={selectedIds.size === 0}>Clear</button>
        </div>
        <div className="publisher-summary">
          <span>{summary.count} resources</span>
          <span>{summary.selected} selected</span>
          <span>{formatBytes(summary.bytes)}</span>
          <span>{summary.published} published</span>
          <span>{summary.failed} failed</span>
          <span>{source === 'folder' ? 'local folder' : 'bundled files'}</span>
        </div>
        {progress.phase !== 'idle' && (
          <div className={`publisher-progress ${progress.phase}`}>
            <div className="publisher-progress-label">
              <strong>{progressLabel()}</strong>
              <span>{progressPercent}% · {progress.phase === 'completed' ? progress.completed : progress.prepared} / {progress.total}</span>
            </div>
            <div className="publisher-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressPercent}>
              <span style={{ width: `${progressPercent}%` }} />
            </div>
          </div>
        )}
        <p className="publisher-note">
          Select your local wp-qortal-import folder first. Use Images, Documents, Audio, Video, or Selected media to publish large media in small batches.
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
            <button type="button" className="row-check" onClick={() => toggleRow(row.identifier)} disabled={row.status === 'published'}>
              {selectedIds.has(row.identifier) ? <SquareCheckBig size={19} /> : <Square size={19} />}
            </button>
            <div>
              <strong>{row.identifier}</strong>
              <span>
                {row.service} · {row.type} · {formatBytes(row.bytes)} · {row.local_path}
              </span>
            </div>
            <div className={`publisher-status ${row.status}`}>
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
