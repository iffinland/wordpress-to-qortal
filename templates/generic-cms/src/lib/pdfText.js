/**
 * Lazy PDF text extraction. pdfjs-dist is imported only when a reader clicks a
 * PDF preview, so it never loads for ordinary pages. The worker runs on the
 * main thread (fake worker) to avoid cross-origin worker loading inside Hub.
 */
export const PDF_MAX_PAGES = 30;
export const PDF_MAX_CHARS = 100000;

export async function extractPdfText(bytes) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.min.mjs');
  await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs');
  const task = pdfjs.getDocument({ data: bytes, isEvalSupported: false, disableFontFace: true, useSystemFonts: false });
  const doc = await task.promise;
  const pages = Math.min(doc.numPages, PDF_MAX_PAGES);
  let text = '';
  for (let number = 1; number <= pages && text.length < PDF_MAX_CHARS; number += 1) {
    const page = await doc.getPage(number);
    const content = await page.getTextContent();
    text += content.items.map((item) => ('str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '')).join('') + '\n\n';
  }
  const truncated = doc.numPages > pages || text.length > PDF_MAX_CHARS;
  return { text: text.slice(0, PDF_MAX_CHARS).trim(), truncated, pages: doc.numPages };
}
