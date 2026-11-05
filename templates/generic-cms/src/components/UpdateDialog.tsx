import { useEffect, useRef, useState } from 'react';
import type { UpdateCheckerState } from '../../../../lib/update/registry.js';
import { formatBytes } from '../../../../lib/update/registry.js';
import { stateLabel } from '../lib/updates.js';

function statusTone(status: string): string {
  if (status === 'update_available') return 'good';
  if (status === 'incompatible' || status === 'unverified') return 'warn';
  if (status === 'unable_to_check') return 'bad';
  return 'neutral';
}

function CopyableUrl({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  const copy = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setNotice('Link copied.');
        return;
      }
    } catch {
      // Fall through to manual selection, which also works on Android Hub.
    }
    try {
      inputRef.current?.focus();
      inputRef.current?.select();
      setNotice('Select the link and copy it manually.');
    } catch {
      setNotice('Copy this link manually.');
    }
  };

  return (
    <div className="update-url">
      <input ref={inputRef} readOnly value={url} aria-label="Release download link" onFocus={(event) => event.currentTarget.select()} />
      <button type="button" className="button-link" onClick={() => void copy()}>{copied ? 'Copied' : 'Copy link'}</button>
      {notice ? <span className="update-url__notice" role="status">{notice}</span> : null}
    </div>
  );
}

export function UpdateDialog(props: {
  state: UpdateCheckerState;
  open: boolean;
  onClose: () => void;
  onCheck: () => void;
  customized: boolean;
  hasPublishedSettings: boolean;
}) {
  const { state } = props;
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const [openNotice, setOpenNotice] = useState('');

  useEffect(() => {
    if (!props.open) return;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') props.onClose();
      if (event.key === 'Tab' && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>('button, a, input, [tabindex]:not([tabindex="-1"])');
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [props.open, props.onClose]);

  if (!props.open) return null;
  const component = state.component;
  const update = state.status === 'update_available' && component;
  const artifact = state.artifact ?? component?.artifacts?.[0] ?? null;

  const openRelease = () => {
    if (!component?.releaseUrl) return;
    try {
      const opened = window.open(component.releaseUrl, '_blank', 'noopener,noreferrer');
      setOpenNotice(opened
        ? 'Opened the release page in a new tab.'
        : 'Qortal Hub blocked the external tab. Copy the link below and open it in your browser.');
    } catch {
      setOpenNotice('Qortal Hub blocked the external tab. Copy the link below and open it in your browser.');
    }
  };

  return (
    <div className="update-overlay" role="presentation">
      <div
        className="update-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="qms-update-title"
        ref={dialogRef}
      >
        <div className="update-dialog__header">
          <div>
            <p className={'update-status update-status--' + statusTone(state.status)} role="status">{stateLabel(state)}</p>
            <h2 id="qms-update-title">Template updates</h2>
          </div>
          <button ref={closeRef} type="button" className="button-link" aria-label="Close update details" onClick={props.onClose}>Close</button>
        </div>

        <p className="update-dialog__installed">Installed template <strong>v{state.installedVersion}</strong>{state.stale ? ' · cached result' : ''}</p>

        {state.status === 'update_available' && component ? (
          <>
            <p className="update-dialog__versions">
              Update available: <strong>v{component.version}</strong> ({component.channel}) released {new Date(component.releaseDate).toLocaleDateString()}
            </p>
            <section aria-labelledby="qms-update-changes">
              <h3 id="qms-update-changes">What changed</h3>
              <p>{component.changelog.summary}</p>
            </section>
            <section aria-labelledby="qms-update-compat">
              <h3 id="qms-update-compat">Compatibility</h3>
              <ul>
                <li>Supported deployment: Qortal Hub on desktop and Android (Q-App bundle).</li>
                <li>Channel: {component.channel}; installed channel: {state.installedChannel ?? 'unknown'}.</li>
                {Object.keys(component.minimumDependencies ?? {}).length === 0
                  ? <li>No additional dependency is required.</li>
                  : Object.entries(component.minimumDependencies).map(([name, version]) => (
                    <li key={name}>Requires {name} {version} or newer.</li>
                  ))}
                {(props.customized || props.hasPublishedSettings) ? (
                  <li className="update-warning">
                    This site already has a runtime qms-cms-config.json or published settings.
                    Do not overwrite a customized CMS with the generic ZIP; preserve those files
                    and merge only the template changes.
                  </li>
                ) : null}
              </ul>
            </section>
            <section aria-labelledby="qms-update-artifact">
              <h3 id="qms-update-artifact">Verified download</h3>
              {artifact ? (
                <dl className="update-artifact">
                  <dt>File</dt><dd>{artifact.name}</dd>
                  <dt>Size</dt><dd>{formatBytes(artifact.bytes)}</dd>
                  <dt>SHA-256</dt><dd><code>{artifact.sha256}</code></dd>
                  <dt>Format</dt><dd>{artifact.format === 'zip' ? 'Q-App ZIP' : artifact.format}</dd>
                </dl>
              ) : <p>No artifact is listed for this platform.</p>}
              {artifact ? <CopyableUrl url={artifact.url} /> : null}
              <div className="update-actions">
                <button type="button" className="button-primary" onClick={openRelease}>Open release page</button>
                {openNotice ? <p role="status" className="update-url__notice">{openNotice}</p> : null}
              </div>
            </section>
            <section aria-labelledby="qms-update-deploy">
              <h3 id="qms-update-deploy">Deployment</h3>
              <p>{component.install.instructions}</p>
              <p className="muted">This running WEBSITE/APP is never replaced automatically. Downloading and republishing are separate, owner-approved actions in Qortal Hub.</p>
            </section>
          </>
        ) : (
          <div className="update-dialog__state">
            <p>{state.reason}</p>
            {state.networkError ? <p className="muted small">Network detail: {state.networkError}</p> : null}
            {state.errors?.length ? <ul>{state.errors.slice(0, 5).map((error) => <li key={error}>{error}</li>)}</ul> : null}
            <p className="muted">The registry is unavailable or the release is unverified. Normal CMS operation continues; no update badge is shown.</p>
          </div>
        )}

        <div className="update-dialog__footer">
          <button type="button" className="button-link" onClick={props.onCheck} disabled={state.status === 'checking'}>
            {state.status === 'checking' ? 'Checking…' : 'Check for updates'}
          </button>
          {state.checkedAt ? <span className="muted small">Last checked {new Date(state.checkedAt).toLocaleString()}</span> : null}
        </div>
      </div>
    </div>
  );
}
