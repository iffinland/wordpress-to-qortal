import { useEffect, useMemo, useState } from 'react';
import type { CmsTemplateConfig, ViewerIdentity } from '../../types';
import { defaultSettingsDraft, mergeSettingsIntoConfig, readSettingsDocument, validateSettingsDraft, SITE_SETTINGS_IDENTIFIER } from '../../lib/settings.js';
import { publishSettingsDraft } from '../../lib/authoring.js';
import { useUnsavedGuard } from '../../hooks/useUnsavedGuard';
import { quotePublication } from '../../lib/publish.js';
import { StateNotice } from '../../components/StateNotice';

const DRAFT_KEY = 'qms-cms-settings-draft@1';

function loadDraft(siteId: string, fallback: any) {
  try {
    const raw = localStorage.getItem(DRAFT_KEY + ':' + siteId);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed && parsed.draft ? parsed.draft : fallback;
  } catch {
    return fallback;
  }
}

function saveDraft(siteId: string, draft: unknown) {
  try {
    localStorage.setItem(DRAFT_KEY + ':' + siteId, JSON.stringify({ schema: DRAFT_KEY, siteId, savedAt: new Date().toISOString(), draft }));
  } catch {
    // Draft convenience only; QDN publication is the source of truth.
  }
}

export function SettingsPanel(props: {
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
  const [draft, setDraft] = useState<any>(() => loadDraft(props.siteId, fallback));
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
  const updateNav = (index: number, key: 'label' | 'href', value: string) => { setDirty(true); setDraft((current: any) => {
    const navigation = current.navigation.map((item: any, itemIndex: number) => itemIndex === index ? { ...item, [key]: value } : item);
    return { ...current, navigation };
  }); };
  const addNav = () => { setDirty(true); setDraft((current: any) => ({ ...current, navigation: [...current.navigation, { label: 'New link', href: '#/' }] })); };
  const removeNav = (index: number) => { setDirty(true); setDraft((current: any) => ({ ...current, navigation: current.navigation.filter((_: unknown, itemIndex: number) => itemIndex !== index) })); };

  const persistDraft = (next: unknown) => { setDirty(false); setDraft(next as any); saveDraft(props.siteId, next); };

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
    setConfirming(false);
    setState('publishing');
    setMessage('Waiting for Qortal Hub approval...');
    const timestamp = publishTimestamp || Date.now();
    setPublishTimestamp(timestamp);
    const result = await publishSettingsDraft({
      identity: props.identity,
      name: props.qdnName,
      draft,
      baseRevision: remoteRevision,
      storage: localStorage,
      timestamp
    });
    if (result.ok) {
      setState('verified');
      setMessage(result.message || 'Published and verified.');
      saveDraft(props.siteId, draft);
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

  return (
    <section className="admin-section" aria-labelledby="settings-title">
      <h2 id="settings-title">Site settings</h2>
      <p className="muted">
        Published as a versioned QDN document: <code>DOCUMENT / {props.qdnName} / {SITE_SETTINGS_IDENTIFIER}</code>.
        Drafts stay local; nothing changes on QDN until you confirm publication.
      </p>
      <p className="muted">Published revision: <strong>{remoteRevision}</strong>{remote.ok ? '' : ' (published settings are invalid: ' + remote.errors.join(' ') + ')'}</p>
      {state === 'ambiguous' ? <StateNotice state="partial" title="Publication is unconfirmed" message={message + ' Publishing was not retried automatically.'} /> : null}
      {state === 'conflict' ? <StateNotice state="partial" title="Revision conflict" message={message} /> : null}
      {state === 'failed' ? <StateNotice state="error" title="Settings were not published" message={message} /> : null}
      {state === 'verified' ? <StateNotice state="partial" title="Settings published" message={message} /> : null}

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
        {draft.navigation.map((item: any, index: number) => (
          <div className="admin-row" key={index}>
            <label>Label<input value={item.label} maxLength={40} onChange={(event) => updateNav(index, 'label', event.target.value)} /></label>
            <label>Link<input value={item.href} onChange={(event) => updateNav(index, 'href', event.target.value)} placeholder="#/posts" /></label>
            <button type="button" className="button button--ghost" onClick={() => removeNav(index)} disabled={draft.navigation.length <= 1}>Remove</button>
          </div>
        ))}
        <button type="button" className="button button--ghost" onClick={addNav} disabled={draft.navigation.length >= 12}>Add navigation item</button>
        <p className="muted">The Admin link is never shown to visitors; it appears only after owner verification.</p>
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
      {message ? <p className="admin-message" role="status" aria-live="polite">{message}</p> : null}
      <div className="admin-toolbar">
        <button type="button" className="button button--ghost" onClick={() => persistDraft(draft)}>Save local draft</button>
        <button type="button" className="button button--ghost" onClick={revertToPublished}>Revert to published</button>
        <button type="button" className="button button--ghost" onClick={togglePreview} aria-pressed={previewing}>{previewing ? 'Stop preview' : 'Preview draft'}</button>
        <button type="button" className="button" onClick={requestPublish} disabled={state === 'publishing'}>Publish settings…</button>
      </div>
      {previewing ? <p className="preview-banner" role="status">Preview only — visitors do not see these settings.</p> : null}

      {confirming ? (
        <div className="publish-confirm" role="dialog" aria-modal="true" aria-labelledby="confirm-settings-title">
          <h3 id="confirm-settings-title">Confirm settings publication</h3>
          <dl className="meta-grid">
            <div><dt>Destination</dt><dd>DOCUMENT / {props.qdnName} / {SITE_SETTINGS_IDENTIFIER}</dd></div>
            <div><dt>New revision</dt><dd>{remoteRevision + 1}</dd></div>
            <div><dt>Fee</dt><dd>{fee}</dd></div>
            <div><dt>Signer</dt><dd>{props.identity.address}</dd></div>
          </dl>
          <p className="muted">Ownership is revalidated against the live name record immediately before signing. Qortal Hub asks for approval.</p>
          <div className="admin-toolbar">
            <button type="button" className="button" onClick={publish}>Confirm publish</button>
            <button type="button" className="button button--ghost" onClick={() => setConfirming(false)}>Cancel</button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

