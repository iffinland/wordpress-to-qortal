import { useState } from 'react';
import { StateNotice } from '../components/StateNotice';
import { AccessDeniedPage } from './AccessDeniedPage';
import { formatDate } from '../lib/text.js';
import { adminHref } from '../lib/routes.js';
import type { AdminSection, AdoptionRecord, CmsContentItem, CmsDataset, ViewerIdentity } from '../types';
import { SettingsPanel } from './admin/SettingsPanel';
import { EditorPage } from './admin/EditorPage';
import { GalleryAdmin } from './admin/GalleryAdmin';

function safeId(value: string) {
  return String(value || '').replace(/[^a-zA-Z0-9_-]+/g, '-');
}

function OwnerAdmin(props: {
  dataset: CmsDataset | null;
  loading?: boolean;
  identity: ViewerIdentity;
  adoptionQueue: AdoptionRecord[];
  section: AdminSection;
  onAdopt: (items: CmsContentItem[]) => Promise<{ ok: boolean; message: string }> | { ok: boolean; message: string };
  onRemove: (key: string) => void;
  onRefresh: () => void;
  onAuthorize: () => Promise<{ ok: boolean; message: string }>;
  settingsConfig: any;
  qdnName: string;
  siteId: string;
  remoteSettings: unknown;
  onSettingsPreview: (draft: unknown | null) => void;
  onSettingsPublished: (settings: unknown) => void;
  galleries: any[];
  galleriesLoading: boolean;
  loadContent: any;
  initialEditorId?: string;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const items = props.dataset ? [...props.dataset.posts, ...props.dataset.pages] : [];
  const selectedItems = items.filter((item) => selected.includes(item.id));
  const catalogReady = Boolean(props.dataset && props.dataset.state !== 'error');

  const toggle = (id: string) => setSelected((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);

  const adopt = async () => {
    if (!props.dataset) { setMessage('Import requires a published catalog. Publish the site with Qortal Migration Studio first.'); return; }
    const authorized = await props.onAuthorize();
    if (!authorized.ok) { setMessage(authorized.message); return; }
    const result = await props.onAdopt(selectedItems);
    setMessage(result.message);
    if (result.ok) setSelected([]);
  };

  const remove = async (key: string) => {
    const authorized = await props.onAuthorize();
    if (!authorized.ok) { setMessage(authorized.message); return; }
    props.onRemove(key);
  };

  return (
    <div className="page">
      <p className="eyebrow">Owner administration</p>
      <h1>Admin</h1>
      <nav className="admin-tabs" aria-label="Admin sections">
        <a href={adminHref('overview')} aria-current={props.section === 'overview' ? 'page' : undefined}>Overview and import</a>
        <a href={adminHref('settings')} aria-current={props.section === 'settings' ? 'page' : undefined}>Site settings</a>
        <a href={adminHref('editor')} aria-current={props.section === 'editor' ? 'page' : undefined}>Posts</a>
        <a href={adminHref('galleries')} aria-current={props.section === 'galleries' ? 'page' : undefined}>Galleries</a>
      </nav>

      {props.section === 'settings' ? (
        <SettingsPanel
          config={props.settingsConfig}
          identity={props.identity}
          qdnName={props.qdnName}
          siteId={props.siteId}
          remoteSettings={props.remoteSettings}
          onPreview={props.onSettingsPreview}
          onPublished={props.onSettingsPublished}
        />
      ) : null}

      {props.section === 'editor' ? (
        <EditorPage
          identity={props.identity}
          name={props.qdnName}
          siteId={props.siteId}
          dataset={props.dataset}
          galleries={props.galleries}
          loadContent={props.loadContent}
          onRefresh={props.onRefresh}
          initialId={props.initialEditorId}
        />
      ) : null}

      {props.section === 'galleries' ? (
        <GalleryAdmin
          identity={props.identity}
          name={props.qdnName}
          siteId={props.siteId}
          dataset={props.dataset}
          galleries={props.galleries}
          onRefresh={props.onRefresh}
        />
      ) : null}

      {props.section === 'overview' ? (
        <>
          <p className="muted">
            This view inspects the published catalog and stages imported items in a local adoption queue. Publishing is
            explicit and owner-only; the queue itself never signs or modifies QDN resources.
          </p>

          <section className="admin-section" aria-labelledby="access-title">
            <h2 id="access-title">Access</h2>
            <div className="access-card access-card--owner">
              <p className="access-card__role">Owner mode</p>
              <p>{props.identity.message}</p>
              <dl className="meta-grid">
                <div><dt>QDN name</dt><dd>{props.identity.qdnName || '(not configured)'}</dd></div>
                <div><dt>Account</dt><dd>{props.identity.address}</dd></div>
                <div><dt>Name record</dt><dd>{props.identity.nameRecordStatus}</dd></div>
                <div><dt>Verification</dt><dd>{props.identity.reason}</dd></div>
              </dl>
            </div>
          </section>

          <section className="admin-section" aria-labelledby="precondition-title">
            <h2 id="precondition-title">Catalog</h2>
            {!props.dataset ? (
              <StateNotice state={props.loading ? 'loading' : 'partial'} title={props.loading ? 'Reading the published catalog...' : 'No published catalog is available yet'} message={props.loading ? 'Admin stays reachable while the QDN catalog loads.' : 'No qms-cms-manifest could be read for this site. Publish the site with the Migration Publisher first, then refresh.'} />
            ) : props.dataset.state === 'error' ? (
              <StateNotice state="error" title="Catalog unavailable" message={props.dataset.message || 'The published catalog could not be read.'} notices={props.dataset.notices} />
            ) : (
              <p className="muted">Catalog state: <strong>{props.dataset.state}</strong>{props.dataset.source ? ' · source: ' + props.dataset.source : ''}{props.dataset.generatedAt ? ' · generated ' + formatDate(props.dataset.generatedAt) : ''}</p>
            )}
            <div className="admin-toolbar"><button type="button" className="button button--ghost" onClick={props.onRefresh}>Refresh catalog</button></div>
            {props.dataset ? (
              <dl className="meta-grid">
                <div><dt>Source</dt><dd>{props.dataset.source}</dd></div>
                <div><dt>Posts</dt><dd>{props.dataset.availability.posts ? props.dataset.posts.length : 'unavailable'}</dd></div>
                <div><dt>Pages</dt><dd>{props.dataset.availability.pages ? props.dataset.pages.length : 'unavailable'}</dd></div>
                <div><dt>CMS-authored</dt><dd>{props.dataset.posts.filter((item) => item.native).length}</dd></div>
                <div><dt>Categories</dt><dd>{props.dataset.availability.categories ? props.dataset.categories.length : 'unavailable'}</dd></div>
                <div><dt>Tags</dt><dd>{props.dataset.availability.tags ? props.dataset.tags.length : 'unavailable'}</dd></div>
              </dl>
            ) : null}
          </section>

          <section className="admin-section" aria-labelledby="import-title">
            <h2 id="import-title">Import and adoption</h2>
            <p className="muted">
              {!catalogReady ? 'Import is unavailable until a published catalog exists.' : 'Select catalog items to stage in the local adoption queue. Nothing is published from this page.'}
            </p>
            <fieldset className="admin-fieldset" disabled={!catalogReady}>
              <legend>Catalog items</legend>
              {items.length === 0 ? <p className="muted">No catalog items are available to adopt.</p> : (
                <ul className="admin-list">
                  {items.map((item) => {
                    const id = 'adopt-' + safeId(item.id);
                    return (
                      <li key={item.id} className="admin-list__item">
                        <label htmlFor={id}>
                          <input id={id} type="checkbox" checked={selected.includes(item.id)} onChange={() => toggle(item.id)} />
                          <span>{item.title}</span>
                          <span className="admin-list__meta">{item.type} / {item.slug}{item.native ? ' / CMS' : ''}</span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
              <button type="button" className="button" onClick={adopt} disabled={!catalogReady || selectedItems.length === 0}>Adopt selected ({selectedItems.length})</button>
            </fieldset>
            <p className="admin-message" role="status" aria-live="polite">{message}</p>
            <h3>Adopted items</h3>
            {props.adoptionQueue.length === 0 ? <p className="muted">No items have been adopted locally.</p> : (
              <ul className="adopted-list">
                {props.adoptionQueue.map((record) => (
                  <li key={record.key}>
                    <span>{record.title}</span>
                    <span className="admin-list__meta">{record.type} / {record.slug}{record.sourceId !== null ? ' / source ' + record.sourceId : ''}</span>
                    <button type="button" className="button button--ghost" onClick={() => remove(record.key)}>Remove</button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}

export function AdminPage(props: {
  dataset: CmsDataset | null;
  loading?: boolean;
  identity: ViewerIdentity | null;
  identityLoading: boolean;
  identityNotice: string;
  adoptionQueue: AdoptionRecord[];
  section?: AdminSection;
  onAdopt: (items: CmsContentItem[]) => any;
  onRemove: (key: string) => void;
  onRefresh: () => void;
  onAuthorize?: () => Promise<{ ok: boolean; message: string }>;
  settingsConfig?: any;
  qdnName?: string;
  siteId?: string;
  remoteSettings?: unknown;
  onSettingsPreview?: (draft: unknown | null) => void;
  onSettingsPublished?: (settings: unknown) => void;
  galleries?: any[];
  galleriesLoading?: boolean;
  loadContent?: any;
  initialEditorId?: string;
}) {
  if (props.identityLoading) {
    return <div className="page"><StateNotice state="loading" title="Checking QDN name ownership..." message="Administration opens only for the verified on-chain owner." /></div>;
  }
  const owner = Boolean(props.identity && props.identity.owner && props.identity.role === 'owner' && props.identity.nameRecordStatus === 'verified');
  if (!owner) {
    return <AccessDeniedPage identity={props.identity} notice={props.identityNotice} />;
  }
  return (
    <OwnerAdmin
      dataset={props.dataset}
      loading={props.loading}
      identity={props.identity as ViewerIdentity}
      adoptionQueue={props.adoptionQueue}
      section={props.section || 'overview'}
      onAdopt={props.onAdopt}
      onRemove={props.onRemove}
      onRefresh={props.onRefresh}
      onAuthorize={props.onAuthorize || (async () => ({ ok: true, message: '' }))}
      settingsConfig={props.settingsConfig || { site: {}, navigation: [], theme: { colors: {} } }}
      qdnName={props.qdnName || (props.identity ? props.identity.qdnName : '')}
      siteId={props.siteId || (props.dataset ? props.dataset.site.id : 'site')}
      remoteSettings={props.remoteSettings || null}
      onSettingsPreview={props.onSettingsPreview || (() => undefined)}
      onSettingsPublished={props.onSettingsPublished || (() => undefined)}
      galleries={props.galleries || []}
      galleriesLoading={Boolean(props.galleriesLoading)}
      loadContent={props.loadContent || (async () => { throw new Error('Content loading is unavailable.'); })}
      initialEditorId={props.initialEditorId}
    />
  );
}

