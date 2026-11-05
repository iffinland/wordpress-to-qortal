import { useMemo, useState } from 'react';
import type { Gallery, CmsMediaRef, ViewerIdentity } from '../../types';
import { createQdnResourceUrl, searchQdnResources } from '../../lib/qortal.js';
import { publishMediaFile } from '../../lib/publish.js';
import { StateNotice } from '../../components/StateNotice';

export interface InsertedMedia {
  url: string;
  alt: string;
  service: string;
  identifier: string;
  mimeType?: string | null;
}

export function MediaPicker(props: {
  identity: ViewerIdentity;
  name: string;
  catalogMedia: CmsMediaRef[];
  galleries: Gallery[];
  onInsert: (media: InsertedMedia) => void;
  onClose: () => void;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [state, setState] = useState<'idle' | 'publishing' | 'failed'>('idle');
  const [message, setMessage] = useState('');
  const [query, setQuery] = useState('');
  const [remote, setRemote] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);

  const existing = useMemo(() => {
    const list: Array<{ service: string; name: string; identifier: string; label: string; mimeType?: string | null }> = [];
    for (const media of props.catalogMedia) {
      if (media.qdn && media.qdn.identifier) {
        list.push({ service: media.qdn.service, name: media.qdn.name || props.name, identifier: media.qdn.identifier, label: media.alt || media.url || media.qdn.identifier, mimeType: null });
      }
    }
    for (const gallery of props.galleries) {
      for (const image of gallery.images) {
        list.push({ service: image.service, name: image.name, identifier: image.identifier, label: image.caption || image.alt || gallery.title, mimeType: image.mimeType || null });
      }
    }
    const seen = new Set<string>();
    return list.filter((item) => {
      const key = item.service + '/' + item.name + '/' + item.identifier;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [props.catalogMedia, props.galleries, props.name]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const local = q ? existing.filter((item) => item.label.toLowerCase().includes(q)) : existing;
    return [...local, ...remote.map((item) => ({
      service: item.service || 'IMAGE',
      name: item.name || props.name,
      identifier: item.identifier,
      label: item.title || item.description || item.identifier,
      mimeType: item.mimeType || null
    }))];
  }, [existing, query, remote, props.name]);

  const search = async () => {
    setSearching(true);
    setMessage('');
    const results = await searchQdnResources({ service: 'IMAGE', name: props.name, query, limit: 20 });
    setRemote(results);
    if (results.length === 0) setMessage('No existing QDN images matched. Hub may be unavailable, or nothing is published under this name.');
    setSearching(false);
  };

  const publish = async () => {
    if (files.length === 0) return;
    setState('publishing');
    setMessage('Waiting for Qortal Hub approval for each file...');
    let published = 0;
    for (const file of files) {
      const result = await publishMediaFile({ identity: props.identity, name: props.name, file, storage: localStorage as any });
      if (!result.ok || !result.ref) {
        setState('failed');
        setMessage('Stopped after ' + published + ' file(s): ' + result.message);
        return;
      }
      const url = createQdnResourceUrl(result.ref.service, result.ref.name, result.ref.identifier);
      props.onInsert({
        url,
        alt: file.name.replace(/\.[^.]+$/, ''),
        service: result.ref.service,
        identifier: result.ref.identifier,
        mimeType: result.ref.mimeType
      });
      published += 1;
    }
    setFiles([]);
    setState('idle');
    setMessage('Inserted ' + published + ' published file(s).');
  };

  return (
    <div className="media-picker" role="dialog" aria-modal="true" aria-labelledby="media-picker-title">
      <div className="media-picker__header">
        <h3 id="media-picker-title">Media</h3>
        <button type="button" className="button button--ghost" onClick={props.onClose}>Close</button>
      </div>

      <section aria-labelledby="media-upload-title">
        <h4 id="media-upload-title">Upload from this device</h4>
        <input
          type="file"
          multiple
          accept="image/*,video/*,audio/*,application/pdf"
          onChange={(event) => setFiles(Array.from(event.target.files || []).slice(0, 10))}
          aria-describedby="media-upload-help"
        />
        <p id="media-upload-help" className="muted">Android file selection works when the Hub version supports it; otherwise choose existing QDN media. Files are published once and reused by content hash.</p>
        {files.length > 0 ? (
          <ul className="media-picker__files">
            {files.map((file) => (
              <li key={file.name + file.size}>
                {file.type.startsWith('image/') ? <img src={URL.createObjectURL(file)} alt="" /> : null}
                <span>{file.name}</span>
              </li>
            ))}
          </ul>
        ) : null}
        <button type="button" className="button" onClick={publish} disabled={files.length === 0 || state === 'publishing'}>
          {state === 'publishing' ? 'Publishing...' : 'Publish and insert ' + files.length + ' file(s)'}
        </button>
      </section>

      <section aria-labelledby="media-existing-title">
        <h4 id="media-existing-title">Existing QDN media</h4>
        <div className="admin-row">
          <label>Search<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="caption or title" /></label>
          <button type="button" className="button button--ghost" onClick={search} disabled={searching}>{searching ? 'Searching...' : 'Search QDN'}</button>
        </div>
        <ul className="media-picker__grid">
          {filtered.map((item) => (
            <li key={item.service + item.name + item.identifier}>
              <button
                type="button"
                className="media-picker__item"
                onClick={() => props.onInsert({
                  url: createQdnResourceUrl(item.service, item.name, item.identifier),
                  alt: item.label,
                  service: item.service,
                  identifier: item.identifier,
                  mimeType: item.mimeType
                })}
              >
                {item.service === 'IMAGE' ? <img src={createQdnResourceUrl(item.service, item.name, item.identifier)} alt="" loading="lazy" /> : <span className="media-picker__placeholder">{item.service}</span>}
                <span>{item.label}</span>
              </button>
            </li>
          ))}
        </ul>
        {filtered.length === 0 ? <p className="muted">No existing media yet.</p> : null}
      </section>
      {message ? <StateNotice state={state === 'failed' ? 'error' : 'partial'} title={state === 'failed' ? 'Media not published' : 'Media status'} message={message} /> : null}
    </div>
  );
}

