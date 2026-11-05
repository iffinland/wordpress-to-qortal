import React, { useEffect, useRef, useState } from 'react';
import type { UpdateCheckerState } from '../../../../lib/update/registry.js';
import { formatBytes } from '../../../../lib/update/registry.js';
import { api } from '../api.js';

function statusLabel(state: UpdateCheckerState | null): string {
  if (!state) return 'Checking for updates…';
  if (state.status === 'checking') return 'Checking for updates…';
  if (state.status === 'update_available') return state.stale ? 'Update reported (cached)' : 'Update available';
  if (state.status === 'up_to_date') return 'Qortal Migration Studio is up to date';
  if (state.status === 'incompatible') return 'Update is not compatible';
  if (state.status === 'unverified') return 'Release could not be verified';
  if (state.status === 'unable_to_check') return 'Unable to check for updates';
  return 'Updates';
}

export function Updates() {
  const [state, setState] = useState<UpdateCheckerState | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [nodeUrl, setNodeUrl] = useState('');
  const [savedNode, setSavedNode] = useState('');
  const linkRef = useRef<HTMLInputElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api().updates.state().then((next) => { if (!cancelled) setState(next); }).catch((reason: Error) => { if (!cancelled) setError(reason.message); });
    void api().app.settings().then((settings) => {
      if (cancelled) return;
      const value = typeof settings.updateNodeUrl === 'string' ? settings.updateNodeUrl : '';
      setNodeUrl(value);
      setSavedNode(value);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (open) closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  async function check() {
    setBusy(true);
    setError('');
    try {
      setState(await api().updates.check());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function saveNode() {
    setBusy(true);
    setError('');
    try {
      const next = await api().updates.setNode(nodeUrl);
      setState(next);
      setSavedNode(nodeUrl);
      setNotice('Update source saved and checked.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function openRelease() {
    const url = state?.component?.releaseUrl;
    if (!url) return;
    try {
      await api().updates.openRelease(url);
      setNotice('Opened the release page in your browser.');
    } catch (reason) {
      setNotice('Could not open the release page. Copy the link and open it manually. ' + (reason instanceof Error ? reason.message : String(reason)));
    }
  }

  async function copyLink() {
    const url = state?.artifact?.url;
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setNotice('Download link copied.');
    } catch {
      linkRef.current?.focus();
      linkRef.current?.select();
      setNotice('Clipboard access is unavailable. The link is selected; copy it manually.');
    }
  }

  const component = state?.component;
  const artifact = state?.artifact ?? component?.artifacts?.[0] ?? null;
  const showBadge = Boolean(state?.showBadge);

  return (
    <div className="updates">
      <button
        type="button"
        className={showBadge ? 'primary update-badge' : 'ghost'}
        onClick={() => { setOpen(true); if (state?.status === 'unable_to_check' || state?.status === 'unverified') void check(); }}
      >
        {showBadge ? 'Update available' : 'Updates'}
      </button>
      {open ? (
        <div className="update-overlay" role="presentation">
          <div className="update-dialog" role="dialog" aria-modal="true" aria-labelledby="desktop-update-title">
            <div className="update-dialog__header">
              <div>
                <p className="muted small">{statusLabel(state)}</p>
                <h2 id="desktop-update-title">Qortal Migration Studio updates</h2>
              </div>
              <button ref={closeRef} type="button" className="ghost" onClick={() => setOpen(false)}>Close</button>
            </div>

            <p className="muted">Installed <strong>v{state?.installedVersion ?? '…'}</strong>{state?.stale ? ' · cached result' : ''}</p>

            {state?.status === 'update_available' && component ? (
              <>
                <p>Available <strong>v{component.version}</strong> ({component.channel}), released {new Date(component.releaseDate).toLocaleDateString()}.</p>
                <h3>What changed</h3>
                <p>{component.changelog.summary}</p>
                <h3>Compatibility</h3>
                <ul>
                  <li>Supported platform: {component.supportedPlatforms.join(', ')}</li>
                  {Object.keys(component.minimumDependencies ?? {}).length === 0
                    ? <li>No additional dependency is required.</li>
                    : Object.entries(component.minimumDependencies).map(([name, version]) => <li key={name}>Requires {name} {version} or newer.</li>)}
                  <li>Channel: {component.channel}.</li>
                </ul>
                <h3>Verified download</h3>
                {artifact ? (
                  <dl className="update-artifact">
                    <dt>File</dt><dd>{artifact.name}</dd>
                    <dt>Size</dt><dd>{formatBytes(artifact.bytes)}</dd>
                    <dt>SHA-256</dt><dd><code>{artifact.sha256}</code></dd>
                  </dl>
                ) : <p>No verified artifact is listed for this platform.</p>}
                {artifact ? (
                  <>
                    <input ref={linkRef} className="update-link" readOnly value={artifact.url} aria-label="Release download link" onFocus={(event) => event.currentTarget.select()} />
                    <div className="row wrap gap">
                      <button type="button" className="ghost" onClick={() => void copyLink()}>Copy download link</button>
                      <button type="button" className="ghost" onClick={() => void openRelease()}>Open release page</button>
                    </div>
                  </>
                ) : null}
                <h3>Installation</h3>
                <p>{component.install.instructions}</p>
                <p className="muted">This app never downloads or executes an installer. Download and SHA-256 verification are your explicit actions.</p>
              </>
            ) : (
              <div>
                <p>{state?.reason ?? 'No update information is available.'}</p>
                {state?.networkError ? <p className="muted small">Network detail: {state.networkError}</p> : null}
                {state?.errors?.length ? <ul>{state.errors.slice(0, 5).map((entry) => <li key={entry}>{entry}</li>)}</ul> : null}
                <p className="muted">Startup and normal migration work are not blocked when the registry is unavailable.</p>
              </div>
            )}

            <h3>Update source</h3>
            <p className="muted small">Qortal node serving DOCUMENT/developer iffi/qms-update-registry. HTTPS is required except for a loopback node.</p>
            <div className="row wrap gap">
              <input className="update-link" value={nodeUrl} onChange={(event) => setNodeUrl(event.target.value)} aria-label="Update node URL" placeholder="https://node.example:12391" />
              <button type="button" className="ghost" disabled={busy || nodeUrl.trim() === savedNode} onClick={() => void saveNode()}>Save and check</button>
            </div>

            {error ? <p className="bad-text" role="alert">{error}</p> : null}
            {notice ? <p className="muted" role="status">{notice}</p> : null}

            <div className="row wrap gap update-dialog__footer">
              <button type="button" className="primary" disabled={busy || state?.status === 'checking'} onClick={() => void check()}>
                {busy || state?.status === 'checking' ? 'Checking…' : 'Check for updates'}
              </button>
              {state?.checkedAt ? <span className="muted small">Last checked {new Date(state.checkedAt).toLocaleString()}</span> : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
