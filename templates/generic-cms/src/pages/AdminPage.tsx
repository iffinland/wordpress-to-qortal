import { useState } from 'react';
import { StateNotice } from '../components/StateNotice';
import { formatDate } from '../lib/text.js';
import type { AdoptionRecord, CmsContentItem, CmsDataset, ViewerIdentity } from '../types';

function safeId(value: string) {
  return String(value || '').replace(/[^a-zA-Z0-9_-]+/g, '-');
}

export function AdminPage(props: {
  dataset: CmsDataset | null;
  loading?: boolean;
  identity: ViewerIdentity | null;
  identityLoading: boolean;
  identityNotice: string;
  adoptionQueue: AdoptionRecord[];
  onAdopt: (items: CmsContentItem[]) => { ok: boolean; message: string };
  onRemove: (key: string) => void;
  onRefresh: () => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const owner = Boolean(props.identity && props.identity.owner);
  const items = props.dataset ? [...props.dataset.posts, ...props.dataset.pages] : [];
  const selectedItems = items.filter((item) => selected.includes(item.id));
  const catalogReady = Boolean(props.dataset && props.dataset.state !== 'error');

  const toggle = (id: string) => {
    setSelected((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  };

  const adopt = () => {
    if (!props.dataset) {
      setMessage('Import requires a published catalog. Publish the site with Qortal Migration Studio first.');
      return;
    }
    const result = props.onAdopt(selectedItems);
    setMessage(result.message);
    if (result.ok) setSelected([]);
  };

  return (
    <div className="page">
      <h1>Admin and import</h1>
      <p className="muted">
        This view inspects the published catalog and stages imported items in a local adoption queue. It does not sign,
        publish or modify QDN resources.
      </p>

      <section className="admin-section" aria-labelledby="precondition-title">
        <h2 id="precondition-title">Preconditions</h2>
        <p className="muted">
          Admin and import need two things: a published <code>qms-cms-manifest</code> with its indexes under this
          site's exact QDN name, and the signed-in account that owns that name. This page stays reachable before the
          catalog exists so the missing precondition is visible instead of the menu appearing broken.
        </p>
        {!props.dataset ? (
          <StateNotice
            state={props.loading ? 'loading' : 'partial'}
            title={props.loading ? 'Reading the published catalog...' : 'No published catalog is available yet'}
            message={props.loading
              ? 'Admin stays reachable while the QDN catalog loads.'
              : 'No qms-cms-manifest could be read for this site. Publish the site with the Migration Publisher first, then refresh. Owner mode and import remain disabled until the catalog exists.'}
          />
        ) : props.dataset.state === 'error' ? (
          <StateNotice
            state="error"
            title="Catalog unavailable"
            message={props.dataset.message || 'The published catalog could not be read.'}
            notices={props.dataset.notices}
          />
        ) : (
          <p className="muted">
            Catalog state: <strong>{props.dataset.state}</strong>
            {props.dataset.source ? ' · source: ' + props.dataset.source : ''}
            {props.dataset.generatedAt
              ? ' · generated ' + formatDate(props.dataset.generatedAt)
              : ''}
          </p>
        )}
        <div className="admin-toolbar">
          <button type="button" className="button button--ghost" onClick={props.onRefresh}>Refresh catalog</button>
        </div>
      </section>

      <section className="admin-section" aria-labelledby="access-title">
        <h2 id="access-title">Access</h2>
        {props.identityLoading ? (
          <StateNotice state="loading" title="Checking Qortal name ownership..." />
        ) : props.identity ? (
          <div className={'access-card ' + (props.identity.owner ? 'access-card--owner' : 'access-card--reader')}>
            <p className="access-card__role">{props.identity.owner ? 'Owner mode' : 'Read-only mode'}</p>
            <p>{props.identity.message}</p>
            <dl className="meta-grid">
              <div><dt>QDN name</dt><dd>{props.identity.qdnName || '(not configured)'}</dd></div>
              <div><dt>Account</dt><dd>{props.identity.address || '(not signed in)'}</dd></div>
              <div><dt>Name record</dt><dd>{props.identity.nameRecordStatus}</dd></div>
              <div><dt>Verification</dt><dd>{props.identity.reason}</dd></div>
            </dl>
          </div>
        ) : (
          <StateNotice state="partial" title="Read-only mode" message={props.identityNotice || 'Qortal identity could not be resolved. Administrative actions are disabled.'} />
        )}
      </section>

      <section className="admin-section" aria-labelledby="catalog-title">
        <h2 id="catalog-title">Catalog</h2>
        {props.dataset ? (
          <dl className="meta-grid">
            <div><dt>Source</dt><dd>{props.dataset.source}</dd></div>
            <div><dt>State</dt><dd>{props.dataset.state}{props.dataset.fromCache ? ' (cached)' : ''}</dd></div>
            <div><dt>Posts</dt><dd>{props.dataset.availability.posts ? props.dataset.posts.length : 'unavailable'}</dd></div>
            <div><dt>Pages</dt><dd>{props.dataset.availability.pages ? props.dataset.pages.length : 'unavailable'}</dd></div>
            <div><dt>Categories</dt><dd>{props.dataset.availability.categories ? props.dataset.categories.length : 'unavailable'}</dd></div>
            <div><dt>Tags</dt><dd>{props.dataset.availability.tags ? props.dataset.tags.length : 'unavailable'}</dd></div>
          </dl>
        ) : (
          <p className="muted">Catalog counts are unavailable until the manifest and indexes are published.</p>
        )}
        {props.dataset && props.dataset.notices.length > 0 ? (
          <ul className="notice-list">
            {props.dataset.notices.map((notice) => <li key={notice.code + notice.message} className={'notice-list__item notice-list__item--' + notice.level}>{notice.message}</li>)}
          </ul>
        ) : null}
      </section>

      <section className="admin-section" aria-labelledby="import-title">
        <h2 id="import-title">Import and adoption</h2>
        <p id="admin-readonly-help" className="muted">
          {!catalogReady
            ? 'Import is unavailable until a published catalog exists. Nothing is published from this page.'
            : owner
              ? 'Select catalog items to stage in the local adoption queue. Nothing is published.'
              : 'Only the verified owner of the QDN site name can stage import or adoption actions.'}
        </p>
        <fieldset className="admin-fieldset" disabled={!owner || !catalogReady}>
          <legend>Catalog items</legend>
          {items.length === 0 ? (
            <p className="muted">No catalog items are available to adopt.</p>
          ) : (
            <ul className="admin-list">
              {items.map((item) => {
                const id = 'adopt-' + safeId(item.id);
                return (
                  <li key={item.id} className="admin-list__item">
                    <label htmlFor={id}>
                      <input
                        id={id}
                        type="checkbox"
                        checked={selected.includes(item.id)}
                        onChange={() => toggle(item.id)}
                      />
                      <span>{item.title}</span>
                      <span className="admin-list__meta">{item.type} / {item.slug}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          <button type="button" className="button" onClick={adopt} disabled={!owner || !catalogReady || selectedItems.length === 0}>
            Adopt selected ({selectedItems.length})
          </button>
        </fieldset>
        <p className="admin-message" role="status" aria-live="polite">{message}</p>

        <h3>Adopted items</h3>
        {props.adoptionQueue.length === 0 ? (
          <p className="muted">No items have been adopted locally.</p>
        ) : (
          <ul className="adopted-list">
            {props.adoptionQueue.map((record) => (
              <li key={record.key}>
                <span>{record.title}</span>
                <span className="admin-list__meta">{record.type} / {record.slug}{record.sourceId !== null ? ' / source ' + record.sourceId : ''}</span>
                <button type="button" className="button button--ghost" onClick={() => props.onRemove(record.key)} disabled={!owner}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
