import { useRef, useState } from 'react';
import type { CmsContentItem } from '../../types';
import { pageHref } from '../../lib/routes.js';
import { QORTAL_COMMUNITY_CHAT_LINK } from '../../lib/links.js';

export interface NavItemDraft { label: string; href: string }

const CUSTOM = '__custom__';
const PRESETS: NavItemDraft[] = [
  { label: 'Home', href: '#/' },
  { label: 'Posts', href: '#/posts' },
  { label: 'Archive', href: '#/archive' },
  { label: 'Search', href: '#/search' },
  { label: 'Gallery', href: '#/gallery' },
  { label: 'Community chat', href: QORTAL_COMMUNITY_CHAT_LINK },
  { label: 'Admin', href: '#/admin' }
];

export function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return items;
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

export function NavigationEditor(props: {
  items: NavItemDraft[];
  pages: CmsContentItem[];
  maxItems?: number;
  onChange: (items: NavItemDraft[]) => void;
}) {
  const { items, pages } = props;
  const max = props.maxItems || 12;
  const [announce, setAnnounce] = useState('');
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [customRows, setCustomRows] = useState<Record<number, boolean>>({});
  const listRef = useRef<HTMLDivElement>(null);
  const options = [
    ...PRESETS,
    ...pages.filter((page) => page.status === 'published' || !page.status).map((page) => ({ label: page.title, href: pageHref(page.slug) }))
  ];
  const update = (index: number, patch: Partial<NavItemDraft>) => props.onChange(items.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  const move = (from: number, to: number) => {
    if (to < 0 || to >= items.length) return;
    props.onChange(moveItem(items, from, to));
    setCustomRows({});
    setAnnounce((items[from].label || 'Item') + ' moved to position ' + (to + 1) + ' of ' + items.length + '.');
  };
  const rowFromPoint = (x: number, y: number) => {
    if (typeof document.elementFromPoint !== 'function') return null;
    const el = document.elementFromPoint(x, y);
    const row = el && (el as HTMLElement).closest ? (el as HTMLElement).closest('[data-nav-index]') : null;
    return row ? Number(row.getAttribute('data-nav-index')) : null;
  };
  const endDrag = (event: React.PointerEvent, from: number) => {
    const target = rowFromPoint(event.clientX, event.clientY);
    setDragIndex(null);
    if (target !== null && target !== from) move(from, target);
  };
  return (
    <div ref={listRef} className="nav-editor">
      {items.map((item, index) => {
        const known = options.find((option) => option.href === item.href);
        const isCustom = !known || customRows[index];
        return (
          <div className={'admin-row nav-editor__row' + (dragIndex === index ? ' is-dragging' : '')} key={index} data-nav-index={index}>
            <button
              type="button"
              className="button button--ghost nav-editor__handle"
              aria-label={'Drag to reorder ' + (item.label || 'item ' + (index + 1))}
              onPointerDown={(event) => { setDragIndex(index); try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* optional */ } }}
              onPointerUp={(event) => endDrag(event, index)}
              onPointerCancel={() => setDragIndex(null)}
            >
              <span aria-hidden="true">⠿</span>
            </button>
            <label>Label<input value={item.label} maxLength={40} onChange={(event) => update(index, { label: event.target.value })} /></label>
            <label>Target
              <select
                value={isCustom ? CUSTOM : item.href}
                onChange={(event) => {
                  if (event.target.value === CUSTOM) { setCustomRows({ ...customRows, [index]: true }); return; }
                  const chosen = options.find((option) => option.href === event.target.value);
                  setCustomRows({ ...customRows, [index]: false });
                  update(index, { href: event.target.value, label: item.label && item.label !== 'New link' ? item.label : chosen ? chosen.label : item.label });
                }}
              >
                {options.map((option) => <option key={option.href} value={option.href}>{option.label}</option>)}
                <option value={CUSTOM}>Custom link…</option>
              </select>
            </label>
            {isCustom ? (
              <label>Link<input value={item.href} onChange={(event) => update(index, { href: event.target.value })} placeholder="#/posts" /></label>
            ) : null}
            <button type="button" className="button button--ghost" aria-label={'Move ' + (item.label || 'item') + ' up'} onClick={() => move(index, index - 1)} disabled={index === 0}>Move up</button>
            <button type="button" className="button button--ghost" aria-label={'Move ' + (item.label || 'item') + ' down'} onClick={() => move(index, index + 1)} disabled={index === items.length - 1}>Move down</button>
            <button type="button" className="button button--ghost" onClick={() => props.onChange(items.filter((_, i) => i !== index))} disabled={items.length <= 1}>Remove</button>
          </div>
        );
      })}
      <button type="button" className="button button--ghost" onClick={() => props.onChange([...items, { label: 'New link', href: '#/' }])} disabled={items.length >= max}>Add navigation item</button>
      <p className="visually-hidden" role="status" aria-live="polite">{announce}</p>
    </div>
  );
}
