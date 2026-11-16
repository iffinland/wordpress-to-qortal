import { useEffect, useRef, useState } from 'react';
import { TEXT_COLORS } from '../../../lib/textColors.js';

export function ColorPicker(props: {
  active: string | null;
  onPick: (key: string) => void;
  onReset: () => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const first = wrapRef.current && wrapRef.current.querySelector<HTMLButtonElement>('.color-picker__swatch');
    if (first) first.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); if (buttonRef.current) buttonRef.current.focus(); }
    };
    const onDown = (event: Event) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('pointerdown', onDown); };
  }, [open]);

  const choose = (action: () => void) => { action(); setOpen(false); if (buttonRef.current) buttonRef.current.focus(); };
  const onGridKey = (event: React.KeyboardEvent) => {
    const keys = ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'];
    if (!keys.includes(event.key) || !wrapRef.current) return;
    const items = Array.from(wrapRef.current.querySelectorAll<HTMLButtonElement>('.color-picker__swatch, .color-picker__reset'));
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1;
    const next = items[(index + step + items.length) % items.length];
    if (next) { event.preventDefault(); next.focus(); }
  };

  return (
    <div className="color-picker" ref={wrapRef}>
      <button
        ref={buttonRef}
        type="button"
        className={'editor-toolbar__button' + (props.active ? ' is-active' : '')}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls="color-picker-panel"
        onClick={() => setOpen((value) => !value)}
      >
        Color
      </button>
      {open ? (
        <div id="color-picker-panel" className="color-picker__panel" role="group" aria-label="Text color" onKeyDown={onGridKey}>
          {TEXT_COLORS.map((color) => (
            <button
              key={color.key}
              type="button"
              className={'color-picker__swatch qms-swatch-' + color.key}
              aria-label={color.label}
              aria-pressed={props.active === color.key}
              onClick={() => choose(() => props.onPick(color.key))}
            >
              <span aria-hidden="true">A</span>
            </button>
          ))}
          <button type="button" className="color-picker__reset" onClick={() => choose(props.onReset)}>Reset color</button>
        </div>
      ) : null}
    </div>
  );
}
