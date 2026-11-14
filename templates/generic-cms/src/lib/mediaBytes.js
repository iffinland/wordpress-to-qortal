/**
 * Read a picked File into memory exactly once, while the picker still owns the
 * reference. Android Qortal Hub can revoke the content URI after the selection
 * callback returns, so this must happen before any network or approval await.
 */
export async function readFileBytes(file) {
  if (!file) throw new Error('No file was selected.');
  if (typeof file.arrayBuffer === 'function') {
    try {
      return new Uint8Array(await file.arrayBuffer());
    } catch {
      // Fall through to FileReader: some embedded webviews expose a File whose
      // arrayBuffer() is unavailable even though the bytes are still readable.
    }
  }
  if (typeof FileReader !== 'undefined') {
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(new Uint8Array(reader.result));
      reader.onerror = () => reject(reader.error || new Error('The selected file could not be read.'));
      reader.readAsArrayBuffer(file);
    });
  }
  if (typeof Response !== 'undefined') {
    return new Uint8Array(await new Response(file).arrayBuffer());
  }
  throw new Error('The selected file could not be read from this device.');
}
