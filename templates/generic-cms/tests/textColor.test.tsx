import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { ColorMark } from '../src/pages/admin/editor/ColorMark';
import { sanitizeHtml } from '../src/lib/sanitize.js';
import { TEXT_COLORS } from '../src/lib/textColors.js';

const editors: Editor[] = [];
const make = (content: string) => { const e = new Editor({ extensions: [StarterKit, ColorMark], content }); editors.push(e); return e; };
afterEach(() => { editors.splice(0).forEach((e) => e.destroy()); });

describe('text colour mark', () => {
  it('has 9 palette colours', () => expect(TEXT_COLORS.length).toBe(9));
  it('serialises to class-only spans, survives sanitizer and a load/save round trip', () => {
    const editor = make('<p>Hello world</p>');
    editor.commands.setTextSelection({ from: 1, to: 6 });
    editor.commands.setTextColor('red');
    const html = editor.getHTML();
    expect(html).toContain('<span class="qms-color qms-color-red">Hello</span>');
    expect(html).not.toContain('style=');
    const clean = sanitizeHtml(html);
    expect(clean).toContain('qms-color-red');
    const again = make(clean);
    expect(again.getHTML()).toBe(html);
  });
  it('ignores unknown colours and inline styles, and can reset', () => {
    const editor = make('<p><span style="color:red">x</span> <span class="qms-color qms-color-evil">y</span> <span class="qms-color qms-color-blue">z</span></p>');
    const html = editor.getHTML();
    expect(html).not.toContain('style=');
    expect(html).not.toContain('evil');
    expect(html).toContain('qms-color-blue');
    editor.commands.selectAll();
    editor.commands.unsetTextColor();
    expect(editor.getHTML()).not.toContain('qms-color');
    expect(editor.commands.setTextColor('evil')).toBe(false);
  });
});
