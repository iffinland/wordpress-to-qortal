import { Zip, ZipPassThrough } from 'fflate';
import { createReadStream } from 'node:fs';
import { open, readdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

// Bound memory to one input chunk and one output chunk. Media is already
// compressed; storing entries also avoids blocking the host's control channel.
export async function writeZipFile(root, target, { maxBytes = 2 * 1024 ** 3, signal } = {}) {
  const files = [];
  let total = 0;
  async function walk(directory, prefix = '') {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relative = prefix ? prefix + '/' + entry.name : entry.name;
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Package contains a symbolic link: ' + relative);
      if (entry.isDirectory()) await walk(absolute, relative);
      else if (entry.isFile()) {
        const info = await stat(absolute);
        total += info.size;
        if (total > maxBytes) throw new Error('Package exceeds the configured export size limit.');
        files.push({ absolute, relative, size: info.size });
      }
    }
  }
  await walk(root);
  if (!files.some((file) => file.relative === 'handoff.json')) throw new Error('Package is missing handoff.json.');
  const output = await open(target, 'w', 0o600);
  const hash = createHash('sha256');
  let written = 0;
  let pending = Promise.resolve();
  let failure;
  const zip = new Zip((error, data) => {
    if (error) { failure = error; return; }
    const chunk = Buffer.from(data);
    hash.update(chunk);
    written += chunk.length;
    pending = pending.then(async () => {
      let offset = 0;
      while (offset < chunk.length) {
        const result = await output.write(chunk, offset, chunk.length - offset);
        if (!result.bytesWritten) throw new Error('Could not write package.');
        offset += result.bytesWritten;
      }
    });
    // The rejection is checked at every input chunk below.
    pending.catch(() => {});
  });
  try {
    for (const file of files) {
      if (signal?.aborted) throw new Error('Export paused.');
      const member = new ZipPassThrough(file.relative);
      member.mtime = new Date('1980-01-01T00:00:00.000Z');
      zip.add(member);
      let size = 0;
      for await (const chunk of createReadStream(file.absolute, { highWaterMark: 64 * 1024 })) {
        if (signal?.aborted) throw new Error('Export paused.');
        size += chunk.length;
        member.push(new Uint8Array(chunk), false);
        await pending;
        if (failure) throw failure;
      }
      if (size !== file.size || (await stat(file.absolute)).size !== file.size) throw new Error('Package changed during export.');
      member.push(new Uint8Array(), true);
      await pending;
    }
    zip.end();
    await pending;
    if (failure) throw failure;
    await output.sync();
    return { bytes: written, sha256: 'sha256:' + hash.digest('hex') };
  } catch (error) {
    zip.terminate();
    await pending.catch(() => {});
    await unlink(target).catch(() => {});
    throw error;
  } finally { await output.close(); }
}
