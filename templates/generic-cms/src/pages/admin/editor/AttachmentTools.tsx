import { useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { captureAttachment } from '../../../lib/attachmentCapture.js';
import { formatBytes, normalizeAttachmentMeta } from '../../../lib/attachments.js';
import { readFileBytes } from '../../../lib/mediaBytes.js';
import { sha256Hex } from '../../../lib/qortal.js';

export interface AttachmentCapture {
  identifier: string; kind: string; service: string; filename: string; mime: string; size: number;
  sha256: string; blob: Blob; title: string;
  poster: { bytes: Uint8Array; mimeType: string; filename: string; sha256: string } | null;
  posterIdentifier: string;
}
export type AttachmentStore = Map<string, AttachmentCapture>;

const ACCEPT = '.txt,.md,.markdown,.pdf,.mp3,.m4a,.aac,.ogg,.oga,.opus,.wav,.flac,.weba,.mp4,.m4v,.webm,.mov,.ogv,.mkv,.zip,.7z,.rar,.tar,.gz,.tgz,.bz2,.xz,.doc,.docx,.xls,.xlsx,.odt,.ods,.ppt,.pptx,.csv,.json,.rtf';
const MAX_POSTER_BYTES = 10 * 1024 * 1024;

export function AttachButton(props: { editor: Editor; qdnName: string; store: AttachmentStore; publicNode: boolean; onStatus: (message: string, error?: boolean) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const pick = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    // Capture every File synchronously first: the list may be revoked after this event.
    const list = Array.from(files);
    for (const file of list) {
      props.onStatus('Reading "' + file.name + '"…');
      const result: any = await captureAttachment(file, {
        publicNode: props.publicNode,
        onProgress: (fraction: number) => props.onStatus('Reading "' + file.name + '": ' + Math.round(fraction * 100) + '%')
      });
      if (!result.ok) { props.onStatus(result.message, true); continue; }
      props.store.set(result.identifier, result);
      props.editor.chain().focus().insertAttachment({
        kind: result.kind, service: result.service, name: props.qdnName, identifier: result.identifier,
        filename: result.filename, title: result.title, mime: result.mime, size: result.size,
        sha256: result.sha256, poster: result.posterIdentifier
      }).run();
      props.onStatus('Attached "' + result.filename + '" (' + formatBytes(result.size) + '). It is published together with the post.');
    }
    if (input.current) input.current.value = '';
  };
  return (
    <>
      <button type="button" className="editor-toolbar__button" onClick={() => input.current && input.current.click()}>Attach file</button>
      <input ref={input} type="file" multiple accept={ACCEPT} className="visually-hidden" tabIndex={-1} aria-label="Attach files" onChange={(event) => { void pick(event.target.files); }} />
    </>
  );
}

function collect(editor: Editor) {
  const found: Array<{ pos: number; meta: ReturnType<typeof normalizeAttachmentMeta> }> = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'attachment') found.push({ pos, meta: normalizeAttachmentMeta(node.attrs) });
  });
  return found.filter((entry) => entry.meta);
}

export function AttachmentsPanel(props: { editor: Editor; store: AttachmentStore; onStatus: (message: string, error?: boolean) => void }) {
  const { editor } = props;
  const [, setTick] = useState(0);
  useEffect(() => {
    const bump = () => setTick((value) => value + 1);
    editor.on('update', bump);
    return () => { editor.off('update', bump); };
  }, [editor]);
  const items = collect(editor);
  if (items.length === 0) return null;
  const update = (pos: number, attrs: Record<string, unknown>) => {
    const node = editor.state.doc.nodeAt(pos);
    if (!node) return;
    editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs }));
  };
  const remove = (pos: number) => {
    const node = editor.state.doc.nodeAt(pos);
    if (node) editor.view.dispatch(editor.state.tr.delete(pos, pos + node.nodeSize));
  };
  const setPoster = async (pos: number, identifier: string, file: File | undefined) => {
    if (!file) return;
    if (!/^image\/(jpeg|png|webp|gif|avif)$/i.test(file.type)) { props.onStatus('The poster must be a JPEG, PNG, WebP, GIF or AVIF image.', true); return; }
    if (file.size > MAX_POSTER_BYTES) { props.onStatus('The poster image can be at most 10 MB.', true); return; }
    try {
      const bytes = await readFileBytes(file);
      const sha256 = await sha256Hex(bytes);
      const capture = props.store.get(identifier);
      if (capture) capture.poster = { bytes, mimeType: file.type, filename: file.name, sha256 };
      update(pos, { poster: ('qms-cms-media-' + sha256.slice(0, 32)).slice(0, 64) });
      props.onStatus('Poster set for "' + (normalizeAttachmentMeta({ ...editor.state.doc.nodeAt(pos)?.attrs })?.title || 'video') + '".');
    } catch {
      props.onStatus('The poster image could not be read. Re-select it.', true);
    }
  };
  return (
    <section className="attachments-panel" aria-label="Attachments in this post">
      <h3>Attachments</h3>
      <ul className="attachments-panel__list">
        {items.map(({ pos, meta }) => meta ? (
          <li key={meta.identifier + ':' + pos} className="attachments-panel__item">
            <p><strong>{meta.filename}</strong> · {meta.service} · {formatBytes(meta.size)}{props.store.has(meta.identifier) ? ' · will be published with the post' : ' · already published'}</p>
            {meta.kind === 'audio' || meta.kind === 'video' ? (
              <label>Display title
                <input value={meta.title} maxLength={120} onChange={(event) => update(pos, { title: event.target.value })} />
              </label>
            ) : null}
            {meta.kind === 'video' ? (
              <label>Poster image (optional, otherwise a frame from the video is used)
                <input type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" onChange={(event) => { void setPoster(pos, meta.identifier, event.target.files ? event.target.files[0] : undefined); event.target.value = ''; }} />
                <span className="muted">{meta.poster ? 'Poster ready.' : 'No poster: a neutral placeholder is shown.'}</span>
              </label>
            ) : null}
            <button type="button" className="button button--ghost" onClick={() => remove(pos)}>Remove attachment</button>
          </li>
        ) : null)}
      </ul>
    </section>
  );
}
