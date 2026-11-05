import type { ViewerIdentity } from '../types';

export function AccessDeniedPage(props: { identity: ViewerIdentity | null; notice?: string }) {
  const reason = props.identity
    ? props.identity.message
    : props.notice || 'Qortal identity could not be resolved.';
  return (
    <div className="page access-denied" role="alert">
      <p className="eyebrow">Administration</p>
      <h1>Access denied</h1>
      <p>
        This area is limited to the verified on-chain owner of this QDN name. The active account is not that owner, or
        ownership could not be established.
      </p>
      <p className="muted">{reason}</p>
      <p>
        Public pages, posts, search and galleries remain available. <a href="#/">Return to the site</a>.
      </p>
      <dl className="meta-grid">
        <div><dt>QDN name</dt><dd>{props.identity && props.identity.qdnName || '(unknown)'}</dd></div>
        <div><dt>Active account</dt><dd>{props.identity && props.identity.address || '(not signed in)'}</dd></div>
        <div><dt>Ownership check</dt><dd>{props.identity ? props.identity.reason : 'unavailable'}</dd></div>
      </dl>
    </div>
  );
}

