import React, { useEffect, useState } from 'react';
import type { ProjectDocument } from '../../shared/types.js';
import { WordPressConnection, wordpressAuth, type WordPressAuthMode } from './WordPressConnection.js';
import { api } from '../api.js';
import { Alert, Card, ErrorText, Field } from './Common.js';

type Review = { token: string; needsConfirmation: boolean; target: { name: string; service: string }; conflicts: Array<{ id: string; name: string }>; remote: { status: string; message: string } };
export function DestinationReview({ projectId, nodeUrl, onApproved }: { projectId: string; nodeUrl: string; onApproved?: () => void }) {
  const [review, setReview] = useState<Review | null>(null);
  const [approved, setApproved] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function inspect() {
    setBusy(true); setError(null); setApproved(false); setConfirm(false);
    try { setReview(await api().workflow(projectId, 'destination', { nodeUrl }) as unknown as Review); }
    catch (err) { setError(err); } finally { setBusy(false); }
  }
  return <Card title="Review the publishing address" subtitle="A Qortal name has one public website per service. An independent project can replace the application at the same address.">
    <ErrorText error={error} />
    <button disabled={busy} onClick={() => void inspect()}>{busy ? 'Checking address…' : 'Check publishing address'}</button>
    {review && <div className="stack-sm"><p><strong>{review.target.service} / {review.target.name}</strong></p>
      <Alert tone={review.needsConfirmation ? 'warn' : 'info'}>{review.remote.message}</Alert>
      {review.conflicts.length > 0 && <p>Other local projects at this address: {review.conflicts.map(entry => entry.name).join(', ')}. Continue one of those projects to keep its catalog.</p>}
      {!approved && <><label className="checkbox"><input type="checkbox" checked={confirm} onChange={event => setConfirm(event.target.checked)} />{review.needsConfirmation ? 'I understand that this package may replace the website at this address. I have checked which project I want to publish.' : 'This is the publishing address I want to use.'}</label>
      <button disabled={busy || !confirm} onClick={() => { setBusy(true); void api().workflow(projectId, 'approveDestination', { token: review.token }).then(() => { setApproved(true); onApproved?.(); }).catch(setError).finally(() => setBusy(false)); }}>Confirm publishing address</button></>}
      {approved && <Alert tone="good">Publishing address confirmed. Hub will still ask you to approve the actual publication.</Alert>}
    </div>}
  </Card>;
}

