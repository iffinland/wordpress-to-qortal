import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { AttachmentNode } from '../src/pages/admin/editor/AttachmentNode';
import { sanitizeHtml } from '../src/lib/sanitize.js';
import {
  MAX_AV_BYTES, MAX_OTHER_BYTES, MAX_PUBLIC_NODE_BYTES, MIB, attachmentIdentifier, attachmentsInHtml,
  classifyFile, normalizeAttachmentMeta, safeFileName, validateAttachment
} from '../src/lib/attachments.js';
import { Sha256, hashBlobStreaming } from '../src/lib/sha256Stream.js';
import { sha256Hex } from '../src/lib/qortal.js';

const editors: Editor[] = [];
afterEach(() => { editors.splice(0).forEach((e) => e.destroy()); });
const make = (content = '<p>x</p>') => { const e = new Editor({ extensions: [StarterKit, AttachmentNode], content }); editors.push(e); return e; };

const meta = { kind: 'video', service: 'VIDEO', name: 'QortalDemo', identifier: 'qms-cms-att-' + 'a'.repeat(32), filename: 'clip.mp4', title: 'My clip', mime: 'video/mp4', size: 1234, poster: 'qms-cms-media-' + 'b'.repeat(32) };

describe('attachment type allowlist and denylist', () => {
  it.each(['a.txt', 'a.md', 'a.pdf', 'a.mp3', 'a.m4a', 'a.mp4', 'a.webm', 'a.zip', 'a.7z', 'a.rar', 'a.tar', 'a.gz', 'a.tgz', 'a.bz2', 'a.xz', 'a.doc', 'a.docx', 'a.xls', 'a.xlsx', 'a.odt', 'a.csv', 'a.json'])('allows %s', (name) => {
    expect(classifyFile(name).ok).toBe(true);
  });
  it.each(['a.html', 'a.htm', 'a.svg', 'a.js', 'a.mjs', 'a.xhtml', 'a.exe', 'A.HTML', 'a.SVG'])('blocks %s with a clear message', (name) => {
    const r: any = classifyFile(name);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/cannot be attached/);
  });
  it('blocks by MIME even with a harmless extension and rejects unknown or missing types', () => {
    expect(classifyFile('a.txt', 'text/html').ok).toBe(false);
    expect(classifyFile('a.png', 'image/svg+xml').ok).toBe(false);
    expect(classifyFile('a.bin').ok).toBe(false);
    expect(classifyFile('noext').ok).toBe(false);
  });
  it('maps types to QDN services', () => {
    expect((classifyFile('a.mp3') as any).service).toBe('AUDIO');
    expect((classifyFile('a.mp4') as any).service).toBe('VIDEO');
    expect((classifyFile('a.zip') as any).service).toBe('FILE');
    expect((classifyFile('a.pdf') as any).service).toBe('FILE');
  });
});

describe('attachment size limits', () => {
  it('uses the verified Hub limits', () => {
    expect(MAX_AV_BYTES).toBe(2000 * MIB);
    expect(MAX_OTHER_BYTES).toBe(50 * MIB);
    expect(MAX_PUBLIC_NODE_BYTES).toBe(500 * MIB);
  });
  it('rejects oversized files with specific messages before any signing', () => {
    const other: any = validateAttachment({ name: 'a.zip', size: 50 * MIB + 1, type: '' });
    expect(other.ok).toBe(false);
    expect(other.message).toMatch(/at most 50 MB/);
    const av: any = validateAttachment({ name: 'a.mp4', size: 2000 * MIB + 1, type: '' });
    expect(av.ok).toBe(false);
    expect(av.message).toMatch(/at most 2000 MB/);
    expect(validateAttachment({ name: 'a.mp4', size: 2000 * MIB, type: '' }).ok).toBe(true);
    expect(validateAttachment({ name: 'a.zip', size: 50 * MIB, type: '' }).ok).toBe(true);
    const pub: any = validateAttachment({ name: 'a.mp4', size: 600 * MIB, type: '' }, { publicNode: true });
    expect(pub.ok).toBe(false);
    expect(pub.message).toMatch(/public node accepts at most 500 MB/);
    expect(validateAttachment({ name: 'a.mp4', size: 0, type: '' }).ok).toBe(false);
  });
});

