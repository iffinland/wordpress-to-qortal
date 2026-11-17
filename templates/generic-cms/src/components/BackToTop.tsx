import { useEffect, useState } from 'react';

/**
 * Compact, accessible Back to Top control.
 *
 * It appears only after the reader has scrolled well past the first viewport,
 * sits above the safe-area inset on phones and never covers header controls.
 * Focus moves to the main landmark after the jump so keyboard and screen
 * reader users continue from the top of the content.
 */
export function BackToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const threshold = () => Math.max(480, (window.innerHeight || 0) * 0.75);
    const update = () => setVisible((window.scrollY || 0) > threshold());
    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, []);

  const jump = () => {
    const main = typeof document !== 'undefined' ? document.getElementById('main-content') : null;
    const reduced = typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false;
    if (typeof window !== 'undefined' && typeof window.scrollTo === 'function') {
      window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
    }
    if (main && typeof main.focus === 'function') main.focus({ preventScroll: true });
  };

  if (!visible) return null;
  return (
    <button type="button" className="back-to-top" onClick={jump} aria-label="Back to top">
      <span className="back-to-top__icon" aria-hidden="true">↑</span>
      <span className="back-to-top__label">Top</span>
    </button>
  );
}
