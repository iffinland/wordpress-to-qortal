import { useEffect, useMemo, useState } from 'react';
import type { CmsDataset, Gallery, GalleryImage, ViewerIdentity } from '../../types';
import { StateNotice } from '../../components/StateNotice';
import { loadGalleryCatalog, publishGalleryDraft } from '../../lib/authoring.js';
import { publishMediaFile, quotePublication } from '../../lib/publish.js';
import { MAX_BATCH_IMAGES, gallerySlug, validateGalleryDraft } from '../../lib/gallery.js';
import { createQdnResourceUrl } from '../../lib/qortal.js';
import { sanitizeSlugTyping, slugify, uniqueSlug } from '../../lib/slug.js';

interface LocalImage {
  key: string;
  file: File;
  caption: string;
  preview: string;
}

export function GalleryAdmin(props: {
  identity: ViewerIdentity;
  name: string;
  siteId: string;
  dataset: CmsDataset | null;
  galleries: Gallery[];
  onRefresh: () => void;
}) {
  const [revision, setRevision] = useState(0);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [editing, setEditing] = useState<any>(null);
  const [locals, setLocals] = useState<LocalImage[]>([]);
  const [state, setState] = useState<'idle' | 'publishing' | 'verified' | 'failed' | 'ambiguous'>('idle');
  const [message, setMessage] = useState('');
  const [fee, setFee] = useState('Checking node fee...');

  const existingMedia = useMemo(() => {
    const list: GalleryImage[] = [];
    for (const gallery of props.galleries) list.push(...gallery.images);
    if (props.dataset) {
      for (const media of props.dataset.media) {
        if (media.qdn && media.qdn.identifier) {
          list.push({ service: media.qdn.service, name: media.qdn.name || props.name, identifier: media.qdn.identifier, caption: media.alt || '', alt: media.alt || '' } as GalleryImage);
        }
      }
    }
    const seen = new Set<string>();
    return list.filter((image) => {
      const key = image.service + '/' + image.identifier;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [props.galleries, props.dataset, props.name]);

  useEffect(() => {
    let cancelled = false;
    loadGalleryCatalog(props.name).then((result) => {
      if (cancelled) return;
      setRevision(result.ok ? Number(result.catalog.revision) || 0 : 0);
      setCatalogLoading(false);
    });
    quotePublication(1 + MAX_BATCH_IMAGES).then((quote) => { if (!cancelled) setFee(quote.label); }).catch(() => { if (!cancelled) setFee('Fee unavailable.'); });
    return () => { cancelled = true; };
  }, [props.name]);

  const startNew = () => {
    setEditing({ id: 'gallery-' + Date.now().toString(36), slug: '', title: '', description: '', images: [], slugTouched: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    setLocals([]);
    setState('idle');
    setMessage('');
  };

  const edit = (gallery: Gallery) => {
    // An existing gallery keeps its published slug when the title changes.
    setEditing({ ...gallery, images: [...gallery.images], slugTouched: true });
    setLocals([]);
    setState('idle');
    setMessage('');
  };

  const takenGallerySlugs = () => new Set(
    props.galleries.filter((gallery) => !editing || gallery.id !== editing.id).map((gallery) => gallery.slug)
  );

  const changeGalleryTitle = (value: string) => {
    if (!editing) return;
    const base = slugify(value);
    const nextSlug = editing.slugTouched || !base ? editing.slug : uniqueSlug(base, takenGallerySlugs());
    setEditing({ ...editing, title: value, slug: nextSlug });
  };

  const regenerateGallerySlug = () => {
    if (!editing) return;
    const base = slugify(editing.title);
    setEditing({ ...editing, slug: base ? uniqueSlug(base, takenGallerySlugs()) : '', slugTouched: false });
  };

  const moveImage = (index: number, delta: number) => {
    if (!editing) return;
    const target = index + delta;
    if (target < 0 || target >= editing.images.length) return;
    const images = [...editing.images];
    const [moved] = images.splice(index, 1);
    images.splice(target, 0, moved);
    setEditing({ ...editing, images });
  };

  const addFiles = (files: FileList | null) => {
    const accepted = Array.from(files || []);
    const room = MAX_BATCH_IMAGES - locals.length;
    if (accepted.length > room) setMessage('A batch can add at most ' + MAX_BATCH_IMAGES + ' images. ' + (accepted.length - room) + ' file(s) were not added.');
    const next = accepted.slice(0, Math.max(0, room)).map((file) => ({
      key: file.name + file.size + file.lastModified,
      file,
      caption: '',
      preview: typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : ''
    }));
    setLocals((current) => [...current, ...next]);
  };

  const addExisting = (image: GalleryImage) => {
    if (!editing) return;
    if (editing.images.some((item: GalleryImage) => item.service === image.service && item.identifier === image.identifier)) {
      setMessage('That image is already in this gallery.');
      return;
    }
    setEditing({ ...editing, images: [...editing.images, { ...image }] });
  };

  const removeImage = (index: number) => setEditing({ ...editing, images: editing.images.filter((_: unknown, itemIndex: number) => itemIndex !== index) });

  const publish = async () => {
    if (!editing) return;
    if (locals.length > MAX_BATCH_IMAGES) { setState('failed'); setMessage('A batch can publish at most ' + MAX_BATCH_IMAGES + ' images.'); return; }
    setState('publishing');
    setMessage('Publishing ' + locals.length + ' new image(s) through Qortal Hub, then the gallery manifest...');
    const added: GalleryImage[] = [];
    for (const local of locals) {
      const result = await publishMediaFile({ identity: props.identity, name: props.name, file: local.file, title: local.caption || local.file.name, storage: localStorage as any });
      if (!result.ok || !result.ref) {
        setState(result.state === 'ambiguous' ? 'ambiguous' : 'failed');
        setMessage('Stopped after ' + added.length + ' image(s): ' + result.message);
        return;
      }
      added.push({
        service: result.ref.service,
        name: result.ref.name,
        identifier: result.ref.identifier,
        mimeType: result.ref.mimeType,
        bytes: result.ref.bytes,
        sha256: result.ref.sha256,
        caption: local.caption,
        alt: local.caption || local.file.name
      });
    }
    const timestamp = Number(editing.publishTimestamp) || Date.now();
    const seen = new Set<string>();
    const mergedImages = [...editing.images, ...added].filter((image) => {
      const key = image.service + '/' + image.identifier;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const merged = { ...editing, images: mergedImages, updatedAt: new Date(timestamp).toISOString(), publishTimestamp: timestamp };
    merged.slug = merged.slug || gallerySlug(merged.title, props.galleries);
    setEditing(merged);
    setLocals([]);
    const validation = validateGalleryDraft(merged, { newImages: locals });
    if (!validation.ok) {
      setState('failed');
      setMessage(validation.errors.join(' '));
      return;
    }
    const result = await publishGalleryDraft({
      identity: props.identity,
      name: props.name,
      siteId: props.siteId,
      gallery: merged,
      newImageCount: locals.length,
      baseRevision: revision,
      storage: localStorage,
      now: timestamp
    });
    if (!result.ok) {
      setState(result.state === 'ambiguous' ? 'ambiguous' : 'failed');
      setMessage(result.message || 'Gallery publication failed.');
      return;
    }
    setRevision((result as any).catalog.revision);
    setState('verified');
    setMessage('Gallery published and verified. ' + added.length + ' new image(s).');
    setEditing(null);
    setLocals([]);
    props.onRefresh();
  };

  if (catalogLoading) return <p className="muted">Reading the gallery catalog...</p>;

  return (
    <section className="admin-section" aria-labelledby="gallery-admin-title">
      <h2 id="gallery-admin-title">Galleries</h2>
      <p className="muted">
        Gallery catalog: <code>DOCUMENT / {props.name} / qms-cms-galleries</code>, revision {revision}. Each batch adds at
        most {MAX_BATCH_IMAGES} images; there is no lifetime limit. Images are content-addressed and reused.
      </p>
      <div className="admin-toolbar">
        <button type="button" className="button" onClick={startNew}>New gallery</button>
        <span className="muted">Published fee estimate: {fee}</span>
      </div>
      {state === 'failed' ? <StateNotice state="error" title="Gallery not published" message={message} /> : null}
      {state === 'ambiguous' ? <StateNotice state="partial" title="Publication unconfirmed" message={message + ' It was not resent automatically.'} /> : null}
      {state === 'verified' ? <StateNotice state="partial" title="Gallery published" message={message} /> : null}
      <p className="admin-message" role="status" aria-live="polite">{message}</p>

      {!editing ? (
        props.galleries.length === 0 ? <p className="muted">No published galleries yet.</p> : (
          <ul className="admin-list">
            {props.galleries.map((gallery) => (
              <li key={gallery.id} className="admin-list__item">
                <span>{gallery.title} <span className="admin-list__meta">{gallery.images.length} image(s) · {gallery.slug}</span></span>
                <button type="button" className="button button--ghost" onClick={() => edit(gallery)}>Edit / add batch</button>
              </li>
            ))}
          </ul>
        )
      ) : (
        <>
          <div className="admin-toolbar">
            <button type="button" className="button button--ghost" onClick={() => { setEditing(null); setLocals([]); }}>← All galleries</button>
            <button type="button" className="button" onClick={publish} disabled={state === 'publishing'}>Publish gallery…</button>
          </div>
          <div className="editor-fields">
            <label>Gallery title<input value={editing.title} onChange={(event) => changeGalleryTitle(event.target.value)} /></label>
            <label>Slug<input value={editing.slug} onChange={(event) => setEditing({ ...editing, slug: sanitizeSlugTyping(event.target.value), slugTouched: true })} /></label>
            <button type="button" className="button button--ghost" onClick={regenerateGallerySlug}>Regenerate slug</button>
            <label>Description<textarea rows={3} value={editing.description} onChange={(event) => setEditing({ ...editing, description: event.target.value })} /></label>
          </div>

          <h3>Images in this gallery ({editing.images.length})</h3>
          <ul className="gallery-admin-grid">
            {editing.images.map((image: GalleryImage, index: number) => (
              <li key={image.service + image.identifier}>
                <img src={createQdnResourceUrl(image.service, image.name, image.identifier)} alt={image.alt || ''} />
                <label>Caption<input value={image.caption || ''} onChange={(event) => {
                  const images = editing.images.map((item: GalleryImage, itemIndex: number) => itemIndex === index ? { ...item, caption: event.target.value, alt: event.target.value } : item);
                  setEditing({ ...editing, images });
                }} /></label>
                <label>Alt text<input value={image.alt || ''} onChange={(event) => {
                  const images = editing.images.map((item: GalleryImage, itemIndex: number) => itemIndex === index ? { ...item, alt: event.target.value } : item);
                  setEditing({ ...editing, images });
                }} /></label>
                <div className="admin-toolbar">
                  <button type="button" className="button button--ghost" aria-label={'Move image ' + (index + 1) + ' up'} onClick={() => moveImage(index, -1)} disabled={index === 0}>Move up</button>
                  <button type="button" className="button button--ghost" aria-label={'Move image ' + (index + 1) + ' down'} onClick={() => moveImage(index, 1)} disabled={index === editing.images.length - 1}>Move down</button>
                  <button type="button" className="button button--ghost" onClick={() => removeImage(index)}>Remove</button>
                </div>
              </li>
            ))}
          </ul>

          <h3>Add a batch of local images (max {MAX_BATCH_IMAGES})</h3>
          <input type="file" multiple accept="image/*" onChange={(event) => addFiles(event.target.files)} aria-describedby="gallery-batch-help" />
          <p id="gallery-batch-help" className="muted">Selected {locals.length} of {MAX_BATCH_IMAGES}. Add captions before publishing. Android file selection depends on the Hub version; when unavailable, reuse existing QDN images.</p>
          {locals.length > 0 ? (
            <ul className="gallery-admin-grid">
              {locals.map((local, index) => (
                <li key={local.key}>
                  <img src={local.preview} alt="" />
                  <span>{local.file.name}</span>
                  <label>Caption<input value={local.caption} onChange={(event) => setLocals((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, caption: event.target.value } : item))} /></label>
                  <button type="button" className="button button--ghost" onClick={() => setLocals((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Remove</button>
                </li>
              ))}
            </ul>
          ) : null}

          <h3>Reuse existing QDN media</h3>
          {existingMedia.length === 0 ? <p className="muted">No existing media found in the catalog or galleries.</p> : (
            <ul className="gallery-admin-grid">
              {existingMedia.slice(0, 40).map((image) => (
                <li key={image.service + image.identifier}>
                  <img src={createQdnResourceUrl(image.service, image.name, image.identifier)} alt={image.alt || ''} loading="lazy" />
                  <button type="button" className="button button--ghost" onClick={() => addExisting(image)}>Add</button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

