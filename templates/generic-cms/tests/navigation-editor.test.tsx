import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NavigationEditor, moveItem } from '../src/pages/admin/NavigationEditor';

afterEach(cleanup);

const pages = [{ id: 'p1', type: 'page', title: 'Files', slug: 'files', status: 'published' }] as never[];
const items = [
  { label: 'Home', href: '#/' },
  { label: 'Posts', href: '#/posts' },
  { label: 'Files', href: '#/pages/files' },
  { label: 'Ext', href: 'https://example.org' }
];

describe('NavigationEditor', () => {
  it('moves items with Move up/down and announces the result', () => {
    const onChange = vi.fn();
    render(<NavigationEditor items={items} pages={pages} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Move Files up' }));
    expect(onChange.mock.calls[0][0].map((i: { label: string }) => i.label)).toEqual(['Home', 'Files', 'Posts', 'Ext']);
    expect(screen.getByRole('status').textContent).toContain('Files moved to position 2 of 4');
    expect((screen.getByRole('button', { name: 'Move Home up' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('offers pages in the picker and keeps custom links editable', () => {
    render(<NavigationEditor items={items} pages={pages} onChange={() => undefined} />);
    expect(screen.getAllByRole('option', { name: 'Files' }).length).toBeGreaterThan(0);
    expect(screen.getByDisplayValue('https://example.org')).toBeTruthy();
  });

  it('moveItem is a pure reorder', () => {
    expect(moveItem([1, 2, 3], 0, 2)).toEqual([2, 3, 1]);
    expect(moveItem([1, 2, 3], 0, 5)).toEqual([1, 2, 3]);
  });
});
