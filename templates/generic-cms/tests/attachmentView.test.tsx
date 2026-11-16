import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AttachmentView } from '../src/components/AttachmentView';
import { ContentHtml } from '../src/components/ContentHtml';
import { markdownToSafeHtml } from '../src/lib/miniMarkdown.js';

(HTMLMediaElement.prototype as any).play = vi.fn(async () => undefined);
afterEach(() => { cleanup(); vi.unstubAllGlobals(); document.body.style.overflow = ''; });

const base = { name: 'QortalDemo', identifier: 'qms-cms-att-' + 'a'.repeat(32), filename: 'f.zip', title: 'My file', mime: '', size: 2048, poster: '' };
const html = (attrs: Record<string, string>, text = 'T') => '<div data-qms-attachment="1" ' + Object.entries(attrs).map(([k, v]) => 'data-' + k + '="' + v + '"').join(' ') + '>' + text + '</div>';

describe('attachment rendering', () => {
  it('renders audio as a lazy inline player with the title beside it', () => {
    const { container } = render(<AttachmentView meta={{ ...base, kind: 'audio', service: 'AUDIO', preview: null, filename: 'a.mp3', title: 'Song' }} />);
    const audio = container.querySelector('audio')!;
    expect(audio.getAttribute('preload')).toBe('none');
    expect(audio.hasAttribute('controls')).toBe(true);
    expect(audio.getAttribute('src')).toContain('/arbitrary/AUDIO/QortalDemo/');
    expect(screen.getByText('Song')).toBeTruthy();
  });

  it('renders video as a poster card and starts native playback in place on click', () => {
    const { container } = render(<AttachmentView meta={{ ...base, kind: 'video', service: 'VIDEO', preview: null, filename: 'v.mp4', title: 'Clip', poster: 'qms-cms-media-' + 'b'.repeat(32) }} />);
    expect(container.querySelector('video')).toBeNull();
    expect(container.querySelector('img')!.getAttribute('src')).toContain('/arbitrary/IMAGE/QortalDemo/');
    fireEvent.click(screen.getByRole('button', { name: 'Play video: Clip' }));
    const video = container.querySelector('video')!;
    expect(video.getAttribute('preload')).toBe('none');
    expect(video.hasAttribute('controls')).toBe(true);
    expect(video.hasAttribute('playsinline')).toBe(true);
    expect(container.querySelector('.attachment__media')).toBeTruthy();
  });

  it('shows a placeholder when the video has no poster', () => {
    const { container } = render(<AttachmentView meta={{ ...base, kind: 'video', service: 'VIDEO', preview: null, filename: 'v.mp4' }} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('.attachment__placeholder')).toBeTruthy();
  });

  it('archives get an icon, title and a download-only link (never inline)', () => {
    const { container } = render(<AttachmentView meta={{ ...base, kind: 'archive', service: 'FILE', preview: null }} />);
    const link = container.querySelector('a')!;
    expect(link.getAttribute('download')).toBe('f.zip');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(container.querySelector('svg')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Preview' })).toBeNull();
  });

  it('renders hostile titles and file names as text only', () => {
    const { container } = render(<AttachmentView meta={{ ...base, kind: 'archive', service: 'FILE', preview: null, title: '<img src=x onerror=alert(1)>', filename: '<b>x</b>.zip' }} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
  });
});

describe('text preview modal', () => {
  const textMeta = { ...base, kind: 'text', service: 'FILE', preview: 'txt' as const, filename: 'n.txt', title: 'Notes' };

  it('is an accessible modal: focus moves in, Tab is trapped, scroll locks, Escape closes and focus returns', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<b>plain</b> text')));
    render(<AttachmentView meta={textMeta} />);
    const opener = screen.getByRole('button', { name: 'Preview' });
    opener.focus();
    fireEvent.click(opener);
    const dialog = await screen.findByRole('dialog', { name: 'Notes' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.body.style.overflow).toBe('hidden');
    expect(dialog.contains(document.activeElement)).toBe(true);
    await waitFor(() => expect(dialog.querySelector('pre')!.textContent).toBe('<b>plain</b> text'));
    expect(dialog.querySelector('b')).toBeNull();
    const last = Array.from(dialog.querySelectorAll<HTMLElement>('button,a[href]')).pop()!;
    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(dialog.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.body.style.overflow).toBe('');
    expect(document.activeElement).toBe(opener);
  });

  it('caps large text and offers Download full file', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x'.repeat(300 * 1024))));
    render(<AttachmentView meta={textMeta} />);
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(dialog.querySelector('pre')).toBeTruthy());
    expect(dialog.querySelector('pre')!.textContent!.length).toBeLessThanOrEqual(256 * 1024);
    expect(dialog.textContent).toMatch(/Showing the first/);
    expect(screen.getByRole('link', { name: /Download full file/ })).toBeTruthy();
  });

  it('shows a clear message with Download when the preview fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })));
    render(<AttachmentView meta={{ ...textMeta, preview: 'pdf' }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect((await screen.findAllByRole('alert'))[0].textContent).toMatch(/could not be loaded/);
    expect(screen.getByRole('link', { name: /Download full file/ })).toBeTruthy();
  });
});

describe('markdown preview safety', () => {
  it('escapes HTML and blocks javascript links and images', () => {
    const out = markdownToSafeHtml('# Title\n\n<script>alert(1)</script> **bold** [x](javascript:alert(1)) [ok](https://example.org) ![i](http://x/y.png)\n\n- a\n- b\n\n```\n<img src=x onerror=1>\n```');
    const doc = new DOMParser().parseFromString(out, 'text/html');
    expect(doc.querySelector('script')).toBeNull();
    expect(doc.querySelector('img')).toBeNull();
    expect(doc.querySelectorAll('a').length).toBe(1);
    expect(doc.querySelector('a')!.getAttribute('href')).toBe('https://example.org');
    expect(doc.querySelector('h2')!.textContent).toBe('Title');
    expect(doc.querySelectorAll('li').length).toBe(2);
    expect(doc.querySelector('pre')!.textContent).toContain('<img src=x onerror=1>');
  });
});

describe('ContentHtml hydration', () => {
  it('turns sanitized attachment blocks into players and cards and ignores invalid ones', () => {
    const content = html({ kind: 'audio', service: 'AUDIO', name: 'QortalDemo', identifier: base.identifier, filename: 'a.mp3', title: 'Song' })
      + html({ kind: 'archive', service: 'FILE', name: 'QortalDemo', identifier: base.identifier, filename: 'x.zip', title: 'Zip' })
      + html({ kind: 'video', service: 'FILE', name: 'QortalDemo', identifier: base.identifier, filename: 'x.mp4', title: 'Bad' });
    const { container } = render(<ContentHtml html={content} />);
    expect(container.querySelector('audio')).toBeTruthy();
    expect(container.querySelector('a[download]')!.getAttribute('download')).toBe('x.zip');
    expect(container.textContent).not.toContain('Bad');
  });
});

describe('pdf preview (lazy extraction)', () => {
  const pdfMeta = { ...base, kind: 'text', service: 'FILE', preview: 'pdf' as const, filename: 'd.pdf', title: 'Doc' };
  it('shows extracted text', async () => {
    vi.resetModules();
    vi.doMock('../src/lib/pdfText.js', () => ({ extractPdfText: async () => ({ text: 'Hello PDF', truncated: false, pages: 1 }) }));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([37, 80, 68, 70]))));
    const { AttachmentView: View } = await import('../src/components/AttachmentView');
    render(<View meta={pdfMeta} />);
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    await waitFor(() => expect(screen.getByRole('dialog').textContent).toContain('Hello PDF'));
    vi.doUnmock('../src/lib/pdfText.js');
  });
  it('explains scanned or unreadable PDFs and keeps Download', async () => {
    vi.resetModules();
    vi.doMock('../src/lib/pdfText.js', () => ({ extractPdfText: async () => ({ text: '', truncated: false, pages: 3 }) }));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([37, 80, 68, 70]))));
    const { AttachmentView: View } = await import('../src/components/AttachmentView');
    render(<View meta={pdfMeta} />);
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect((await screen.findAllByRole('alert'))[0].textContent).toMatch(/scanned images/);
    expect(screen.getByRole('link', { name: /Download full file/ })).toBeTruthy();
    vi.doUnmock('../src/lib/pdfText.js');
  });
});
