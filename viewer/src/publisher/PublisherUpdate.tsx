import { useEffect, useRef, useState } from 'react';
import type { UpdateCheckerState } from '../../../lib/update/registry.js';
import { formatBytes } from '../../../lib/update/registry.js';
import { APP_VERSION } from '../version';
import { createPublisherUpdateChecker } from './updates';

function label(state: UpdateCheckerState): string {
  if (state.status === 'checking') return 'Checking for Publisher updates…';
  if (state.status === 'update_available') return state.stale ? 'Publisher update reported (cached)' : 'Publisher update available';
  if (state.status === 'incompatible') return 'Publisher update not compatible';
  if (state.status === 'unverified') return 'Publisher release could not be verified';
  if (state.status === 'unable_to_check') return 'Unable to check for Publisher updates';
  return 'Publisher is up to date';
}

export function PublisherUpdate() {
  const [checker] = useState(() => createPublisherUpdateChecker(APP_VERSION));
  const [state, setState] = useState<UpdateCheckerState>(() => checker.getState());
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const unsubscribe = checker.subscribe(setState);
    void checker.check();
    return unsubscribe;
  }, [checker]);

  useEffect(() => {
    if (open) closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const component = state.component;
  const artifact = state.artifact ?? component?.artifacts?.[0] ?? null;

  const openRelease = () => {
    if (!component?.releaseUrl) return;
    try {
      const opened = window.open(component.releaseUrl, '_blank', 'noopener,noreferrer');
      setNotice(opened
        ? 'Opened the release page in a new tab.'
        : 'Qortal Hub blocked the external tab. Copy the link below into your browser.');
    } catch {
      setNotice('Qortal Hub blocked the external tab. Copy the link below into your browser.');
    }
  };

  const copyLink = async () => {
    if (!artifact?.url) return;
    try {
      await navigator.clipboard.writeText(artifact.url);
      setNotice('Download link copied.');
    } catch {
      setNotice('Clipboard access is unavailable. Select and copy the link shown in the update view.');
    }
  };

  return (
    <div className="publisher-update">
      {state.showBadge ? (
        <button type="button" className="publisher-update__badge" onClick={() => setOpen(true)}>
          Publisher update available
        </button>
      ) : (
        <button type="button" className="publisher-update__link" onClick={() => { setOpen(true); void checker.check(true); }}>
          Check for updates
        </button>
      )}
      <span className="publisher-update__status" role="status">{open ? '' : label(state)}</span>

      {open ? (
        <div className="publisher-update__overlay" role="presentation">
          <div className="publisher-update__dialog" role="dialog" aria-modal="true" aria-labelledby="publisher-update-title">
            <div className="publisher-update__row">
              <div>
                <p className="eyebrow">{label(state)}</p>
                <h2 id="publisher-update-title">Migration Publisher updates</h2>
              </div>
              <button ref={closeRef} type="button" onClick={() => setOpen(false)}>Close</button>
            </div>
            <p>Installed Publisher <strong>v{state.installedVersion}</strong>{state.stale ? ' · cached result' : ''}</p>
            {state.status === 'update_available' && component ? (
              <>
                <p>Available <strong>v{component.version}</strong> ({component.channel}), released {new Date(component.releaseDate).toLocaleDateString()}.</p>
                <h3>What changed</h3>
                <p>{component.changelog.summary}</p>
                <h3>Compatibility and deployment</h3>
                <p>{component.install.instructions}</p>
                <p>Existing handoff validation, owner identity checks, approval gates and read-back receipts are unchanged.</p>
                {artifact ? (
                  <dl className="publisher-update__artifact">
                    <dt>File</dt><dd>{artifact.name}</dd>
                    <dt>Size</dt><dd>{formatBytes(artifact.bytes)}</dd>
                    <dt>SHA-256</dt><dd><code>{artifact.sha256}</code></dd>
                  </dl>
                ) : null}
                {artifact ? (
                  <div className="publisher-update__actions">
                    <input readOnly value={artifact.url} aria-label="Publisher download URL" onFocus={(event) => event.currentTarget.select()} />
                    <button type="button" onClick={() => void copyLink()}>Copy link</button>
                    <button type="button" onClick={openRelease}>Open release page</button>
                  </div>
                ) : null}
                <p className="muted">Nothing is downloaded or installed automatically. Republish the Publisher Q-App in Qortal Hub yourself.</p>
              </>
            ) : (
              <div>
                <p>{state.reason}</p>
                {state.networkError ? <p className="muted">Network detail: {state.networkError}</p> : null}
                <p className="muted">Handoff validation and publishing are unaffected; no update badge is shown without a verified newer Publisher release.</p>
              </div>
            )}
            {notice ? <p role="status">{notice}</p> : null}
            <div className="publisher-update__row">
              <button type="button" onClick={() => void checker.check(true)} disabled={state.status === 'checking'}>
                {state.status === 'checking' ? 'Checking…' : 'Check for updates'}
              </button>
              {state.checkedAt ? <span className="muted">Last checked {new Date(state.checkedAt).toLocaleString()}</span> : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
