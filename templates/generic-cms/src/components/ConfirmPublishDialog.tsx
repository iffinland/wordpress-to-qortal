import { useEffect, useId, useRef } from 'react';
import type { ReactNode, RefObject } from 'react';

/**
 * Shared owner publication dialog. It carries the whole publish lifecycle in
 * one accessible modal so no status is ever shown only somewhere else on the
 * page: confirm -> publishing -> success | partial | ambiguous | error.
 *
 * The component is purely presentational. Publication itself, the
 * never-auto-resend rules and read-back verification stay in the callers.
 */
export type PublishPhase = 'confirm' | 'publishing' | 'success' | 'partial' | 'ambiguous' | 'error';

const PHASE_TITLES: Record<Exclude<PublishPhase, 'confirm'>, string> = {
  publishing: 'Publishing…',
  success: 'Published and verified',
  partial: 'Published, one step pending',
  ambiguous: 'Publication unconfirmed',
  error: 'Not published'
};

const FOCUSABLE = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',');

export function ConfirmPublishDialog(props: {
  /** Heading while the owner is still confirming, for example "Confirm post publication". */
  title: string;
  phase: PublishPhase;
  /** Progress or result text for every phase after confirm. */
  statusMessage?: string;
  /** What will be published: destinations, revision, fee, signer. */
  children?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  closeLabel?: string;
  onConfirm: () => void;
  /** Cancel button and Escape while confirming. */
  onCancel: () => void;
  /** Close button and Escape once a result is shown. */
  onClose: () => void;
  /** Element to focus when the dialog closes. Defaults to the opener. */
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const titleId = useId();
  const statusId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const latest = useRef(props);
  latest.current = props;

  // Remember the opener, lock background scroll, trap focus, restore on close.
  useEffect(() => {
    openerRef.current = typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onDocumentKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const current = latest.current;
      if (current.phase === 'publishing') {
        // A signature request is in flight; closing would hide its outcome.
        event.preventDefault();
        return;
      }
      event.preventDefault();
      if (current.phase === 'confirm') current.onCancel();
      else current.onClose();
    };
    const onFocusIn = (event: FocusEvent) => {
      const dialog = dialogRef.current;
      if (dialog && event.target instanceof Node && !dialog.contains(event.target)) dialog.focus();
    };
    document.addEventListener('keydown', onDocumentKeyDown);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      document.removeEventListener('keydown', onDocumentKeyDown);
      document.removeEventListener('focusin', onFocusIn);
      document.body.style.overflow = previousOverflow;
      const target = latest.current.returnFocusRef && latest.current.returnFocusRef.current
        ? latest.current.returnFocusRef.current
        : openerRef.current;
      if (target && typeof target.focus === 'function' && document.contains(target)) target.focus();
    };
  }, []);

  // Start on the dialog itself (so the heading is read first and an accidental
  // Enter cannot confirm) and again whenever the phase changes, because the
  // focused button is replaced.
  useEffect(() => {
    if (dialogRef.current) dialogRef.current.focus();
  }, [props.phase]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const items = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (items.length === 0) {
      event.preventDefault();
      dialog.focus();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === dialog)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    } else if (active === dialog && !event.shiftKey) {
      event.preventDefault();
      first.focus();
    }
  };

  const phase = props.phase;
  const heading = phase === 'confirm' ? props.title : PHASE_TITLES[phase];
  const alert = phase === 'error' || phase === 'ambiguous';

  return (
    <div className="confirm-dialog-backdrop">
      <div
        ref={dialogRef}
        className="confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={phase === 'confirm' ? undefined : statusId}
        data-phase={phase}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <h3 id={titleId}>{heading}</h3>
        {props.children}
        {phase !== 'confirm' ? (
          <div
            id={statusId}
            className="confirm-dialog__status"
            data-phase={phase}
            role={alert ? 'alert' : 'status'}
            aria-live={alert ? 'assertive' : 'polite'}
          >
            {props.statusMessage || (phase === 'publishing' ? 'Waiting for Qortal Hub approval...' : '')}
            {phase === 'publishing' ? <span className="muted"> Keep this window open until the result appears.</span> : null}
          </div>
        ) : null}
        <div className="admin-toolbar confirm-dialog__actions">
          {phase === 'confirm' ? (
            <>
              <button type="button" className="button" onClick={props.onConfirm}>{props.confirmLabel || 'Confirm publish'}</button>
              <button type="button" className="button button--ghost" onClick={props.onCancel}>{props.cancelLabel || 'Cancel'}</button>
            </>
          ) : null}
          {phase !== 'confirm' && phase !== 'publishing' ? (
            <button type="button" className="button" onClick={props.onClose}>{props.closeLabel || 'Close'}</button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
