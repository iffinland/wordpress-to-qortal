import { useEffect, useMemo, useState } from 'react';
import type { CmsDataset, ViewerIdentity } from '../../types';
import { loadNativeIndex, publishTaxonomyChange } from '../../lib/authoring.js';
import { createScopedStorage, storageScope } from '../../lib/storageScope.js';

type Kind = 'categories' | 'tags';
type EditState = { kind: Kind; id: string; name: string } | null;
type ConfirmState = { kind: Kind; id: string } | null;

/**
 * Owner-side category and tag maintenance for CMS-authored taxonomy.
 *
 * The term id stays stable on rename, so every CMS entry follows without a
 * rewrite of content resources. Imported WordPress taxonomy is read-only and
 * is never modified by this screen.
 */
export function TaxonomyAdmin(props: {
  identity: ViewerIdentity;
  name: string;
  siteId: string;
  deployment?: any;
  dataset: CmsDataset | null;
  onRefresh: () => void;
}) {
  const scope = useMemo(() => storageScope({
    deployment: props.deployment,
    identity: props.identity,
    siteId: props.siteId
  }), [props.deployment, props.identity, props.siteId]);
  const [index, setIndex] = useState<any>(null);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<EditState>(null);
  const [confirming, setConfirming] = useState<ConfirmState>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const reload = async () => {
    setLoading(true);
    const result = await loadNativeIndex(props.name, props.siteId);
    if (result.ok) {
      setIndex(result.index);
      setRevision(Number(result.index.revision) || 0);
      setMessage('');
    } else {
      setMessage('The CMS taxonomy could not be read: ' + result.errors.join(' '));
    }
    setLoading(false);
  };

  useEffect(() => {
    let cancelled = false;
    loadNativeIndex(props.name, props.siteId).then((result: any) => {
      if (cancelled) return;
      if (result.ok) {
        setIndex(result.index);
        setRevision(Number(result.index.revision) || 0);
      } else {
        setMessage('The CMS taxonomy could not be read: ' + result.errors.join(' '));
      }
      setLoading(false);
    }).catch((error: Error) => {
      if (!cancelled) { setMessage(error.message); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [props.name, props.siteId]);

  const nativeItems = useMemo(
    () => (props.dataset ? [...props.dataset.posts, ...props.dataset.pages].filter((item) => item.native) : []),
    [props.dataset]
  );
  const importedItems = useMemo(
    () => (props.dataset ? [...props.dataset.posts, ...props.dataset.pages].filter((item) => !item.native) : []),
    [props.dataset]
  );
  const idsFor = (kind: Kind, item: any) => (kind === 'categories' ? item.categoryIds : item.tagIds) || [];
  const usedByNative = (kind: Kind, id: string) => nativeItems.filter((item) => idsFor(kind, item).includes(id)).length;
  const usedByImported = (kind: Kind, id: string) => importedItems.some((item) => idsFor(kind, item).includes(id));

  const saveRename = async () => {
    if (!editing || !scope) { setMessage('Verify the owner account before changing taxonomy.'); return; }
    setBusy(true);
    const result: any = await publishTaxonomyChange({
      identity: props.identity,
      name: props.name,
      siteId: props.siteId,
      kind: editing.kind,
      action: 'rename',
      termId: editing.id,
      newName: editing.name,
      baseRevision: revision,
      storage: createScopedStorage(localStorage, scope),
      usedByImported: usedByImported(editing.kind, editing.id)
    });
    setBusy(false);
    if (result.ok) {
      setIndex(result.index);
      setRevision(Number(result.index.revision) || revision);
      setEditing(null);
      setMessage('Renamed. The term id and slug stay stable; existing CMS content keeps the same classification.');
      props.onRefresh();
      return;
    }
    setMessage(result.message || 'The rename could not be confirmed.');
    if (result.index) { setIndex(result.index); setRevision(Number(result.index.revision) || revision); }
  };

  const removeTerm = async () => {
    if (!confirming || !scope) { setMessage('Verify the owner account before changing taxonomy.'); return; }
    setBusy(true);
    const result: any = await publishTaxonomyChange({
      identity: props.identity,
      name: props.name,
      siteId: props.siteId,
      kind: confirming.kind,
      action: 'delete',
      termId: confirming.id,
      baseRevision: revision,
      storage: createScopedStorage(localStorage, scope),
      usedByImported: usedByImported(confirming.kind, confirming.id)
    });
    setBusy(false);
    if (result.ok) {
      setIndex(result.index);
      setRevision(Number(result.index.revision) || revision);
      setConfirming(null);
      setMessage('Term removed from the CMS taxonomy and from CMS-authored items. Imported content is unchanged.');
      props.onRefresh();
      return;
    }
    setMessage(result.message || 'The removal could not be confirmed.');
    if (result.index) { setIndex(result.index); setRevision(Number(result.index.revision) || revision); }
  };

  const renderList = (kind: Kind, heading: string, help: string) => {
    const terms = Array.isArray(index && index[kind]) ? index[kind] : [];
    return (
      <section className="admin-section" aria-labelledby={kind + '-title'}>
        <h2 id={kind + '-title'}>{heading}</h2>
        <p className="muted">{help}</p>
        {terms.length === 0 ? <p className="muted">No CMS-managed {kind} yet. Type a new term while editing a post.</p> : (
          <ul className="admin-list">
            {terms.map((term: any) => {
              const imported = usedByImported(kind, term.id);
              const nativeCount = usedByNative(kind, term.id);
              return (
                <li key={term.id} className="admin-list__item">
                  <span>
                    {term.name}{' '}
                    <span className="admin-list__meta">
                      {term.id} · {nativeCount} CMS item{nativeCount === 1 ? '' : 's'}
                      {imported ? ' · used by imported content' : ''}
                    </span>
                  </span>
                  <span className="admin-list__actions">
                    {editing && editing.kind === kind && editing.id === term.id ? (
                      <>
                        <label className="visually-hidden" htmlFor={'rename-' + kind + '-' + term.id}>New {kind === 'categories' ? 'category' : 'tag'} name</label>
                        <input
                          id={'rename-' + kind + '-' + term.id}
                          value={editing.name}
                          maxLength={80}
                          onChange={(event) => setEditing({ ...editing, name: event.target.value })}
                        />
                        <button type="button" className="button" onClick={saveRename} disabled={busy}>Save name</button>
                        <button type="button" className="button button--ghost" onClick={() => setEditing(null)} disabled={busy}>Cancel</button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="button button--ghost"
                        onClick={() => { setConfirming(null); setEditing({ kind, id: term.id, name: term.name }); }}
                        disabled={imported || busy}
                        title={imported ? 'Imported WordPress taxonomy is read-only.' : undefined}
                      >
                        Rename
                      </button>
                    )}
                    {confirming && confirming.kind === kind && confirming.id === term.id ? (
                      <>
                        <span role="alert">Remove “{term.name}” from CMS content?</span>
                        <button type="button" className="button button--danger" onClick={removeTerm} disabled={busy}>Remove term</button>
                        <button type="button" className="button button--ghost" onClick={() => setConfirming(null)} disabled={busy}>Cancel</button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="button button--danger"
                        onClick={() => { setEditing(null); setConfirming({ kind, id: term.id }); }}
                        disabled={imported || busy}
                        title={imported ? 'Used by imported WordPress content and cannot be changed here.' : undefined}
                      >
                        Delete
                      </button>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    );
  };

  if (loading) return <p className="muted">Reading the CMS taxonomy…</p>;
  return (
    <div className="admin-section" aria-labelledby="taxonomy-title">
      <h2 id="taxonomy-title">Categories and tags</h2>
      <p className="muted">
        Revision <strong>{revision}</strong>. Renaming changes the display name only; the stable id and URL slug are
        preserved. Deleting removes the term from CMS-authored items. Imported WordPress taxonomy is read-only.
      </p>
      {message ? <p className="state-notice" role="status">{message}</p> : null}
      {!scope ? <p className="muted">Verify the owner account to manage taxonomy.</p> : null}
      <div className="admin-toolbar">
        <button type="button" className="button button--ghost" onClick={reload} disabled={busy}>Reload taxonomy</button>
      </div>
      {renderList('categories', 'Categories', 'Used on posts and pages in this CMS.')}
      {renderList('tags', 'Tags', 'Free-form labels shared across CMS-authored content.')}
    </div>
  );
}
