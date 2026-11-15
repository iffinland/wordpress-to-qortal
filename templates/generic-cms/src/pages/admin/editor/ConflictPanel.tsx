import type { LoadedContent } from '../../../types';
import { stripHtml } from '../../../lib/text.js';

export function ConflictPanel(props: {
  draft: any;
  conflict: { open: boolean; upstream?: LoadedContent; local?: LoadedContent };
  onResolve: (resolution: 'keep-local' | 'accept-upstream') => void;
}) {
  return (
    <section className="conflict-panel" aria-labelledby="conflict-title" role="alert">
      <h3 id="conflict-title">The WordPress source changed after your edit</h3>
      <p className="muted">
        Your local edit is still published and visible. Choose what to keep. Nothing is overwritten
        automatically and the imported resource is never modified.
      </p>
      <dl className="meta-grid">
        <div><dt>Your published title</dt><dd>{props.draft.title}</dd></div>
        <div><dt>Upstream title now</dt><dd>{props.conflict.upstream ? props.conflict.upstream.title : '(unavailable)'}</dd></div>
        <div><dt>Your excerpt</dt><dd>{props.draft.excerpt || '(none)'}</dd></div>
        <div><dt>Upstream excerpt</dt><dd>{props.conflict.upstream ? stripHtml(props.conflict.upstream.excerptHtml) : '(unavailable)'}</dd></div>
      </dl>
      <div className="admin-toolbar">
        <button type="button" className="button" onClick={() => props.onResolve('keep-local')}>Keep my edits</button>
        <button type="button" className="button button--ghost" onClick={() => props.onResolve('accept-upstream')}>Accept upstream</button>
      </div>
    </section>
  );
}
