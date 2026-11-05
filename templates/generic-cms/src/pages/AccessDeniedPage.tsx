import type { ViewerIdentity } from '../types';

export function AccessDeniedPage(props: {
  identity: ViewerIdentity | null;
  notice?: string;
  busy?: boolean;
  onConnect?: () => void;
  onRetry?: () => void;
}) {
  const identity = props.identity;
  const reason = identity ? identity.message : props.notice || 'Qortal identity could not be resolved.';
  const action = identity && identity.action ? identity.action : 'none';
  return (
    <div className="page access-denied" role="alert">
      <p className="eyebrow">Administration</p>
      <h1>Access denied</h1>
      <p>
        This area is limited to the verified on-chain owner of this QDN name. The active account is not that owner, or
        ownership could not be established.
      </p>
      <p className="muted">{reason}</p>
      {action === 'connect' && props.onConnect ? (
        <div className="access-actions">
          <button type="button" className="button" onClick={props.onConnect} disabled={props.busy}>
            {props.busy ? 'Connecting...' : 'Connect owner account'}
          </button>
          <p className="muted">Approve the account request in Qortal Hub. Ownership is re-checked against the on-chain name record afterwards.</p>
        </div>
      ) : null}
      {action === 'retry' && props.onRetry ? (
        <div className="access-actions">
          <button type="button" className="button" onClick={props.onRetry} disabled={props.busy}>
            {props.busy ? 'Checking...' : 'Retry ownership check'}
          </button>
          <p className="muted">This is not a permission problem: the node or name registry could not be read. Check the Hub connection and retry.</p>
        </div>
      ) : null}
      {action === 'open-in-hub' ? (
        <div className="access-actions">
          <p className="muted">Open this site through Qortal Hub so the active account and the Qortal request bridge are available.</p>
        </div>
      ) : null}
      {action === 'none' && props.onRetry ? (
        <div className="access-actions">
          <button type="button" className="button button--ghost" onClick={props.onRetry} disabled={props.busy}>
            {props.busy ? 'Checking...' : 'Check again'}
          </button>
        </div>
      ) : null}
      <p>
        Public pages, posts, search and galleries remain available. <a href="#/">Return to the site</a>.
      </p>
      <dl className="meta-grid">
        <div><dt>QDN name</dt><dd>{identity && identity.qdnName || '(unknown)'}</dd></div>
        <div><dt>Active account</dt><dd>{identity && identity.address || '(not connected)'}</dd></div>
        <div><dt>Ownership check</dt><dd>{identity ? identity.reason : 'unavailable'}</dd></div>
        <div><dt>Name record</dt><dd>{identity ? (identity.nameRecordStatus || 'none') : 'unavailable'}{identity && identity.nameRecordSource ? ' (' + identity.nameRecordSource + ')' : ''}</dd></div>
        {identity && identity.nameRecordError ? <div><dt>Registry detail</dt><dd>{identity.nameRecordError}</dd></div> : null}
      </dl>
    </div>
  );
}

