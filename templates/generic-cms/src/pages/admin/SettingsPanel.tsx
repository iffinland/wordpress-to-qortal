import { useEffect, useMemo, useState } from 'react';
import type { CmsContentItem, CmsTemplateConfig, ViewerIdentity } from '../../types';
import { defaultSettingsDraft, mergeSettingsIntoConfig, readSettingsDocument, validateSettingsDraft, SITE_SETTINGS_IDENTIFIER } from '../../lib/settings.js';
import { publishSettingsDraft } from '../../lib/authoring.js';
import { useUnsavedGuard } from '../../hooks/useUnsavedGuard';
import { quotePublication } from '../../lib/publish.js';
import { NavigationEditor } from './NavigationEditor';
import { StateNotice } from '../../components/StateNotice';
import { ConfirmPublishDialog, type PublishPhase } from '../../components/ConfirmPublishDialog';
import { createScopedStorage, scopedKey, storageScope } from '../../lib/storageScope.js';
import { TEMPLATE_OPTIONS } from '../../lib/template.js';

const DRAFT_KEY = 'qms-cms-settings-draft@1';

function loadDraft(scope: any, fallback: any) {
  const key = scopedKey(DRAFT_KEY, scope);
  if (!key) return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed && parsed.draft ? parsed.draft : fallback;
  } catch {
    return fallback;
  }
}

function saveDraft(scope: any, draft: unknown) {
  const key = scopedKey(DRAFT_KEY, scope);
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify({ schema: DRAFT_KEY, siteId: (scope.binding && scope.binding.siteId) || '', savedAt: new Date().toISOString(), draft }));
  } catch {
    // Draft convenience only; QDN publication is the source of truth.
  }
}

