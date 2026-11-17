import { useEffect, useState } from 'react';
import type { CmsContentItem } from '../types';

export type DeletePhase = 'confirm' | 'deleting' | 'done' | 'error';

/**
 * Explicit owner confirmation for removing a catalog item.
 * The wording never promises physical erasure of QDN history.
 */
export function DeletePostDialog(props: {
  item: CmsContentItem;
  phase: DeletePhase;
  message: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const busy = props.phase === 'deleting';
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) props.onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, props.onClose]);

  return (
    <div className="confirm-dialog-backdrop" role="presentation">
      <div className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-post-title" aria-describedby="delete-post-description">
        <h3 id="delete-post-title">Delete “{props.item.title}”?</h3>
        <div id="delete-post-description">
          <p>
            This removes the item from the CMS catalog, search, category and tag listings, and page assignments.
            Visitors will no longer find it through this site.
          </p>
          <p>
            QDN resources are mutable, not erasable. The existing content resource is overwritten in place with a
            deletion marker under the same identifier; older historical versions and any copies outside this CMS
            are not physically erased. This action cannot be undone from the CMS.
          </p>
        </div>
        {props.phase === 'error' && props.message ? (
          <p className="confirm-dialog__status" data-phase="error" role="alert">{props.message}</p>
        ) : null}
        {props.phase === 'done' ? (
          <p className="confirm-dialog__status" data-phase="success" role="status">{props.message || 'Removal confirmed.'}</p>
        ) : null}
        {busy ? <p className="muted" role="status">Waiting for Qortal Hub approval and exact QDN read-back…</p> : null}
        {props.phase === 'confirm' ? (
          <label className="check-row">
            <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
            I understand that historical QDN data is not physically erased.
          </label>
        ) : null}
        <div className="admin-toolbar">
          <button
            type="button"
            className="button button--danger"
            disabled={busy || props.phase === 'done' || (props.phase === 'confirm' && !confirmed)}
            onClick={props.onConfirm}
          >
            {busy ? 'Deleting…' : props.phase === 'error' ? 'Retry removal' : 'Delete from CMS'}
          </button>
          <button type="button" className="button button--ghost" onClick={props.onClose} disabled={busy}>
            {props.phase === 'done' ? 'Close' : 'Cancel'}
          </button>
        </div>
      </div>
    </div>
  );
}
