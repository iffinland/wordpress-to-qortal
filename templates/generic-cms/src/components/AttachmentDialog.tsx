import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';

const FOCUSABLE = 'button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** Accessible modal sheet: focus trap, Escape, scroll lock, focus returns to the opener. */
export function AttachmentDialog(props: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement | null>(null);
  const latest = useRef(props.onClose);
  latest.current = props.onClose;

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const dialog = ref.current;
    const first = dialog ? dialog.querySelector<HTMLElement>(FOCUSABLE) : null;
    (first || dialog)?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); latest.current(); return; }
      if (event.key !== 'Tab' || !dialog) return;
      const items = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) { event.preventDefault(); dialog.focus(); return; }
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === firstItem || active === dialog)) { event.preventDefault(); lastItem.focus(); }
      else if (!event.shiftKey && active === lastItem) { event.preventDefault(); firstItem.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
      if (opener && typeof opener.focus === 'function' && document.contains(opener)) opener.focus();
    };
  }, []);

  return (
    <div className="attachment-dialog__backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) props.onClose(); }}>
      <div ref={ref} className="attachment-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <header className="attachment-dialog__header">
          <h2 id={titleId}>{props.title}</h2>
          <button type="button" className="button button--ghost" onClick={props.onClose}>Close</button>
        </header>
        <div className="attachment-dialog__body">{props.children}</div>
        {props.footer ? <footer className="attachment-dialog__footer">{props.footer}</footer> : null}
      </div>
    </div>
  );
}