export function SettingsPanel(props: {
  pages?: CmsContentItem[];
  config: CmsTemplateConfig;
  identity: ViewerIdentity;
  qdnName: string;
  siteId: string;
  remoteSettings: unknown;
  onPreview: (draft: unknown | null) => void;
  onPublished: (settings: unknown) => void;
}) {
  const remote = useMemo(() => readSettingsDocument(props.remoteSettings), [props.remoteSettings]);
  const remoteRevision = remote.ok && remote.settings ? Number(remote.settings.revision) || 0 : 0;
  const fallback = useMemo(() => {
    if (remote.ok && remote.settings) {
      const merged = mergeSettingsIntoConfig(props.config, remote.settings, { qdnName: props.qdnName });
      return defaultSettingsDraft(merged);
    }
    return defaultSettingsDraft(props.config);
  }, [props.config, props.remoteSettings, props.qdnName]);
  const scope = useMemo(() => storageScope({
    deployment: props.config.deployment,
    identity: props.identity,
    siteId: props.siteId
  }), [props.config.deployment, props.identity, props.siteId]);
  const [draft, setDraft] = useState<any>(() => loadDraft(scope, fallback));
  const [state, setState] = useState<'idle' | 'publishing' | 'verified' | 'ambiguous' | 'failed' | 'conflict'>('idle');
  const [message, setMessage] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [fee, setFee] = useState('Checking node fee...');
  const [previewing, setPreviewing] = useState(false);
  const [publishTimestamp, setPublishTimestamp] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  useUnsavedGuard(dirty);

  useEffect(() => {
    let cancelled = false;
    quotePublication(1).then((quote) => { if (!cancelled) setFee(quote.label); }).catch(() => { if (!cancelled) setFee('Fee unavailable.'); });
    return () => { cancelled = true; };
  }, []);

  const updateSite = (key: string, value: string) => { setDirty(true); setDraft((current: any) => ({ ...current, site: { ...current.site, [key]: value } })); };
  const updateColor = (key: string, value: string) => { setDirty(true); setDraft((current: any) => ({ ...current, colors: { ...current.colors, [key]: value } })); };
  const persistDraft = (next: unknown) => { setDirty(false); setDraft(next as any); saveDraft(scope, next); };

  const revertToPublished = () => {
    setDraft(fallback);
    setDirty(false);
    setMessage('Reverted to the last published settings. Local draft changes were discarded.');
    setState('idle');
    props.onPreview(null);
  };

  const togglePreview = () => {
    if (previewing) {
      setPreviewing(false);
      props.onPreview(null);
      return;
    }
    const validation = validateSettingsDraft(draft);
    if (!validation.ok) { setMessage(validation.errors.join(' ')); return; }
    setPreviewing(true);
    setMessage('');
    props.onPreview(draft);
  };

  const requestPublish = () => {
    const validation = validateSettingsDraft(draft);
    if (!validation.ok) { setMessage(validation.errors.join(' ')); setState('failed'); return; }
    setMessage('');
    setState('idle');
    setConfirming(true);
  };

  const publish = async () => {
    // The dialog stays open: progress and the result are shown inside it.
    setState('publishing');
    setMessage('Waiting for Qortal Hub approval...');
    const timestamp = publishTimestamp || Date.now();
    setPublishTimestamp(timestamp);
    const result = await publishSettingsDraft({
      identity: props.identity,
      name: props.qdnName,
      draft,
      baseRevision: remoteRevision,
      storage: createScopedStorage(localStorage, scope),
      timestamp
    });
    if (result.ok) {
      setState('verified');
      setMessage(result.message || 'Published and verified.');
      saveDraft(scope, draft);
      setDirty(false);
      props.onPublished((result as any).document);
      setPreviewing(false);
      setPublishTimestamp(null);
      props.onPreview(null);
      return;
    }
    setState(result.state === 'conflict' ? 'conflict' : result.state === 'ambiguous' ? 'ambiguous' : 'failed');
    setMessage(result.message || 'Publishing failed.');
  };

  const publishPhase: PublishPhase = state === 'publishing' ? 'publishing'
    : state === 'verified' ? 'success'
    : state === 'ambiguous' ? 'ambiguous'
    : state === 'conflict' || state === 'failed' ? 'error'
    : 'confirm';

  return (
    <section className="admin-section" aria-labelledby="settings-title">
      <h2 id="settings-title">Site settings</h2>
      <p className="muted">
        Published as a versioned QDN document: <code>DOCUMENT / {props.qdnName} / {SITE_SETTINGS_IDENTIFIER}</code>.
        Drafts stay local; nothing changes on QDN until you confirm publication.
      </p>
      <p className="muted">Published revision: <strong>{remoteRevision}</strong>{remote.ok ? '' : ' (published settings are invalid: ' + remote.errors.join(' ') + ')'}</p>
      {!confirming && state === 'ambiguous' ? <StateNotice state="partial" title="Publication is unconfirmed" message={message + ' Publishing was not retried automatically.'} /> : null}
      {!confirming && state === 'conflict' ? <StateNotice state="partial" title="Revision conflict" message={message} /> : null}
      {!confirming && state === 'failed' ? <StateNotice state="error" title="Settings were not published" message={message} /> : null}
      {!confirming && state === 'verified' ? <StateNotice state="partial" title="Settings published" message={message} /> : null}

      <fieldset className="admin-fieldset">
        <legend>Identity</legend>
        <label>Site title<input value={draft.site.title} maxLength={120} onChange={(event) => updateSite('title', event.target.value)} /></label>
        <label>Tagline<input value={draft.site.tagline} maxLength={200} onChange={(event) => updateSite('tagline', event.target.value)} /></label>
        <label>Description<textarea rows={3} value={draft.site.description} onChange={(event) => updateSite('description', event.target.value)} /></label>
        <label>Footer text (separate from the Qortal attribution)<textarea rows={2} value={draft.site.footerText} maxLength={500} onChange={(event) => updateSite('footerText', event.target.value)} /></label>
        <label>Public author name<input value={draft.site.publicAuthor} onChange={(event) => updateSite('publicAuthor', event.target.value)} /></label>
      </fieldset>

      <fieldset className="admin-fieldset">
        <legend>Navigation</legend>
        <NavigationEditor items={draft.navigation} pages={props.pages || []} onChange={(navigation) => { setDirty(true); setDraft((current: any) => ({ ...current, navigation })); }} />
        <p className="muted">The Admin link is never shown to visitors; it appears only after owner verification.</p>
      </fieldset>

      <fieldset className="admin-fieldset">
        <legend>Template</legend>
        <p className="muted">Templates change presentation only. Posts, pages, media, links and publishing stay exactly the same when you switch.</p>
        <div className="template-choice-grid">
          {TEMPLATE_OPTIONS.map((option) => {
            const selected = (draft.appearance && draft.appearance.template ? draft.appearance.template : 'default') === option.id;
            return (
              <label key={option.id} className={'template-choice' + (selected ? ' is-selected' : '')}>
                <input
                  type="radio"
                  name="cms-template"
                  value={option.id}
                  checked={selected}
                  onChange={() => {
                    setDirty(true);
                    setDraft((current: any) => ({ ...current, appearance: { ...(current.appearance || {}), template: option.id } }));
                  }}
                />
                <span className="template-choice__text">
                  <strong>{option.label}</strong>
                  <span className="muted">{option.description}</span>
                </span>
              </label>
            );
          })}
        </div>
        <p className="muted">Use Preview draft, then publish the settings to make the template live for visitors.</p>
      </fieldset>

      <fieldset className="admin-fieldset">
        <legend>Branding colors</legend>
        <div className="color-grid">
          {['accent', 'background', 'surface', 'text'].map((key) => (
            <label key={key}>{key}<input type="text" value={draft.colors[key] || ''} onChange={(event) => updateColor(key, event.target.value)} aria-label={key + ' color'} /></label>
          ))}
        </div>
        <p className="muted">Light mode uses an accessible light palette derived from these colors; the accent is preserved.</p>
      </fieldset>

      {dirty ? <p className="preview-banner" role="status">Unsaved settings changes. A local draft is not a published update.</p> : null}
      {message && !confirming ? <p className="admin-message" role="status" aria-live="polite">{message}</p> : null}
      <div className="admin-toolbar">
        <button type="button" className="button button--ghost" onClick={() => persistDraft(draft)}>Save local draft</button>
        <button type="button" className="button button--ghost" onClick={revertToPublished}>Revert to published</button>
        <button type="button" className="button button--ghost" onClick={togglePreview} aria-pressed={previewing}>{previewing ? 'Stop preview' : 'Preview draft'}</button>
        <button type="button" className="button" onClick={requestPublish} disabled={state === 'publishing'}>Publish settings…</button>
      </div>
      {previewing ? <p className="preview-banner" role="status">Preview only — visitors do not see these settings.</p> : null}

      {confirming ? (
        <ConfirmPublishDialog
          title="Confirm settings publication"
          phase={publishPhase}
          statusMessage={state === 'ambiguous' ? message + ' Publishing was not retried automatically.' : message}
          onConfirm={publish}
          onCancel={() => setConfirming(false)}
          onClose={() => setConfirming(false)}
        >
          <dl className="meta-grid">
            <div><dt>Destination</dt><dd>DOCUMENT / {props.qdnName} / {SITE_SETTINGS_IDENTIFIER}</dd></div>
            <div><dt>New revision</dt><dd>{remoteRevision + 1}</dd></div>
            <div><dt>Fee</dt><dd>{fee}</dd></div>
            <div><dt>Signer</dt><dd>{props.identity.address}</dd></div>
          </dl>
          <p className="muted">Ownership is revalidated against the live name record immediately before signing. Qortal Hub asks for approval.</p>
        </ConfirmPublishDialog>
      ) : null}
    </section>
  );
}

