import { createQdnResourcePath, getTrustedNodeUrl, getQdnResourceStatus } from './qortal.js';
import { Sha256 } from './sha256Stream.js';

/** Fixed Q-Tube coordinates can hold an older video. READY alone cannot verify a replacement. */
export async function publishedFileMatches({ service, name, identifier, size, sha256, timeoutMs = 120000 }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, timeoutMs));
  let reader;
  try {
    const response = await fetch(getTrustedNodeUrl() + createQdnResourcePath(service, name, identifier), {
      cache: 'no-store', signal: controller.signal
    });
    if (!response.ok || !response.body) return false;
    reader = response.body.getReader();
    const hash = new Sha256();
    let length = 0;
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > size) return false;
      hash.update(chunk.value);
    }
    return length === size && hash.hex() === sha256;
  } catch { return false; }
  finally {
    if (reader) { try { await reader.cancel(); } catch { /* interrupted stream */ } }
    clearTimeout(timer);
  }
}
export async function verifyPublishedFile(options) {
  const deadline = Date.now() + options.timeoutMs;
  for (;;) {
    const status = await getQdnResourceStatus(options.service, options.name, options.identifier, { build: true });
    if (status?.status === 'READY' && await publishedFileMatches({ ...options, timeoutMs: Math.max(1000, deadline - Date.now()) })) return { ok: true };
    if (Date.now() >= deadline) return { ok: false };
    await new Promise(resolve => setTimeout(resolve, Math.min(2000, deadline - Date.now())));
  }
}
