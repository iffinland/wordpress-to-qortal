import { useEffect, useMemo, useState } from 'react';
import type { CmsContentItem, CmsDataset, Gallery, LoadedContent, ViewerIdentity } from '../../types';
import { RichTextEditor } from './RichTextEditor';
import { MediaPicker, type InsertedMedia } from './MediaPicker';
import { StateNotice } from '../../components/StateNotice';
import { createDraft, parseTerms, readDrafts, removeDraft, upsertDraft, writeDrafts } from '../../lib/drafts.js';
import { loadNativeIndex, publishNativePostDraft } from '../../lib/authoring.js';
import { quotePublication } from '../../lib/publish.js';
import { slugAvailable } from '../../lib/nativeCatalog.js';
import { sanitizeHtml } from '../../lib/sanitize.js';
import { slugify } from '../../lib/text.js';

function draftFromItem(item: CmsContentItem, content: LoadedContent, revision: number) {
  return createDraft({
    id: item.id,
    type: item.type,
    title: item.title,
    slug: item.slug,
    html: content.html,
    excerpt: item.excerpt,
    categoriesText: item.categoryIds.join(', '),
    tagsText: item.tagIds.join(', '),
    author: content.author,
    status: item.status,
    createdAt: item.createdAt || undefined,
    publishedAt: item.publishedAt,
    baseRevision: revision,
    remoteId: item.id,
    contentIdentifier: item.contentRef ? item.contentRef.identifier : null
  });
}

