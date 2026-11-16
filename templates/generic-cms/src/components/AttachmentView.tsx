import { useEffect, useRef, useState } from 'react';
import { AttachmentIcon, PlayIcon } from './AttachmentIcons';
import { AttachmentDialog } from './AttachmentDialog';
import { formatBytes } from '../lib/attachments.js';
import { createQdnResourceUrl } from '../lib/qortal.js';
import { markdownToSafeHtml } from '../lib/miniMarkdown.js';

export const PREVIEW_TEXT_CAP = 256 * 1024;
const PDF_MAX_BYTES = 25 * 1024 * 1024;

export interface AttachmentMeta {
  kind: string; service: string; identifier: string; name: string; filename: string; title: string;
  mime: string; size: number; poster: string; preview: 'txt' | 'md' | 'pdf' | null;
}

/** Read at most `cap` bytes of a response as text. */
async function fetchCapped(url: string, cap: number) {
  const response = await fetch(url);
  if (!response.ok) throw new Error('The file could not be loaded (HTTP ' + response.status + ').');
  const total = Number(response.headers.get('content-length')) || 0;
  if (!response.body || !response.body.getReader) {
    const text = await response.text();
    return { text: text.slice(0, cap), truncated: text.length > cap, total: text.length };
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (received >= cap) { truncated = true; await reader.cancel(); break; }
  }
  const merged = new Uint8Array(Math.min(received, cap));
  let offset = 0;
  for (const chunk of chunks) {
    const take = Math.min(chunk.length, merged.length - offset);
    if (take <= 0) break;
    merged.set(chunk.subarray(0, take), offset);
    offset += take;
  }
  return { text: new TextDecoder('utf-8', { fatal: false }).decode(merged), truncated, total };
}

function PreviewBody(props: { meta: AttachmentMeta; url: string }) {
  const { meta, url } = props;
  const [state, setState] = useState<{ phase: 'loading' | 'ready' | 'error'; text?: string; html?: string; truncated?: boolean; message?: string; note?: string }>({ phase: 'loading' });
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (meta.preview === 'pdf') {
          if (meta.size > PDF_MAX_BYTES) throw new Error('This PDF is too large to preview (' + formatBytes(meta.size) + ').');
          const response = await fetch(url);
          if (!response.ok) throw new Error('The file could not be loaded (HTTP ' + response.status + ').');
          const bytes = new Uint8Array(await response.arrayBuffer());
          const { extractPdfText } = await import('../lib/pdfText.js');
          const result = await extractPdfText(bytes);
          if (!result.text) throw new Error('No readable text was found. This PDF may be scanned images.');
          if (!cancelled) setState({ phase: 'ready', text: result.text, truncated: result.truncated, note: result.truncated ? 'Showing the first pages only.' : '' });
          return;
        }
        const result = await fetchCapped(url, PREVIEW_TEXT_CAP);
        if (cancelled) return;
        if (meta.preview === 'md') setState({ phase: 'ready', html: markdownToSafeHtml(result.text), truncated: result.truncated });
        else setState({ phase: 'ready', text: result.text, truncated: result.truncated });
      } catch (error) {
        if (!cancelled) setState({ phase: 'error', message: error instanceof Error ? error.message : 'The preview could not be created.' });
      }
    })();
    return () => { cancelled = true; };
  }, [url, meta.preview, meta.size]);

  if (state.phase === 'loading') return <p role="status" aria-busy="true">Loading preview…</p>;
  if (state.phase === 'error') return <p role="alert">{state.message} Use Download to open the file on your device.</p>;
  return (
    <>
      {state.truncated ? <p className="muted" role="status">{state.note || ('Showing the first ' + formatBytes(PREVIEW_TEXT_CAP) + ' only. Use Download full file for the rest.')}</p> : null}
      {state.html != null
        ? <div className="attachment-preview attachment-preview--md" dangerouslySetInnerHTML={{ __html: state.html }} />
        : <pre className="attachment-preview attachment-preview--text">{state.text}</pre>}
    </>
  );
}

export function AttachmentView(props: { meta: AttachmentMeta }) {
  const { meta } = props;
  const url = createQdnResourceUrl(meta.service, meta.name, meta.identifier);
  const posterUrl = meta.poster ? createQdnResourceUrl('IMAGE', meta.name, meta.poster) : '';
  const [playing, setPlaying] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [posterFailed, setPosterFailed] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  useEffect(() => { if (playing && videoRef.current) { const p = videoRef.current.play(); if (p && p.catch) p.catch(() => undefined); } }, [playing]);

  const download = (label: string) => (
    <a className="button button--ghost attachment__download" href={url} download={meta.filename} rel="noopener noreferrer" aria-label={label + ' ' + meta.filename}>{label}</a>
  );

  if (meta.kind === 'audio') {
    return (
      <div className="attachment attachment--audio">
        <div className="attachment__head"><AttachmentIcon kind="audio" /><span className="attachment__title">{meta.title}</span></div>
        <audio controls preload="none" src={url} aria-label={meta.title} className="attachment__audio" />
      </div>
    );
  }

  if (meta.kind === 'video') {
    return (
      <div className="attachment attachment--video">
        <div className="attachment__media">
          {playing ? (
            <video ref={videoRef} controls playsInline preload="none" poster={posterUrl || undefined} src={url} aria-label={meta.title} className="attachment__video" />
          ) : (
            <button type="button" className="attachment__poster" onClick={() => setPlaying(true)} aria-label={'Play video: ' + meta.title}>
              {posterUrl && !posterFailed
                ? <img src={posterUrl} alt="" loading="lazy" onError={() => setPosterFailed(true)} />
                : <span className="attachment__placeholder" aria-hidden="true"><AttachmentIcon kind="video" /></span>}
              <span className="attachment__play"><PlayIcon /></span>
            </button>
          )}
        </div>
        <p className="attachment__title">{meta.title}</p>
      </div>
    );
  }

  return (
    <div className={'attachment attachment--' + meta.kind}>
      <div className="attachment__head">
        <AttachmentIcon kind={meta.kind} />
        <span className="attachment__info">
          <span className="attachment__title">{meta.title}</span>
          <span className="attachment__meta">{meta.filename}{meta.size ? ' · ' + formatBytes(meta.size) : ''}</span>
        </span>
      </div>
      <div className="attachment__actions">
        {meta.preview ? <button type="button" className="button button--ghost" onClick={() => setPreviewOpen(true)}>Preview</button> : null}
        {download('Download')}
      </div>
      {previewOpen ? (
        <AttachmentDialog
          title={meta.title}
          onClose={() => setPreviewOpen(false)}
          footer={download('Download full file')}
        >
          <PreviewBody meta={meta} url={url} />
        </AttachmentDialog>
      ) : null}
    </div>
  );
}
