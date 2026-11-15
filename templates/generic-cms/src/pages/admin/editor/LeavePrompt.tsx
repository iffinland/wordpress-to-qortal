export function LeavePrompt(props: {
  onSaveAndLeave: () => void;
  onDiscard: () => void;
  onStay: () => void;
}) {
  return (
    <div className="publish-confirm" role="dialog" aria-modal="true" aria-labelledby="leave-title">
      <h3 id="leave-title">Unsaved changes</h3>
      <p>Save a local draft before leaving? A local draft is not a published update.</p>
      <div className="admin-toolbar">
        <button type="button" className="button" onClick={props.onSaveAndLeave}>Save draft and leave</button>
        <button type="button" className="button button--ghost" onClick={props.onDiscard}>Discard changes</button>
        <button type="button" className="button button--ghost" onClick={props.onStay}>Stay</button>
      </div>
    </div>
  );
}
