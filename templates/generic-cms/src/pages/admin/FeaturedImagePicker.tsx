import { useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';
import type { CmsMediaRef, Gallery, QdnRef, ViewerIdentity } from '../../types';
import { createQdnResourceUrl, searchQdnResources } from '../../lib/qortal.js';
import { FEATURED_IMAGE_HELP } from '../../lib/featuredImage.js';
import { StateNotice } from '../../components/StateNotice';

export interface FeaturedImageChoice {
  ref: QdnRef | null;
  url: string;
  alt: string;
  source: string;
}

const SOURCE_LABELS: Record<string, string> = {
  explicit: 'Selected by you',
  wordpress: 'Preserved WordPress featured image',
  body: 'Automatic: first suitable image in the post',
  published: 'Published featured image',
  'local-file': 'New local image, published when you confirm',
  none: 'No featured image'
};

export function FeaturedImagePicker(props: {
  identity: ViewerIdentity;
  name: string;
  datasetMedia: CmsMediaRef[];
  galleries: Gallery[];
  current: FeaturedImageChoice;
  automatic: FeaturedImageChoice | null;
  pendingFile: File | null;
  onSelectRef: (ref: QdnRef) => void;
  onSelectFile: (file: File) => void;
  onUseAutomatic: () => void;
  onPublishWithout: () => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [remote, setRemote] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [message, setMessage] = useState('');
  const [previewFile, setPreviewFile] = useState<File | null>(props.pendingFile);

  const existing = useMemo(() => {
    const list: Array<{ service: string; name: string; identifier: string; label: string; mimeType?: string | null }> = [];
    for (const media of props.datasetMedia) {
      if (media.qdn && media.qdn.identifier) {
        list.push({
          service: media.qdn.service,
          name: media.qdn.name || props.name,
          identifier: media.qdn.identifier,
          label: (typeof media.alt === 'string' && media.alt) || (media.url && media.url !== '0' ? media.url : '') || media.qdn.identifier,
          mimeType: null
        });
      }
    }
    for (const gallery of props.galleries) {
      for (const image of gallery.images) {
        list.push({
          service: image.service,
          name: image.name,
          identifier: image.identifier,
          label: image.caption || image.alt || gallery.title,
          mimeType: image.mimeType || null
        });
      }
    }
    const seen = new Set<string>();
    return list.filter((item) => {
      const key = item.service + '/' + item.name + '/' + item.identifier;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [props.datasetMedia, props.galleries, props.name]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const local = q ? existing.filter((item) => item.label.toLowerCase().includes(q)) : existing;
    return [
      ...local,
      ...remote.map((item) => ({
        service: item.service || 'IMAGE',
        name: item.name || props.name,
        identifier: item.identifier,
        label: item.title || item.description || item.identifier,
        mimeType: item.mimeType || null
      }))
    ];
  }, [existing, query, remote, props.name]);

  const search = async () => {
    setSearching(true);
    setMessage('');
    const results = await searchQdnResources({ service: 'IMAGE', name: props.name, query, limit: 20 });
    setRemote(results);
    if (results.length === 0) setMessage('No existing QDN images matched. Hub may be unavailable, or nothing is published under this name.');
    setSearching(false);
  };

  const chooseFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = (event.target.files || [])[0];
    if (!file) return;
    if (!String(file.type || '').startsWith('image/')) {
      setMessage('Choose an image file (JPEG, PNG, WebP, GIF or AVIF). Video files and documents cannot be a featured image.');
      return;
    }
    setMessage('');
    setPreviewFile(file);
    props.onSelectFile(file);
  };

  const previewUrl = previewFile ? URL.createObjectURL(previewFile) : '';
  const currentUrl = previewUrl || props.current.url;
  const automaticUrl = props.automatic ? props.automatic.url : '';
  const isAutomaticCurrent = props.current.source === 'body' && !props.current.ref;
  const hasChoice = Boolean(currentUrl);

  return (
    <div className="featured-picker" role="dialog" aria-modal="true" aria-labelledby="featured-picker-title">
      <div className="media-picker__header">
        <h3 id="featured-picker-title">Featured image</h3>
        <button type="button" className="button button--ghost" onClick={props.onClose}>Close</button>
      </div>

      <p className="featured-picker__help">{FEATURED_IMAGE_HELP}</p>

      <section className="featured-picker__current" aria-labelledby="featured-current-title">
        <h4 id="featured-current-title">Image that will be used before publishing</h4>
        <p className="featured-picker__source" role="status">
          {SOURCE_LABELS[props.current.source] || SOURCE_LABELS.none}
          {props.pendingFile ? ' · ' + props.pendingFile.name : ''}
        </p>
        {hasChoice ? (
          <figure className="featured-picker__preview">
            <img src={currentUrl} alt={props.current.alt || 'Featured image preview'} />
            <figcaption>{props.current.alt || 'No alt text'}</figcaption>
          </figure>
        ) : (
          <p className="muted">No featured image will be published for this post.</p>
        )}
        <div className="admin-toolbar">
          <label className="button button--ghost featured-picker__file">
            Replace from this device
            <input type="file" accept="image/*" onChange={chooseFile} aria-label="Choose a featured image from this device" />
          </label>
          {props.automatic ? (
            <button type="button" className="button button--ghost" onClick={props.onUseAutomatic} disabled={isAutomaticCurrent}>
              Use automatic image from the post
            </button>
          ) : null}
          <button type="button" className="button button--ghost" onClick={props.onPublishWithout}>Publish without a featured image</button>
        </div>
        {previewFile && !props.pendingFile ? <p className="muted">This file was selected earlier. Re-select it to publish it.</p> : null}
      </section>

      <section aria-labelledby="featured-auto-title">
        <h4 id="featured-auto-title">Automatic choice</h4>
        {props.automatic && automaticUrl ? (
          <div className="featured-picker__auto">
            <img src={automaticUrl} alt={props.automatic.alt || ''} loading="lazy" />
            <p className="muted">
              {isAutomaticCurrent ? 'This is the image that will be used.' : 'First suitable image in the post body. It is used only when you do not choose another image.'}
            </p>
          </div>
        ) : (
          <p className="muted">No suitable image was found in the post body. The post will be published without a featured image unless you choose one.</p>
        )}
      </section>

      <section aria-labelledby="featured-existing-title">
        <h4 id="featured-existing-title">Choose an existing QDN image</h4>
        <div className="admin-row">
          <label>Search<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="caption or title" /></label>
          <button type="button" className="button button--ghost" onClick={search} disabled={searching}>
            {searching ? 'Searching...' : 'Search QDN'}
          </button>
        </div>
        <ul className="media-picker__grid">
          {filtered.map((item) => (
            <li key={item.service + item.name + item.identifier}>
              <button
                type="button"
                className="media-picker__item"
                aria-label={'Use ' + item.label}
                onClick={() => props.onSelectRef({ service: item.service, name: item.name, identifier: item.identifier })}
              >
                {item.service === 'IMAGE'
                  ? <img src={createQdnResourceUrl(item.service, item.name, item.identifier)} alt="" loading="lazy" />
                  : <span className="media-picker__placeholder">{item.service}</span>}
                <span>{item.label}</span>
              </button>
            </li>
          ))}
        </ul>
        {filtered.length === 0 ? <p className="muted">No existing images yet. Publish one from this device or use an image already in the post.</p> : null}
      </section>

      {message ? <StateNotice state="partial" title="Featured image" message={message} /> : null}
    </div>
  );
}
