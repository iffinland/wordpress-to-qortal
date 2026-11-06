/**
 * Clipboard copy that works in Qortal Hub iframes and on Android. The async
 * Clipboard API is preferred; execCommand with a hidden textarea is the
 * Hub-compatible fallback. Returns false instead of throwing.
 */
export async function copyText(value) {
  const text = String(value == null ? '' : value);
  if (!text.trim()) return false;

  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the legacy path; Hub iframe permissions can block this.
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
}
