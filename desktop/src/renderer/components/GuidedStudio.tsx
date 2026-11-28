import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import type { DesktopSettings, ProjectDocument, ProjectSummary, PlanDocument, QmsEvent } from '../../shared/types.js';
import { Alert, Card, ErrorText, Field, ProgressBar } from './Common.js';
import { formatBytes } from '../format.js';
import { checkQortalName } from '../../shared/qortalName.js';
import { storeTextSize, TEXT_SIZES, type TextSize } from '../textSize.js';
import { ProjectLibrary } from './ProjectLibrary.js';
import { ProjectSettings, DestinationReview } from './ProjectSettings.js';
import { Recovery } from './Recovery.js';
import { History } from './History.js';
import { SyncView } from './Sync.js';
import { Progress } from './Progress.js';
import { Publishing } from './Publishing.js';
import { WordPressConnection, wordpressAuth, type WordPressAuthMode } from './WordPressConnection.js';
import { Updates } from './Updates.js';

type Job = {
  recoveryHandoffId?: string | null;
  deployment?: { service: string; name: string; identifier: string } | null;
  status: string; stage?: string; message?: string; running?: boolean; total?: number; cursor?: number; batchItemCount?: number;
  config?: Record<string, unknown>; error?: { code: string; message: string } | null;
  preview?: PlanDocument | null; items?: Array<{ sourceKey: string; title: string; contentType: string }>;
  bundle?: { absolutePath: string; filename: string; bytes: number; sha256: string }; handoffId?: string;
};
const RUNNING = new Set(['scanning', 'preparing', 'verifying']);
const LABELS = ['Website', 'Content', 'Qortal destination', 'Review & prepare'];
function asJob(value: Record<string, unknown>): Job { return value as unknown as Job; }
function readableStatus(job: Job | null) {
  if (!job) return 'Ready to set up';
  return ({ draft: 'Ready to set up', scanning: 'Reading content', review: 'Ready to review', preparing: 'Preparing files', ready: 'Ready to publish', verifying: 'Checking publication', published: 'Published and verified', attention: 'Check earlier publication', legacy: 'Check earlier publication', paused: 'Paused', failed: 'Needs attention' } as Record<string, string>)[job.status] ?? 'Ready';
}
function sourceAddress(value: string) { try { return new URL(/^https?:\/\//i.test(value.trim()) ? value.trim() : 'https://' + value.trim()).href.replace(/\/$/, ''); } catch { return ''; } }
function dateIso(value: string, end = false) { return value ? value + (end ? 'T23:59:59.999Z' : 'T00:00:00.000Z') : undefined; }

export function GuidedStudio({ onAdvanced }: { onAdvanced: () => void }) {
  const [notSubmitted, setNotSubmitted] = useState(false);
  const [tool, setTool] = useState('');
  const [projectName, setProjectName] = useState('');
  const [independent, setIndependent] = useState(false);
  const [destinationReady, setDestinationReady] = useState(false);
  const [archiveAcknowledged, setArchiveAcknowledged] = useState(false);
  const [detailPlanId, setDetailPlanId] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [project, setProject] = useState<ProjectDocument | null>(null);
  const [settings, setSettings] = useState<DesktopSettings | null>(null);
  const [step, setStep] = useState(0);
  const [creating, setCreating] = useState(false);
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [qortalName, setQortalName] = useState('');
  const [description, setDescription] = useState('');
  const [authMode, setAuthMode] = useState<WordPressAuthMode>('none');
  const [browserOpened, setBrowserOpened] = useState(false);
  const activeProject = useRef<string | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [mode, setMode] = useState('sample');
  const [limit, setLimit] = useState(5);
  const [pages, setPages] = useState(false);
  const [posts, setPosts] = useState(true);
  const [after, setAfter] = useState('');
  const [before, setBefore] = useState('');
  const [slow, setSlow] = useState(false);
  const [external, setExternal] = useState(false);
  const [maxFile, setMaxFile] = useState(256);
  const [maxDownload, setMaxDownload] = useState(2);
  const [job, setJob] = useState<Job | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [nodeUrl, setNodeUrl] = useState('http://127.0.0.1:12391');
  const [staleId, setStaleId] = useState<string | null>(null);
  const [progress, setProgress] = useState<QmsEvent | null>(null);
  const [item, setItem] = useState<{ sourceKey: string; title: string; text: string; images: string[]; notices: string[] } | null>(null);
  const mounted = useRef(true);
  const heading = useRef<HTMLHeadingElement>(null);

  async function refresh() { setProjects(await api().projects.list(true)); }
  useEffect(() => {
    mounted.current = true;
    void Promise.all([api().app.settings(), api().projects.list(true), api().nodes.get()]).then(([config, list, nodes]) => {
      if (!mounted.current) return;
      setSettings(config); setProjects(list); setNodeUrl(nodes.selected ?? nodes.defaultNode);
    }).catch(setError);
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => { heading.current?.focus(); }, [step, project?.id]);
  useEffect(() => {
    if (!project) return;
    const id = project.id;
    let cancelled = false;
    let inFlight = false;
    const update = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const next = asJob(await api().workflow(id, 'status'));
        if (!cancelled) setJob(next);
      } catch (err) { if (!cancelled) setError(err); }
      finally { inFlight = false; }
    };
    void update();
    const timer = setInterval(() => void update(), 1500);
    const unsubscribe = api().events.on((event) => { if (event.project_id === id && event.progress && !cancelled) setProgress(event); });
    return () => { cancelled = true; clearInterval(timer); unsubscribe(); };
  }, [project?.id]);

  async function perform(task: () => Promise<unknown>) {
    setBusy(true); setError(null); setNotice('');
    try { await task(); } catch (err) { setError(err); } finally { if (mounted.current) setBusy(false); }
  }
  function loadFields(document: ProjectDocument, state: Job) {
    const draft = document.settings?.guidedDraft as Record<string, unknown> | undefined;
    const form = draft?.form as Record<string, unknown> | undefined;
    const config = form?.pendingSelection ? draft ?? {} : state.config ?? draft ?? {};
    const storedAuth = document.source.authMode ?? (document.settings?.desktopWizard as Record<string, unknown> | undefined)?.authMode;
    if (['none', 'application_password', 'session'].includes(String(storedAuth))) setAuthMode(storedAuth as WordPressAuthMode);
    setUrl(String(document.source.baseUrl ?? '')); setTitle(String(document.target.siteName ?? document.name));
    setQortalName(String(document.target.qdnName ?? '')); setDescription(String(document.target.siteDescription ?? ''));
    setMode(String(config.mode ?? 'sample')); setLimit(Number(config.limit ?? 5));
    const types = config.contentTypes as string[] | undefined;
    setPosts(types ? types.includes('post') : true); setPages(types?.includes('page') ?? false);
    setAfter(String(config.after ?? '').slice(0, 10)); setBefore(String(config.before ?? '').slice(0, 10));
    const media = document.settings?.media as Record<string, unknown> | undefined;
    const disk = document.settings?.disk as Record<string, unknown> | undefined;
    setSlow(Number(media?.concurrency ?? 4) === 1); setExternal(media?.allowExternalMedia === true);
    setMaxFile(Number(disk?.maxFileBytes ?? 256 * 1024 ** 2) / 1024 ** 2);
    setMaxDownload(Number(disk?.maxBytesPerRun ?? 2 * 1024 ** 3) / 1024 ** 3);
  }
  async function openSite(id: string, recover = false) {
    await perform(async () => {
      try {
        const result = await api().projects.open(id, recover);
        const state = asJob(await api().workflow(id, 'status'));
        activeProject.current = id; setBrowserOpened(false); setPassword('');
        setDetailPlanId(null); setProject(result.project); setProjectName(result.project.name); setTool(''); setDestinationReady(false); setJob(state); setStaleId(null); setCreating(false);
        loadFields(result.project, state);
        const form = (result.project.settings?.guidedDraft as Record<string, unknown> | undefined)?.form as Record<string, unknown> | undefined;
        const resumeForm = state.status === 'draft' || (form?.pendingSelection && !['ready', 'attention', 'legacy'].includes(state.status) && !RUNNING.has(state.status));
        setStep(resumeForm ? Math.min(2, Math.max(0, Number(form?.step ?? 0))) : 3);
        if (resumeForm && form) { setTitle(String(form.title ?? result.project.target.siteName ?? '')); setQortalName(String(form.qortalName ?? result.project.target.qdnName ?? '')); setDescription(String(form.description ?? '')); }
      } catch (err) {
        if ((err as { code?: string }).code === 'PROJECT_LOCK_STALE') { setStaleId(id); return; }
        throw err;
      }
    });
  }
  async function home() {
    const wasRunning = job?.running === true || RUNNING.has(job?.status ?? '');
    if (project && !wasRunning && !tool) await saveDraft();
    activeProject.current = null; setPassword(''); setBrowserOpened(false); setShowSettings(false);
    setTool(''); setDestinationReady(false); setProject(null); setJob(null); setCreating(false); setError(null); setNotice(wasRunning ? 'Your project keeps working in the background. Open it to see progress or pause it.' : ''); setProgress(null);
    await refresh();
  }
  function newSite() {
    activeProject.current = null; setBrowserOpened(false);
    setTool(''); setDestinationReady(false); setProjectName(''); setIndependent(false); setAuthMode('none'); setUsername(''); setRemember(false); setSlow(false); setExternal(false); setMaxFile(256); setMaxDownload(2); setArchiveAcknowledged(false);
    setProject(null); setJob(null); setCreating(true); setStep(0); setUrl(''); setTitle(''); setQortalName(''); setDescription('');
    setMode('sample'); setLimit(5); setPages(false); setPosts(true); setAfter(''); setBefore(''); setPassword(''); setError(null);
  }
  function options() { return { mode, limit, contentTypes: [...(posts ? ['post'] : []), ...(pages ? ['page'] : [])], ...(dateIso(after) ? { after: dateIso(after) } : {}), ...(dateIso(before, true) ? { before: dateIso(before, true) } : {}), batchSize: slow ? 5 : 15 }; }
  async function saveDraft(document = project) {
    if (!document) return;
    await api().projects.update(document.id, { settings: { guidedDraft: { ...options(), form: { step, title, qortalName, description, pendingSelection: step < 3 } } } });
  }
  async function connect(browserAction: 'open' | 'use' | null = null) {
    await perform(async () => {
      let normalized = url.trim();
      if (!/^https?:\/\//i.test(normalized)) normalized = 'https://' + normalized;
      const parsed = new URL(normalized);
      if (parsed.username || parsed.password) throw new Error('Enter a website address without a username or password in the URL.');
      let active = project;
      if (!active) {
        const duplicate = projects.find((entry) => entry.sourceBaseUrl && sourceAddress(entry.sourceBaseUrl) === sourceAddress(normalized));
        if (duplicate && !independent) throw new Error('This website already has a project. Open it below, or select Create an independent project to start a separate site.');
        const created = await api().projects.create({ name: projectName.trim() || parsed.hostname, source: { adapter: 'wordpress', baseUrl: normalized } });
        active = (await api().projects.open(created.id)).project;
        activeProject.current = active.id; setProject(active);
      } else if (active.source.baseUrl !== normalized) {
        if (job?.status && job.status !== 'draft') throw new Error('Keep this project connected to its original website. Create a new project for a different website.');
        await api().projects.update(active.id, { source: { baseUrl: normalized } });
      }
      if (browserAction === 'open') { await api().sources.openLogin(active.id); setBrowserOpened(true); return; }
      const connection = browserAction === 'use'
        ? await api().sources.completeLogin(active.id)
        : await api().sources.validate(active.id, { adapterId: 'wordpress', source: { baseUrl: normalized }, auth: wordpressAuth(authMode, username, password), remember });
      if (connection.status !== 'completed' || !connection.report?.ok) throw new Error(connection.error?.message ?? 'Could not connect to this WordPress website. Check the address and access settings.');
      const site = connection.report.site as { name?: string; description?: string } | undefined;
      const siteTitle = title || site?.name || parsed.hostname;
      setUrl(normalized); setTitle(siteTitle); setDescription(description || site?.description || '');
      await api().projects.update(active.id, { name: (projectName.trim() || siteTitle).slice(0, 120), source: { adapter: 'wordpress', baseUrl: normalized }, target: { siteName: siteTitle, siteDescription: description || site?.description || '' } });
      setProject({ ...active, name: (projectName.trim() || siteTitle).slice(0, 120), source: { ...active.source, baseUrl: normalized }, target: { ...active.target, siteName: siteTitle, siteDescription: description || site?.description || '' } });
      setBrowserOpened(false); setPassword(''); setStep(1); await refresh();
    });
  }
  async function preview(resume = false) {
    if (!project) return;
    await perform(async () => {
      const checked = checkQortalName(qortalName);
      if (!checked.ok) throw new Error(checked.message);
      if (!title.trim()) throw new Error('Enter a website title.');
      await saveDraft();
      const latest = (await api().projects.open(project.id)).project;
      const existingWebsite = (latest.settings?.website ?? {}) as Record<string, unknown>;
      const existingMedia = (latest.settings?.media ?? {}) as Record<string, unknown>;
      const existingDisk = (latest.settings?.disk ?? {}) as Record<string, unknown>;
      const updated = await api().projects.update(project.id, { target: { qdnName: qortalName.trim(), siteName: title.trim(), siteDescription: description.trim() }, settings: {
        guidedDraft: { ...options(), form: { step: 3, title, qortalName, description, pendingSelection: false } },
        website: { cms: 'generic-cms', service: 'APP', theme: { colors: { accent: '#4da3ff' } }, ...existingWebsite, tagline: description.trim() },
        media: { ...existingMedia, concurrency: slow ? 1 : 4, allowExternalMedia: external },
        disk: { reserveBytes: 1024 ** 3, unknownSizePolicy: 'cap', ...existingDisk, maxBytesPerRun: maxDownload * 1024 ** 3, maxFileBytes: maxFile * 1024 ** 2 }
      } });
      setProject(updated.project as ProjectDocument); setDestinationReady(false); setProgress(null); setJob(asJob(await api().workflow(project.id, 'preview', { options: options(), resume }))); setStep(3);
    });
  }
  async function command(action: string, input: Record<string, unknown> = {}) {
    if (!project) return;
    await perform(async () => { setProgress(null); setJob(asJob(await api().workflow(project.id, action, input))); });
  }
  async function receipt(file: File | undefined) {
    if (!project || !file) return;
    await perform(async () => {
      if (file.size > 1000000) throw new Error('This confirmation file is too large. Choose the JSON receipt from Migration Publisher.');
      const record = JSON.parse(await file.text()) as Record<string, unknown>;
      await api().nodes.set(nodeUrl, true);
      setJob(asJob(await api().workflow(project.id, 'verify', { receipt: record, nodeUrl })));
    });
  }
  async function readItem(sourceKey: string, images = false) {
    if (!project) return;
    await perform(async () => {
      const content = await api().workflow(project.id, 'item', { sourceKey, options: { images } });
      setItem({ sourceKey, title: String(content.title ?? 'Content preview'), text: String(content.text ?? ''), images: content.images as string[] ?? [], notices: content.imageNotices as string[] ?? [] });
    });
  }
  const running = job?.running === true || RUNNING.has(job?.status ?? '');
  const inProject = Boolean(project || creating);
  const previewPlan = job?.preview;
  const locked = running || job?.status === 'ready';

  return <div className="app-shell guided-shell" data-testid="app-shell">
    <header className="app-header">
      <button className="primary home-button" disabled={busy} onClick={() => void perform(home)}>Projects / Home</button>
      <button disabled={busy} className="brand ghost" onClick={() => void perform(home)} aria-label="Your websites"><span className="brand-mark" aria-hidden="true">Q</span><span><strong>Qortal Migration Studio</strong><span className="muted small">Your website, ready for Qortal</span></span></button>
      <div className="row wrap gap"><span className="pill">QMS {settings?.appVersion ?? "…"}</span><Updates /><button className="ghost" onClick={() => setShowSettings(!showSettings)}>Settings & help</button>{project && <button className="ghost" onClick={() => setTool(tool ? '' : 'tools')}>Project tools</button>}</div>
    </header>
    <main className="app-main guided-main">
      <ErrorText error={error} />{notice && <Alert tone="info">{notice}</Alert>}
      {staleId && <Alert tone="warn" title="Your previous session did not close cleanly"><p>Your saved work can be recovered.</p><button className="primary" onClick={() => void openSite(staleId, true)}>Recover and continue</button></Alert>}
      {showSettings && <Card title="Settings & help">
        <div className="grid-2"><Field label="Text size"><select defaultValue={document.documentElement.dataset.textSize ?? 100} onChange={(event) => storeTextSize(Number(event.target.value) as TextSize)}>{TEXT_SIZES.map((size) => <option key={size} value={size}>{size}%</option>)}</select></Field>
        <Field label="Qortal node address" hint="Use your own Core API address or local SSH tunnel, including its port."><input value={nodeUrl} onChange={(event) => setNodeUrl(event.target.value)} /></Field></div>
        <div className="row wrap gap"><button disabled={busy} onClick={() => void perform(async () => { const result = await api().nodes.test(nodeUrl); if (!result.ok) throw new Error(result.message); await api().nodes.set(nodeUrl, true); setNotice(result.message); })}>Test and save connection</button>
        <button disabled={busy || running} onClick={() => void perform(async () => { const result = await api().chooseWorkspace(); if (!result.cancelled) window.location.reload(); })}>Open another workspace</button>
        <button disabled={busy || running} onClick={() => void perform(async () => { const result = await api().restoreBackup(); if (result.workspaceChanged) { window.location.reload(); return; } if (!result.cancelled) { await refresh(); setNotice('Project restored. Open it under Your websites to continue.'); } })}>Restore project backup</button>
        {project && <button disabled={busy || running} onClick={() => void perform(async () => { const result = await api().backup(project.id); if (!result.cancelled) setNotice('Project backup saved. Keep it somewhere safe so you can continue this same website later.'); })}>Save project backup</button>}</div>
        <details><summary>How migration works</summary><p>Start with a small sample. QMS copies content and required files; it does not reproduce WordPress plugins, shops, comments or interactive forms. Your original website is unchanged.</p><p>Preparation runs locally. Publish the resulting ZIP using Migration Publisher in Qortal Hub and approve the fee there. Return here with its confirmation file to check that the content is available.</p><p>Pause before closing QMS. An unexpected shutdown keeps checkpoints. Reopen your site and choose Continue. Passwords may need to be entered again if they were not saved in your system password store.</p><p>Save a project backup before changing computers. A matching Qortal name alone does not restore the project's identities.</p><p>Large files use local disk space and network data. Open Content options to set limits. You can always use Advanced tools for detailed history, conflicts and cleanup.</p></details>
        {settings && <p className="small muted">Workspace: {settings.dataRoot}</p>}
      </Card>}
      {!inProject && <ProjectLibrary projects={projects} busy={busy} onOpen={openSite} onNew={newSite} onRefresh={refresh} />}
      {project && tool && <div className="stack"><div className="row wrap gap"><button onClick={() => { setTool(''); void openSite(project.id); }}>Back to project</button><button disabled={running} onClick={() => setTool('settings')}>Project settings</button><button onClick={() => setTool('recovery')}>Recovery & storage</button><button onClick={() => setTool('sync')}>Changes & conflicts</button><button onClick={() => setTool('history')}>History</button><button onClick={() => setTool('publishing')}>Publication details</button></div>
        {tool === 'tools' && <Card title="Project tools"><p>Use Project settings to rename your local project, update your WordPress login or change its Qortal destination. Recovery & storage helps with interrupted work and disk cleanup. Changes & conflicts shows decisions that need your attention.</p><p>Your project keeps the same saved work in every view.</p></Card>}
        {tool === 'settings' && <ProjectSettings key={project.id} project={project} nodeUrl={nodeUrl} onBack={() => setTool('')} onSaved={async () => { const latest = await api().projects.open(project.id); if (activeProject.current !== project.id) return; setProject(latest.project); loadFields(latest.project, asJob(await api().workflow(project.id, 'status'))); await refresh(); }} />}
        {tool === 'recovery' && <Recovery projectId={project.id} onBack={async () => { setTool(''); await openSite(project.id); }} />}
        {tool === 'sync' && <SyncView projectId={project.id} onBack={() => setTool('')} onPublishing={planId => { setDetailPlanId(planId); setTool('progress'); }} />}
        {tool === 'history' && <History projectId={project.id} onBack={async () => setTool('')} onProgress={async (_id, planId) => { setDetailPlanId(planId); setTool('progress'); }} />}
        {tool === 'progress' && <Progress projectId={project.id} planId={detailPlanId} onBack={async () => setTool('')} onHistory={async () => setTool('history')} onPublishing={async () => setTool('publishing')} />}
        {tool === 'publishing' && <Publishing projectId={project.id} initialPlanId={detailPlanId} initialHandoffId={job?.recoveryHandoffId ?? (['attention', 'legacy'].includes(job?.status ?? '') ? job?.handoffId : null)} onBack={() => { setTool(''); void openSite(project.id); }} />}
      </div>}
      {inProject && !tool && <div className="stack">
        <div className="row between wrap gap"><div><p className="eyebrow">{project?.name ?? 'New website'}</p><h1 ref={heading} tabIndex={-1}>{step === 3 ? readableStatus(job) : LABELS[step]}</h1></div><button className="ghost" onClick={() => void perform(home)}>Your websites</button></div>
        {project && <div className="row wrap gap"><button disabled={busy || running || job?.status === 'ready'} onClick={() => { setMode('updates'); setStep(1); }}>Bring new and changed content</button><button disabled={busy || running || job?.status === 'ready'} onClick={() => { setMode('range'); setStep(1); }}>Add older articles</button><button disabled={busy || running} onClick={() => setTool('settings')}>Project settings</button><button disabled={busy || running} onClick={() => void perform(async () => { const result = await api().backup(project.id); if (!result.cancelled) setNotice('Project backup saved.'); })}>Save project backup</button></div>}
        <ol className="stepper guided-stepper" aria-label="Migration steps">{LABELS.map((label, index) => <li key={label} className={step === index ? 'active' : step > index ? 'done' : ''}><button disabled={locked || index > step} onClick={() => { setStep(index); setError(null); }}><span className="step-number">{index + 1}</span><span>{label}</span></button></li>)}</ol>
        {step === 0 && <Card title="Which website would you like to bring to Qortal?">
          <form className="stack" onSubmit={(event) => { event.preventDefault(); void connect(); }}><Field label="Local project name" hint="Choose a name that helps you recognize this migration. Different projects can read the same WordPress website."><input value={projectName} maxLength={120} onChange={event => setProjectName(event.target.value)} placeholder="My website archive" /></Field><Field label="WordPress website address"><input type="text" inputMode="url" autoFocus value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://your-website.org" required disabled={Boolean(job && job.status !== 'draft')} /></Field>
          {!project && projects.some(entry => entry.sourceBaseUrl && sourceAddress(entry.sourceBaseUrl) === sourceAddress(url)) && <Alert tone="warn" title="An existing project reads this website"><p>Continue the original project to keep its published catalog, or deliberately start an independent site.</p>{projects.filter(entry => entry.sourceBaseUrl && sourceAddress(entry.sourceBaseUrl) === sourceAddress(url)).map(entry => <button type="button" key={entry.id} onClick={() => { if (entry.archivedAt) { void perform(async () => { await api().projects.unarchive(entry.id); await openSite(entry.id); }); } else void openSite(entry.id); }}>Continue {entry.name}{entry.archivedAt ? ' (archived)' : ''}</button>)}<label className="checkbox"><input type="checkbox" checked={independent} onChange={event => setIndependent(event.target.checked)} />Create an independent project with its own catalog</label></Alert>}
          <WordPressConnection mode={authMode} onMode={value => { setAuthMode(value); setPassword(''); setBrowserOpened(false); }} username={username} onUsername={setUsername} password={password} onPassword={setPassword} remember={remember} onRemember={setRemember} keyringAvailable={settings?.keyring.available} busy={busy} browserOpened={browserOpened} onOpenBrowser={() => void connect('open')} onUseBrowser={() => void connect('use')} />
          <div className="row gap"><button className="primary" disabled={busy || !url.trim()}>{busy ? 'Connecting…' : 'Connect and continue'}</button><span className="small muted">Public content usually needs no login.</span></div></form>
        </Card>}
        {step === 1 && <Card title="Choose what to bring over">
          <div className="stack">{[['updates','Check for new, changed and unfinished public content'], ['sample','Try a few recent items'], ['range','Choose a date range'], ['archive','Bring over the whole archive']].map(([value, label]) => <label className="choice guided-choice" key={value}><input type="radio" name="content-mode" checked={mode === value} onChange={() => setMode(value)} /><span><strong>{label}</strong>{value === 'archive' && <span className="small muted">Reads all selected posts/pages. Large archives can take time and need several publication packages.</span>}</span></label>)}
          {mode === 'updates' && <Alert tone="info">Checks WordPress posts and pages against your saved project, then prepares only your selected content types. The first check can read the whole supported archive; later checks use the last successful checkpoint. Missing articles are never automatically removed. You can pause or cancel; use a date range to keep a large first import bounded.</Alert>}
          {mode === 'archive' && <label className="checkbox"><input type="checkbox" checked={archiveAcknowledged} onChange={event => setArchiveAcknowledged(event.target.checked)} />I understand this reads the selected archive, up to 50,000 items, and may take time and bandwidth.</label>}
          {mode === 'sample' && <Field label="Number of recent items"><select value={limit} onChange={(event) => setLimit(Number(event.target.value))}>{[1,5,15,50,100].map((count) => <option key={count}>{count}</option>)}</select></Field>}
          {mode === 'range' && <div className="grid-2"><Field label="From date (UTC)"><input type="date" value={after} onChange={(event) => setAfter(event.target.value)} /></Field><Field label="Through date (UTC)"><input type="date" value={before} onChange={(event) => setBefore(event.target.value)} /></Field></div>}
          <div className="row wrap gap"><label className="checkbox"><input type="checkbox" checked={posts} onChange={(event) => setPosts(event.target.checked)} />Posts</label><label className="checkbox"><input type="checkbox" checked={pages} onChange={(event) => setPages(event.target.checked)} />Pages</label></div>
          <details><summary>Content options and download limits</summary><div className="stack-sm"><label className="checkbox"><input type="checkbox" checked={slow} onChange={(event) => setSlow(event.target.checked)} />Use less bandwidth: one download at a time and smaller content groups</label><label className="checkbox"><input type="checkbox" checked={external} onChange={(event) => setExternal(event.target.checked)} />Also copy media hosted on other websites</label><div className="grid-2"><Field label="Maximum file size (MB)"><input type="number" min={1} max={4096} value={maxFile} onChange={(event) => setMaxFile(Number(event.target.value))} /></Field><Field label="Download limit per preparation (GB)"><input type="number" min={0.1} max={100} step={0.1} value={maxDownload} onChange={(event) => setMaxDownload(Number(event.target.value))} /></Field></div></div></details>
          <button className="primary" disabled={busy || (!posts && !pages) || (mode === 'archive' && !archiveAcknowledged) || (mode === 'range' && !after && !before)} onClick={() => void perform(async () => { await saveDraft(); setStep(2); })}>Continue</button></div>
        </Card>}
        {step === 2 && <Card title="Where should your website appear on Qortal?"><div className="stack"><Field label="Your registered Qortal name" hint="Use the name you control in Qortal Hub. Hub checks ownership when you publish."><input value={qortalName} onChange={(event) => setQortalName(event.target.value)} placeholder="Your Qortal name" /></Field><Field label="Website title"><input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} /></Field><Field label="Short description (optional)"><textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={1000} rows={2} /></Field><button className="primary" disabled={busy || !qortalName.trim() || !title.trim()} onClick={() => void preview()}>{busy ? 'Starting…' : 'Check selected content'}</button></div></Card>}
        {step === 3 && <>
          {job?.error && <Alert tone="bad" title="This step needs attention">{job.error.message}<p className="small">Your saved work is kept. You can adjust the selection or continue after resolving the issue.</p>{job.recoveryHandoffId && <button onClick={() => setTool('publishing')}>Check previous publication</button>}</Alert>}
          <Card title={running ? 'Current activity' : 'Website overview'}><div className="stack"><p aria-live="polite">{job?.message ?? 'Choose your content and destination to begin.'}</p>
          {job?.total !== undefined && <p className="muted">{job.cursor ?? 0} of {job.total} selected items completed{job.status === 'ready' ? ' · ' + job.batchItemCount + ' in the current package' : ''}.</p>}
          {running && <><div className="row gap"><div className="spinner" /><span>{job?.stage === 'scan' ? 'Reading your selection and required dependencies' : job?.stage === 'media' ? 'Checking pictures and files' : job?.stage === 'package' ? 'Creating the publication package' : 'Working…'}</span></div>{progress?.message && <p className="small muted">{progress.message}</p>}{progress?.progress && <ProgressBar {...progress.progress} />}<div className="row wrap gap"><button disabled={busy} onClick={() => void command('pause')}>Pause safely</button><button disabled={busy} onClick={() => void command('cancel')}>Cancel this operation</button></div><p className="small muted">You can pause and continue later. Preparation does not sign transactions or spend QORT.</p></>}
          {job?.status === 'review' && <>
            {previewPlan && <><div className="stat-grid"><div className="stat"><span>Next group</span><strong>{previewPlan.stats.selected} items</strong></div><div className="stat"><span>Media files</span><strong>{previewPlan.mediaSummary.count}</strong></div><div className="stat"><span>Known download size</span><strong>{formatBytes(previewPlan.mediaSummary.knownBytes)}</strong></div></div><p className="small muted">QDN fee estimate for this group: approximately {previewPlan.estimates.estimatedFee} QORT. Hub confirms the actual fee before publication.</p>
            {previewPlan.errors?.map((entry) => <Alert tone="bad" key={entry.code}>{entry.message}</Alert>)}{previewPlan.warnings?.length > 0 && <details><summary>Review {previewPlan.warnings.length} content or preparation notices</summary><ul>{previewPlan.warnings.map((entry, index) => <li key={index}>{entry.message}</li>)}</ul></details>}</>}
            {project && Boolean(job.total) && <DestinationReview projectId={project.id} nodeUrl={nodeUrl} onApproved={() => setDestinationReady(true)} />}
            <div className="row wrap gap"><button className="primary" disabled={busy || !destinationReady || !job.total || previewPlan?.status === 'blocked'} onClick={() => void command('prepare')}>Prepare for Qortal</button><button onClick={() => { setStep(1); setError(null); }}>Change selection</button></div>
            {job.items && job.items.length > 0 && <details><summary>Preview selected content ({Math.min(job.items.length, 100)} shown)</summary><ul className="content-preview-list">{job.items.map((entry) => <li key={entry.sourceKey}><button className="ghost" onClick={() => void readItem(entry.sourceKey)}>{entry.title || 'Untitled'} <span className="muted small">{entry.contentType === 'page' ? 'Page' : 'Post'}</span></button></li>)}</ul></details>}
          </>}
          {job?.status === 'ready' && job.bundle && <><Alert tone="good" title="Your publication package is ready"><p>{job.bundle.filename} · {formatBytes(job.bundle.bytes)}</p></Alert><ol><li>Open Migration Publisher in Qortal Hub.</li><li>Choose this ZIP package and approve the publication there.</li><li>Export its confirmation file and choose it below.</li></ol><button className="primary" onClick={() => void perform(async () => { await api().app.openPath(job.bundle!.absolutePath.slice(0, job.bundle!.absolutePath.lastIndexOf('/'))); })}>Show publication package</button><Field label="Choose Publisher confirmation file"><input type="file" accept=".json,application/json" disabled={busy} onChange={(event) => { void receipt(event.target.files?.[0]); event.target.value = ''; }} /></Field><div className="row wrap gap"><button disabled={busy} onClick={() => void command('verify', { nodeUrl })}>Check publication again</button><button onClick={() => setShowSettings(true)}>Qortal connection settings</button></div><p className="small muted">A package is marked published only after an independent check. If content is still spreading, check again later without republishing.</p><details><summary>I need to change a package that I have not submitted</summary><p>Use this only if the package has never been submitted in Hub. If you already approved publication or are unsure, check publication above first. QMS keeps the old package and its history, but prevents exporting it again.</p><label className="checkbox"><input type="checkbox" checked={notSubmitted} onChange={event => setNotSubmitted(event.target.checked)} />I have never submitted this package in Qortal Hub</label><button disabled={busy || !notSubmitted} onClick={() => void command('discard', { options: { handoffId: job.handoffId, notSubmitted: true } })}>Set aside unsubmitted package</button></details></>}
          {(job?.status === 'paused' || job?.status === 'failed') && <div className="row wrap gap"><button className="primary" disabled={busy} onClick={() => job.stage === 'scan' ? void preview(true) : job.stage === 'publish' ? void command('verify', { nodeUrl }) : void command('prepare')}>Continue saved work</button><button disabled={busy} onClick={() => setStep(1)}>Review selection</button></div>}
          {job?.status === 'cancelled' && <Alert tone="info">This selection was cancelled. Your saved project and previous publications are kept. Choose new content above when you want to continue.</Alert>}
          {['attention', 'legacy'].includes(job?.status ?? '') && <Alert tone="warn" title="Continue your earlier publication"><p>Your original package and identities are kept. Open its publication details or recover interrupted work before preparing another package.</p><Field label="Qortal node for checking the earlier package"><input value={nodeUrl} onChange={event => setNodeUrl(event.target.value)} /></Field><Field label="Publisher confirmation file (optional)"><input type="file" accept=".json,application/json" disabled={busy} onChange={event => { void receipt(event.target.files?.[0]); event.target.value = ''; }} /></Field><button className="primary" disabled={busy || !nodeUrl.trim()} onClick={() => void command('verify', { nodeUrl })}>Check previous publication</button><button onClick={() => setTool('publishing')}>Open saved publication details</button><button onClick={() => setTool('recovery')}>Recover saved work</button></Alert>}
          {job?.status === 'published' && <><Alert tone="good" title="Your website is verified on Qortal"><p>All selected content has been checked against the prepared files.</p></Alert><div className="row wrap gap"><button className="primary" disabled={!job.deployment} onClick={() => void perform(async () => { const deployment = job.deployment; if (!deployment) throw new Error('This project has no verified website application. Open publication details to inspect its content resources.'); await api().app.openUrl(nodeUrl.replace(/\/$/, '') + '/arbitrary/' + deployment.service + '/' + encodeURIComponent(deployment.name) + '/' + encodeURIComponent(deployment.identifier) + '?filepath=index.html'); })}>Open website</button><button onClick={() => { setStep(1); setMode('updates'); setNotice('Choose recent posts or a date range. Already verified content will be reused.'); }}>Check for new content</button><button onClick={() => void perform(async () => { const result = await api().backup(project!.id); if (!result.cancelled) setNotice('Backup saved.'); })}>Save project backup</button></div></>}
          </div></Card>
        </>}
      </div>}
      {item && <div className="preview-overlay" onKeyDown={(event) => {
        if (event.key === 'Escape') { event.preventDefault(); setItem(null); }
        if (event.key === 'Tab') { event.preventDefault(); (event.currentTarget.querySelector('button') as HTMLButtonElement | null)?.focus(); }
      }} role="dialog" aria-modal="true" aria-label="Article preview"><div className="card article-preview"><div className="row between gap"><h2>{item.title}</h2><button autoFocus onClick={() => setItem(null)}>Close preview</button></div><p className="small muted">Reading preview. WordPress plugins and interactive controls are not copied.</p><button disabled={busy} onClick={() => void readItem(item.sourceKey, true)}>Load sample pictures (up to 6 MB)</button><div className="preview-pictures">{item.images.map((url, index) => <img src={url} key={index} alt={'Sample picture ' + (index + 1)} />)}</div>{item.notices.map((message, index) => <p className="small muted" key={index}>{message}</p>)}<div className="article-preview-text">{item.text}</div></div></div>}
    </main><footer className="app-footer"><span>{settings ? 'QMS ' + settings.appVersion : 'Qortal Migration Studio'}</span><span>Your progress is saved on this computer. Hub approves publication.</span></footer>
  </div>;
}
