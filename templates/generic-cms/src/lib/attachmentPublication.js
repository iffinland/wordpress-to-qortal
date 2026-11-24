import { publishedFileMatches } from './fileVerification.js';
import { attachmentsInHtml, validateAttachment } from './attachments.js';
import { readFileBytes } from './mediaBytes.js';
import { getQdnResourceStatus, getTrustedNodeUrl, createQdnResourcePath } from './qortal.js';
import { hashBlobStreaming } from './sha256Stream.js';

export function remapAttachmentIdentifiers(html, moves = []) {
  for (const move of moves) html = html.split('data-identifier="' + move.from + '"').join('data-identifier="' + move.to + '"');
  return html;
}
async function downloadAttachment(meta) {
  const response = await fetch(getTrustedNodeUrl() + createQdnResourcePath(meta.service, meta.name, meta.identifier), {
    signal: AbortSignal.timeout(15 * 60 * 1000)
  });
  if (!response.ok) throw Error('The published attachment could not be downloaded (HTTP ' + response.status + ').');
  return response.blob();
}

/** Prepare files before approval, resolving source bytes before changing coordinates.
 * @param {any} options
 * @returns {Promise<any>}
 */
export async function preparePostAttachments(options) {
  const { html, name, store, moves = [], publicNode = false,
    status = getQdnResourceStatus, download = downloadAttachment, matches = publishedFileMatches } = options;
  await store.ready;
  const readyStatus = async (service, identifier) => {
    const result = await status(service, name, identifier, { build: true });
    if (['PUBLISHED', 'BUILDING', 'DOWNLOADING', 'DOWNLOADED', 'MISSING_DATA'].includes(result?.status)) {
      throw Error('This attachment is still loading on QDN (' + result.status + '). Wait for loading to finish and retry publishing; re-attaching the file is not required.');
    }
    return result;
  };
  const resources = [];
  const used = new Set();
  const add = (resource) => {
    const key = resource.service + '/' + resource.identifier;
    if (!used.has(key)) { used.add(key); resources.push(resource); }
  };
  for (const meta of attachmentsInHtml(html)) {
    if (meta.name !== name) throw Error('The attachment "' + meta.filename + '" belongs to a different QDN name.');
    const move = moves.find(item => item.from === meta.identifier);
    const target = move ? move.to : meta.identifier;
    let capture = store.get(meta.identifier) || store.get(target);
    if (!capture?.blob) {
      const ready = await readyStatus(meta.service, target);
      let verifiedTarget = ready?.status === 'READY';
      if (verifiedTarget && move) verifiedTarget = Boolean(meta.sha256) && await matches({
        service: meta.service, name, identifier: target, size: meta.size, sha256: meta.sha256
      });
      if (!verifiedTarget) {
        if (!move) throw Error('The attachment "' + meta.filename + '" has no saved local file and is not ready on QDN. Re-attach the file; your post text is kept.');
        const source = await readyStatus(meta.service, meta.identifier);
        if (!source || source.status !== 'READY') throw Error('The video "' + meta.filename + '" is not ready on QDN and has no saved local file. Re-attach it before publishing to Q-Tube.');
        const check = validateAttachment({ name: meta.filename, size: meta.size, type: meta.mime }, { publicNode });
        if (!check.ok) throw Error(check.message);
        const blob = await download(meta);
        if (blob.size !== Number(meta.size)) throw Error('Downloaded attachment size does not match "' + meta.filename + '".');
        const sha256 = await hashBlobStreaming(blob);
        if (meta.sha256 && meta.sha256 !== sha256) throw Error('Downloaded attachment hash does not match "' + meta.filename + '".');
        capture = { ...meta, ...capture, identifier: meta.identifier, blob, sha256 };
        if (store.save) await store.save(capture); else store.set(meta.identifier, capture);
      }
    }
    if (capture?.blob) {
      const check = validateAttachment({ name: capture.filename, size: capture.blob.size, type: capture.mime }, { publicNode });
      if (!check.ok) throw Error(check.message);
      if (capture.blob.size !== Number(capture.size) || (meta.sha256 && capture.sha256 !== meta.sha256)) throw Error('The saved file does not match "' + meta.filename + '". Re-attach it.');
      // Catch revoked file handles before requesting a signature. Large media stay Blob/File resources.
      await readFileBytes(capture.blob.slice(0, 1));
      await readFileBytes(capture.blob.slice(Math.max(0, capture.blob.size - 1)));
      add({ stage: 'attachment', service: meta.service, identifier: target, file: capture.blob,
        sha256: capture.sha256, filename: capture.filename, title: meta.title || capture.title, reuseIfReady: true,
        verifyFileHash: Boolean(move) || target.startsWith('qtube_vid_') });
    }
    if (meta.poster) {
      if (capture?.poster && capture.posterIdentifier === meta.poster) {
        add({ stage: 'poster', service: 'IMAGE', identifier: meta.poster, bytes: capture.poster.bytes,
          filename: capture.poster.filename, title: 'Poster for ' + (meta.title || capture.title), reuseIfReady: true });
      } else {
        const poster = await readyStatus('IMAGE', meta.poster);
        if (!poster || poster.status !== 'READY') throw Error('The poster for "' + meta.filename + '" has no saved local file and is not ready on QDN. Choose the poster again.');
      }
    }
  }
  return { sourceHtml: html, html: remapAttachmentIdentifiers(html, moves), resources };
}
