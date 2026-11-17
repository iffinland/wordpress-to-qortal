import type { CmsContentItem } from '../../../types';
import { publicationLabel } from './editorUtils';

export function DraftLists(props: {
  drafts: any[];
  nativePosts: CmsContentItem[];
  importedItems: CmsContentItem[];
  anomalies: any[];
  onEditDraft: (id: string) => void;
  onDeleteDraft: (id: string) => void;
  onEditPublished: (id: string) => void;
  onEditImported: (id: string) => void;
  onDeletePublished?: (id: string) => void;
}) {
  return (
    <>
      <h3>Local drafts</h3>
      <p className="muted">Saved only in this browser. A local draft is not a published update.</p>
      {props.drafts.length === 0 ? <p className="muted">No local drafts yet.</p> : (
        <ul className="admin-list">
          {props.drafts.map((item) => (
            <li key={item.id} className="admin-list__item">
              <button type="button" className="button button--ghost" onClick={() => props.onEditDraft(item.id)}>
                {item.title || '(untitled)'}
                <span className="admin-list__meta">{publicationLabel(item.publicationState || 'draft')} · /{item.slug || 'no-slug'}</span>
              </button>
              <button type="button" className="button button--ghost" onClick={() => props.onDeleteDraft(item.id)}>Delete draft</button>
            </li>
          ))}
        </ul>
      )}

      <h3>CMS-authored posts and pages</h3>
      {props.nativePosts.length === 0 ? <p className="muted">No CMS-authored content published yet.</p> : (
        <ul className="admin-list">
          {props.nativePosts.map((item) => (
            <li key={item.id} className="admin-list__item">
              <span>{item.title} <span className="admin-list__meta">{item.type} · /{item.slug} · {item.status} · CMS-authored</span></span>
              <span className="admin-list__actions">
                <button type="button" className="button button--ghost" aria-label={'Edit ' + item.title} onClick={() => props.onEditPublished(item.id)}>Edit</button>
                {props.onDeletePublished ? (
                  <button type="button" className="button button--danger" aria-label={'Delete ' + item.title} onClick={() => props.onDeletePublished!(item.id)}>
                    Delete
                  </button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}

      <h3>Imported WordPress posts and pages</h3>
      <p className="muted">
        Edits are stored locally in QDN as an overlay. The WordPress source metadata, original URL and QDN identity
        are preserved; the imported resources stay byte-for-byte unchanged.
      </p>
      {props.importedItems.length === 0 ? <p className="muted">No imported content in the catalog.</p> : (
        <ul className="admin-list">
          {props.importedItems.map((item) => (
            <li key={item.id} className="admin-list__item">
              <span>
                {item.title}{' '}
                <span className="admin-list__meta">
                  {item.type} · /{item.slug}
                  {item.legacy && item.legacy.sourceId != null ? ' · WP source #' + item.legacy.sourceId : ' · WordPress-imported'}
                  {item.edited ? ' · local edit published' : ''}
                </span>
              </span>
              <button type="button" className="button button--ghost" aria-label={'Edit ' + item.title} onClick={() => props.onEditImported(item.id)}>Edit</button>
            </li>
          ))}
        </ul>
      )}

      <h3>Slug health and repair</h3>
      <p className="muted">
        Detection only. Published resources are never renamed automatically; a published slug change requires the
        explicit advanced workflow and preserves the old URL as an alias.
      </p>
      {props.anomalies.length === 0 ? <p className="muted">No suspicious one-character slugs detected.</p> : (
        <ul className="admin-list">
          {props.anomalies.map((finding) => (
            <li key={finding.kind + finding.id} className="admin-list__item">
              <span>
                {finding.title || '(untitled)'}{' '}
                <span className="admin-list__meta">{finding.published ? 'published' : 'draft'} · /{finding.slug} → expected /{finding.expected || '(none)'}</span>
              </span>
              <span className="admin-list__meta">{finding.safeAction}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