export function ProjectSettings({ project, nodeUrl, onSaved, onBack }: { project: ProjectDocument; nodeUrl: string; onSaved: () => Promise<void>; onBack: () => void }) {
  const website = (project.settings.website ?? (project.settings.desktopWizard as Record<string, unknown> | undefined)?.website ?? {}) as Record<string, unknown>;
  const [name, setName] = useState(project.name);
  const [title, setTitle] = useState(String(project.target.siteName ?? project.name));
  const [description, setDescription] = useState(String(project.target.siteDescription ?? ''));
  const [target, setTarget] = useState(String(project.target.qdnName ?? ''));
  const [service, setService] = useState(String(website.service ?? 'APP'));
  const [cms, setCms] = useState(String(website.cms ?? 'generic-cms'));
  const [keyringAvailable, setKeyringAvailable] = useState(false);
  useEffect(() => { void api().app.settings().then(value => setKeyringAvailable(value.keyring.available)).catch(() => {}); }, []);
  const [authMode, setAuthMode] = useState<WordPressAuthMode>(() => ['none', 'session', 'application_password'].includes(String(project.source.authMode)) ? project.source.authMode as WordPressAuthMode : ((project.settings.desktopWizard as Record<string, unknown> | undefined)?.authMode as WordPressAuthMode ?? 'none'));
  const [browserOpened, setBrowserOpened] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [migration, setMigration] = useState<Record<string, unknown> | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState('');
  async function perform(task: () => Promise<void>) { setBusy(true); setError(null); try { await task(); } catch (err) { setError(err); } finally { setBusy(false); } }
  async function save() {
    // Reset first checks unresolved publications; metadata can never invalidate a pending package silently.
    const changed = target.trim() !== project.target.qdnName;
    if (changed && !migration) {
      const identity = await api().identity.get(project.id);
      if (identity.mappings.length) { setMigration(await api().identity.migrationPreview(project.id, { qdnName: target.trim() })); return; }
    }
    if (migration && !confirm) throw new Error('Review and confirm the new publishing destination first.');
    await api().workflow(project.id, 'reset');
    if (migration) await api().identity.applyMigration(project.id, String(migration.token));
    await api().projects.update(project.id, { name: name.trim(), target: { qdnName: target.trim(), siteName: title.trim(), siteDescription: description.trim() }, settings: { website: { ...website, cms, service, tagline: description.trim() }, destinationApproval: null, destinationReview: null } });
    setMigration(null); setConfirm(false); setNotice('Project settings saved. The site identity and previous publication history are preserved. Review the publishing address before preparing the next package.'); await onSaved();
  }
  return <div className="stack">
    <div className="row between wrap gap"><div><h2>Project settings</h2><p className="muted">Your local project name, WordPress login and Qortal publishing name are separate settings.</p></div><button onClick={onBack}>Back to project</button></div>
    <ErrorText error={error} />{notice && <Alert tone="good">{notice}</Alert>}
    <Card title="Project and website"><div className="stack">
      <Field label="Local project name" hint="Only the name in QMS changes. It does not create another website."><input value={name} maxLength={120} onChange={event => setName(event.target.value)} /></Field>
      <button disabled={busy || !name.trim()} onClick={() => void perform(async () => { await api().projects.update(project.id, { name: name.trim() }); setNotice('Local project name saved.'); await onSaved(); })}>Save local name</button>
      <Field label="Website title"><input value={title} maxLength={120} onChange={event => setTitle(event.target.value)} /></Field>
      <Field label="Website description"><textarea value={description} maxLength={1000} onChange={event => setDescription(event.target.value)} /></Field>
      <Field label="Qortal publishing name" hint="Changing this name requires publication at the new address. Previous QDN resources stay at their original address."><input value={target} onChange={event => { setTarget(event.target.value); setMigration(null); setConfirm(false); }} /></Field>
      <div className="grid-2"><Field label="Publication type"><select value={cms} onChange={event => setCms(event.target.value)}><option value="generic-cms">Website and content</option><option value="none">Content only</option></select></Field>
      <Field label="Website service"><select value={service} onChange={event => setService(event.target.value)}><option>APP</option><option>WEBSITE</option></select></Field></div>
      <p className="small muted">Finish or reconcile any pending package before changing website settings. The updated title, description or address reaches Qortal through your next published package.</p>
      {migration && <Alert tone="warn" title="Publishing destination changes"><p>{String(migration.mappingCount)} identities will use the new destination. Previous verification cannot prove publication at the new address.</p><label className="checkbox"><input type="checkbox" checked={confirm} onChange={event => setConfirm(event.target.checked)} />I want to prepare this site for the new Qortal name.</label></Alert>}
      <button className="primary" disabled={busy || !title.trim() || !name.trim() || !target.trim() || Boolean(migration && !confirm)} onClick={() => void perform(save)}>{migration ? 'Confirm and save new destination' : 'Save website settings'}</button>
    </div></Card>
    <Card title="WordPress connection"><p>{String(project.source.baseUrl ?? '')}</p><p className="small muted">Use a separate project for another source website. Choose your access method or sign in again here if your saved session has expired.</p>
      <WordPressConnection mode={authMode} onMode={value => { setAuthMode(value); setPassword(''); setBrowserOpened(false); }} username={username} onUsername={setUsername} password={password} onPassword={setPassword} remember={remember} onRemember={setRemember} keyringAvailable={keyringAvailable} busy={busy} browserOpened={browserOpened}
        onOpenBrowser={() => void perform(async () => { await api().sources.openLogin(project.id); setBrowserOpened(true); })}
        onUseBrowser={() => void perform(async () => { const result = await api().sources.completeLogin(project.id); if (result.status !== 'completed' || !result.report?.ok) throw new Error(result.error?.message ?? 'The website did not allow REST access with this session.'); setBrowserOpened(false); setPassword(''); setNotice('Signed-in website session checked. You can continue your project.'); await onSaved(); })} />
      <div className="row gap wrap"><button disabled={busy || (authMode !== 'none' && (!username || !password))} onClick={() => void perform(async () => { const result = await api().sources.validate(project.id, { auth: wordpressAuth(authMode, username, password), remember, source: project.source }); if (result.status !== 'completed' || !result.report?.ok) throw new Error(result.error?.message ?? 'WordPress connection failed.'); setPassword(''); setNotice('WordPress connection checked. You can continue your saved project.'); await onSaved(); })}>Test and save connection</button><button disabled={busy} onClick={() => void perform(async () => { await api().credentials.forget(project.id); setNotice('Saved WordPress login removed.'); })}>Forget saved login</button></div>
    </Card>
    <DestinationReview projectId={project.id} nodeUrl={nodeUrl} />
  </div>;
}