describe('attachment metadata and node serialisation', () => {
  it('serialises to a sanitised block that round-trips', () => {
    const editor = make();
    expect(editor.commands.insertAttachment(meta)).toBe(true);
    const html = editor.getHTML();
    expect(html).toContain('data-qms-attachment="1"');
    expect(html).toContain('>My clip</div>');
    const clean = sanitizeHtml(html);
    expect(clean).toContain('data-identifier="' + meta.identifier + '"');
    const again = make(clean);
    expect(again.getHTML()).toBe(html);
    expect(attachmentsInHtml(clean)).toHaveLength(1);
  });
  it('rejects invalid metadata (service mismatch, bad identifier, denied extension)', () => {
    expect(normalizeAttachmentMeta({ ...meta, service: 'FILE' })).toBeNull();
    expect(normalizeAttachmentMeta({ ...meta, identifier: 'a/b' })).toBeNull();
    expect(normalizeAttachmentMeta({ ...meta, filename: 'x.html' })).toBeNull();
    expect(normalizeAttachmentMeta({ ...meta, name: '<b>' })).toBeNull();
    expect(make().commands.insertAttachment({ ...meta, identifier: '"><script>' })).toBe(false);
  });
  it('treats titles and file names as text and strips hostile markup in the sanitizer', () => {
    const evil = '<div data-qms-attachment="1" data-kind="audio" data-service="AUDIO" data-name="QortalDemo" data-identifier="' + meta.identifier + '" data-filename="../x&lt;img src=x onerror=alert(1)&gt;.mp3" data-title="&lt;img src=x onerror=alert(1)&gt;" onclick="alert(1)" style="x:y">&lt;script&gt;alert(1)&lt;/script&gt;</div>';
    const clean = sanitizeHtml(evil);
    const doc = new DOMParser().parseFromString(clean, 'text/html');
    expect(doc.querySelector('img,script')).toBeNull();
    const el = doc.querySelector('div[data-qms-attachment]')!;
    expect(el.hasAttribute('onclick')).toBe(false);
    expect(el.hasAttribute('style')).toBe(false);
    expect(el.getAttribute('data-title')).not.toMatch(/[<>]/);
    expect(el.getAttribute('data-filename')).not.toMatch(/[<>\/]/);
    expect(clean).toContain('data-qms-attachment="1"');
    const bad = sanitizeHtml('<div data-qms-attachment="1" data-kind="video" data-service="FILE" data-name="x" data-identifier="a"></div><p data-qms-attachment="1" data-foo="1">t</p>');
    expect(bad).not.toContain('data-qms-attachment');
    expect(bad).not.toContain('data-foo');
  });
  it('builds identifiers and safe names', () => {
    expect(attachmentIdentifier('c'.repeat(64))).toBe('qms-cms-att-' + 'c'.repeat(32));
    expect(() => attachmentIdentifier('zz')).toThrow();
    expect(safeFileName('a<b>:c.mp3')).toBe('a_b_c.mp3');
    expect(safeFileName('../etc/passwd')).toBe('passwd');
  });
});

describe('streaming hash', () => {
  it('matches SubtleCrypto for sliced blobs', async () => {
    const bytes = new Uint8Array(300000).map((_, i) => (i * 31) % 251);
    const blob = new Blob([bytes]);
    expect(await hashBlobStreaming(blob, undefined, 65537)).toBe(await sha256Hex(bytes));
    expect(new Sha256().hex()).toBe(await sha256Hex(new Uint8Array(0)));
  });
});