export function EditorPage(props: {
  identity: ViewerIdentity;
  name: string;
  siteId: string;
  dataset: CmsDataset | null;
  galleries: Gallery[];
  loadContent: (item: CmsContentItem) => Promise<LoadedContent>;
  onRefresh: () => void;
  initialId?: string;
}) {
  const [drafts, setDrafts] = useState<any[]>(() => readDrafts(localStorage, props.siteId));
  const [selectedId, setSelectedId] = useState<string>('');
  const [draft, setDraft] = useState<any>(null);
  const [revision, setRevision] = useState(0);
  const [loadingRevision, setLoadingRevision] = useState(true);
  const [showMedia, setShowMedia] = useState(false);
  const [preview, setPreview] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [fee, setFee] = useState('Checking node fee...');
  const [state, setState] = useState<'idle' | 'publishing' | 'verified' | 'ambiguous' | 'failed'>('idle');
  const [message, setMessage] = useState('');

  const nativePosts = useMemo(() => (props.dataset ? props.dataset.posts.filter((item) => item.native) : []), [props.dataset]);

  useEffect(() => {
    let cancelled = false;
    loadNativeIndex(props.name).then((result) => {
      if (cancelled) return;
      setRevision(result.ok ? Number(result.index.revision) || 0 : 0);
      setLoadingRevision(false);
    });
    quotePublication(2).then((quote) => { if (!cancelled) setFee(quote.label); }).catch(() => { if (!cancelled) setFee('Fee unavailable.'); });
    return () => { cancelled = true; };
  }, [props.name]);

  useEffect(() => {
    if (props.initialId && nativePosts.length > 0) editPublished(props.initialId);
  }, [props.initialId, nativePosts.length]);

  const persist = (next: any) => {
    setDraft(next);
    const updated = upsertDraft(drafts, next);
    setDrafts(updated);
    writeDrafts(localStorage, props.siteId, updated);
  };

  const startNew = () => {
    const next = createDraft({ baseRevision: revision });
    setSelectedId(next.id);
    setDraft(next);
    setState('idle');
    setMessage('');
  };

  const editDraft = (id: string) => {
    const found = drafts.find((item) => item.id === id);
    if (!found) return;
    setSelectedId(id);
    setDraft(found);
    setState('idle');
    setMessage('');
  };

  const editPublished = async (id: string) => {
    const item = nativePosts.find((entry) => entry.id === id);
    if (!item) return;
    try {
      const content = await props.loadContent(item);
      const next = draftFromItem(item, content, revision);
      setSelectedId(next.id);
      setDraft(next);
      const updated = upsertDraft(drafts, next);
      setDrafts(updated);
      writeDrafts(localStorage, props.siteId, updated);
    } catch (error) {
      setMessage('Could not load the published post for editing: ' + (error instanceof Error ? error.message : String(error)));
      setState('failed');
    }
  };

  const update = (key: string, value: unknown) => persist({ ...draft, [key]: value });

  const insertMedia = (media: InsertedMedia) => {
    const html = (draft.html || '') + '<p><img src="' + media.url + '" alt="' + media.alt.replace(/"/g, '&quot;') + '" /></p>';
    persist({ ...draft, html });
    setShowMedia(false);
  };

  const requestPublish = () => {
    if (!draft.title.trim()) { setState('failed'); setMessage('A title is required.'); return; }
    if (!draft.slug.trim()) persist({ ...draft, slug: slugify(draft.title) });
    const finalSlug = draft.slug.trim() || slugify(draft.title);
    const available = slugAvailable(props.dataset, finalSlug, { exceptId: draft.remoteId });
    if (!available.ok && !(draft.remoteId && nativePosts.some((item) => item.slug === finalSlug && item.id === draft.remoteId))) {
      setState('failed'); setMessage(available.message); return;
    }
    if (!draft.html.trim()) { setState('failed'); setMessage('The post body is empty.'); return; }
    setMessage('');
    setState('idle');
    setConfirming(true);
  };

  const publish = async () => {
    setConfirming(false);
    setState('publishing');
    setMessage('Sanitizing and waiting for Qortal Hub approval...');
    let html = '';
    try {
      html = sanitizeHtml(draft.html);
    } catch (error) {
      setState('failed');
      setMessage('HTML could not be sanitized: ' + (error instanceof Error ? error.message : String(error)));
      return;
    }
    const categories = parseTerms(draft.categoriesText).map((name) => ({ id: 'cms-category-' + slugify(name), name, slug: slugify(name) }));
    const tags = parseTerms(draft.tagsText).map((name) => ({ id: 'cms-tag-' + slugify(name), name, slug: slugify(name) }));
    const timestamp = Number(draft.publishTimestamp) || Date.now();
    persist({ ...draft, publishTimestamp: timestamp });
    const result = await publishNativePostDraft({
      identity: props.identity,
      name: props.name,
      siteId: props.siteId,
      draft: { ...draft, html, slug: slugify(draft.slug || draft.title), categories, tags, publishTimestamp: timestamp },
      baseRevision: revision,
      storage: localStorage,
      author: props.dataset && props.dataset.site.publicAuthor || props.identity.name,
      timestamp
    });
    if (result.ok) {
      const published = {
        ...draft,
        html,
        slug: slugify(draft.slug || draft.title),
        publicationState: 'published',
        publicationMessage: 'Published and verified.',
        remoteId: result.entry ? result.entry.id : draft.remoteId,
        contentIdentifier: result.contentIdentifier,
        baseRevision: result.index.revision,
        publishTimestamp: null,
        publishedAt: new Date().toISOString()
      };
      persist(published);
      setRevision(result.index.revision);
      setState('verified');
      setMessage('Published and verified byte-for-byte. A WordPress incremental sync will not remove this post.');
      props.onRefresh();
      return;
    }
    setState(result.state === 'ambiguous' ? 'ambiguous' : 'failed');
    setMessage(result.message || 'Publishing failed.');
  };

  if (loadingRevision) return <p className="muted">Reading the CMS content index...</p>;

  return (
    <section className="admin-section" aria-labelledby="editor-title">
      <h2 id="editor-title">Posts</h2>
      <p className="muted">
        CMS posts live in a versioned supplement (<code>qms-cms-native-index</code>) and use <code>qms-qdn-content@1</code>.
        Imported WordPress posts are never overwritten or deleted here.
      </p>
      <div className="admin-toolbar">
        <button type="button" className="button" onClick={startNew}>New post</button>
        <span className="muted">Published CMS revision: {revision}</span>
      </div>

      {!draft ? (
        <>
          <h3>Local drafts</h3>
          {drafts.length === 0 ? <p className="muted">No local drafts yet.</p> : (
            <ul className="admin-list">
              {drafts.map((item) => (
                <li key={item.id} className="admin-list__item">
                  <button type="button" className="button button--ghost" onClick={() => editDraft(item.id)}>{item.title || '(untitled)'} <span className="admin-list__meta">{item.publicationState || 'draft'} · {item.slug || 'no slug'}</span></button>
                  <button type="button" className="button button--ghost" onClick={() => { const next = removeDraft(drafts, item.id); setDrafts(next); writeDrafts(localStorage, props.siteId, next); }}>Delete</button>
                </li>
              ))}
            </ul>
          )}
          <h3>Published CMS posts</h3>
          {nativePosts.length === 0 ? <p className="muted">No CMS-authored posts published yet.</p> : (
            <ul className="admin-list">
              {nativePosts.map((item) => (
                <li key={item.id} className="admin-list__item">
                  <span>{item.title} <span className="admin-list__meta">{item.slug} · {item.status}</span></span>
                  <button type="button" className="button button--ghost" onClick={() => editPublished(item.id)}>Edit</button>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <>
          <div className="admin-toolbar">
            <button type="button" className="button button--ghost" onClick={() => { setDraft(null); setSelectedId(''); }}>← All posts</button>
            <button type="button" className="button button--ghost" onClick={() => persist(draft)}>Save local draft</button>
            <button type="button" className="button button--ghost" onClick={() => setPreview(true)}>Preview</button>
            <button type="button" className="button" onClick={requestPublish} disabled={state === 'publishing'}>Publish post…</button>
          </div>
          {state === 'ambiguous' ? <StateNotice state="partial" title="Publication unconfirmed" message={message + ' It was not resent automatically. Retry to verify the pending submission.'} /> : null}
          {state === 'failed' ? <StateNotice state="error" title="Not published" message={message} /> : null}
          {state === 'verified' ? <StateNotice state="partial" title="Published" message={message} /> : null}

          <div className="editor-fields">
            <label>Title<input value={draft.title} onChange={(event) => persist({ ...draft, title: event.target.value, slug: draft.slug || slugify(event.target.value) })} /></label>
            <label>Slug<input value={draft.slug} onChange={(event) => persist({ ...draft, slug: slugify(event.target.value) })} /></label>
            <label>Excerpt<textarea rows={2} value={draft.excerpt} onChange={(event) => update('excerpt', event.target.value)} /></label>
            <label>Categories (comma separated)<input value={draft.categoriesText} onChange={(event) => update('categoriesText', event.target.value)} /></label>
            <label>Tags (comma separated)<input value={draft.tagsText} onChange={(event) => update('tagsText', event.target.value)} /></label>
            <label>Author<input value={draft.author} onChange={(event) => update('author', event.target.value)} /></label>
          </div>
          {draft.remoteId ? <p className="muted">Editing published CMS post. Imported WordPress posts remain read-only.</p> : null}
          <RichTextEditor value={draft.html} onChange={(html) => persist({ ...draft, html })} onInsertMedia={() => setShowMedia(true)} />
        </>
      )}

      {showMedia ? (
        <MediaPicker
          identity={props.identity}
          name={props.name}
          catalogMedia={props.dataset ? props.dataset.media : []}
          galleries={props.galleries}
          onInsert={insertMedia}
          onClose={() => setShowMedia(false)}
        />
      ) : null}

      {preview ? (
        <div className="preview-modal" role="dialog" aria-modal="true" aria-labelledby="preview-title">
          <div className="preview-modal__bar">
            <h3 id="preview-title">Preview: {draft.title || '(untitled)'}</h3>
            <button type="button" className="button button--ghost" onClick={() => setPreview(false)}>Close preview</button>
          </div>
          <article className="post-body" dangerouslySetInnerHTML={{ __html: sanitizeHtml(draft.html) }} />
        </div>
      ) : null}

      {confirming ? (
        <div className="publish-confirm" role="dialog" aria-modal="true" aria-labelledby="confirm-post-title">
          <h3 id="confirm-post-title">Confirm post publication</h3>
          <dl className="meta-grid">
            <div><dt>Content</dt><dd>DOCUMENT / {props.name} / {draft.contentIdentifier || 'stable slug identifier'}</dd></div>
            <div><dt>Index</dt><dd>DOCUMENT / {props.name} / qms-cms-native-index (revision {revision + 1})</dd></div>
            <div><dt>Fee</dt><dd>{fee}</dd></div>
            <div><dt>Signer</dt><dd>{props.identity.address}</dd></div>
          </dl>
          <p className="muted">HTML is sanitized before publication. Ownership is revalidated immediately before each signature.</p>
          <div className="admin-toolbar">
            <button type="button" className="button" onClick={publish}>Confirm publish</button>
            <button type="button" className="button button--ghost" onClick={() => setConfirming(false)}>Cancel</button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

