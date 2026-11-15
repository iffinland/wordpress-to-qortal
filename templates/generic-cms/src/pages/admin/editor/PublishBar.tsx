import { StateNotice } from '../../../components/StateNotice';

export type EditorPublishState = 'idle' | 'publishing' | 'verified' | 'partial' | 'ambiguous' | 'failed';

export function PublishBar(props: {
  state: EditorPublishState;
  message: string;
  dirty: boolean;
  sourceKindLabel: string;
  /** True while the publish dialog is open; it shows the status itself. */
  dialogOpen?: boolean;
  onLeave: () => void;
  onSaveDraft: () => void;
  onPreview: () => void;
  onPublish: () => void;
}) {
  return (
    <>
      <div className="admin-toolbar">
        <button type="button" className="button button--ghost" onClick={props.onLeave}>← All posts</button>
        <button type="button" className="button button--ghost" onClick={props.onSaveDraft}>Save draft</button>
        <button type="button" className="button button--ghost" onClick={props.onPreview}>Preview</button>
        <button type="button" className="button" onClick={props.onPublish} disabled={props.state === 'publishing'}>Publish post…</button>
      </div>
      <p className="editor-source-kind" role="status">{props.sourceKindLabel}</p>
      {props.message && !props.dialogOpen ? <p className="admin-message" role="status" aria-live="polite">{props.message}</p> : null}
      {props.dirty ? <p className="preview-banner" role="status">Unsaved changes — save a local draft or publish. A local draft is not a published update.</p> : null}

      {!props.dialogOpen && props.state === 'ambiguous' ? <StateNotice state="partial" title="Publication unconfirmed" message={props.message + ' It was not resent automatically. Retry to verify the pending submission.'} /> : null}
      {!props.dialogOpen && props.state === 'partial' ? <StateNotice state="partial" title="Published, search index pending" message={props.message} /> : null}
      {!props.dialogOpen && props.state === 'failed' ? <StateNotice state="error" title="Not published" message={props.message} /> : null}
      {!props.dialogOpen && props.state === 'verified' ? <StateNotice state="partial" title="Published and verified" message={props.message} /> : null}
    </>
  );
}
