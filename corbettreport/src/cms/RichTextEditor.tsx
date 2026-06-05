import React, { useEffect, useRef, useState } from 'react';
import { Bold, Code2, Heading2, Italic, Link, List, ListOrdered, MoreHorizontal, Pilcrow, Quote, Strikethrough, Underline } from 'lucide-react';
import { RichTextToolsModal, type RichTextTool } from './RichTextToolsModal';

interface RichTextEditorProps {
  value: string;
  onChange: (nextValue: string) => void;
}

type EditorMode = 'visual' | 'html';

function command(name: string, value?: string) {
  document.execCommand(name, false, value);
}

export function RichTextEditor({ value, onChange }: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const htmlRef = useRef<HTMLTextAreaElement | null>(null);
  const savedRangeRef = useRef<Range | null>(null);
  const [mode, setMode] = useState<EditorMode>('visual');
  const [toolsOpen, setToolsOpen] = useState(false);

  useEffect(() => {
    if (mode === 'visual' && editorRef.current && editorRef.current.innerHTML !== value) {
      editorRef.current.innerHTML = value;
    }
  }, [mode, value]);

  function syncFromEditor() {
    if (!editorRef.current) return;
    onChange(editorRef.current.innerHTML);
  }

  function saveSelection() {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || !editorRef.current) return;
    const range = selection.getRangeAt(0);
    if (editorRef.current.contains(range.commonAncestorContainer)) {
      savedRangeRef.current = range.cloneRange();
    }
  }

  function restoreSelection() {
    const range = savedRangeRef.current;
    if (!range) return;
    const selection = window.getSelection();
    if (!selection) return;
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function runCommand(name: string, value?: string) {
    editorRef.current?.focus();
    restoreSelection();
    command(name, value);
    syncFromEditor();
    saveSelection();
  }

  function addLink() {
    const url = window.prompt('URL');
    if (!url) return;
    runCommand('createLink', url);
  }

  function insertHtml(html: string) {
    if (mode === 'html') {
      const textarea = htmlRef.current;
      if (!textarea) {
        onChange(`${value}${html}`);
        return;
      }
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const nextValue = `${value.slice(0, start)}${html}${value.slice(end)}`;
      onChange(nextValue);
      requestAnimationFrame(() => {
        textarea.focus();
        textarea.setSelectionRange(start + html.length, start + html.length);
      });
      return;
    }

    editorRef.current?.focus();
    restoreSelection();
    command('insertHTML', html);
    syncFromEditor();
    saveSelection();
  }

  function wrapHtml(openTag: string, closeTag: string, placeholder = 'text') {
    if (mode === 'html') {
      const textarea = htmlRef.current;
      if (!textarea) {
        onChange(`${value}${openTag}${placeholder}${closeTag}`);
        return;
      }
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const selected = value.slice(start, end) || placeholder;
      const nextValue = `${value.slice(0, start)}${openTag}${selected}${closeTag}${value.slice(end)}`;
      onChange(nextValue);
      requestAnimationFrame(() => {
        textarea.focus();
        textarea.setSelectionRange(start + openTag.length, start + openTag.length + selected.length);
      });
      return;
    }

    editorRef.current?.focus();
    restoreSelection();
    const selection = window.getSelection();
    const selected = selection?.toString() || placeholder;
    insertHtml(`${openTag}${selected}${closeTag}`);
  }

  function applyTool(tool: RichTextTool) {
    const commands: Partial<Record<RichTextTool, () => void>> = {
      paragraph: () => runCommand('formatBlock', 'p'),
      heading2: () => runCommand('formatBlock', 'h2'),
      heading3: () => runCommand('formatBlock', 'h3'),
      bold: () => runCommand('bold'),
      italic: () => runCommand('italic'),
      underline: () => runCommand('underline'),
      strike: () => runCommand('strikeThrough'),
      quote: () => runCommand('formatBlock', 'blockquote'),
      unorderedList: () => runCommand('insertUnorderedList'),
      orderedList: () => runCommand('insertOrderedList'),
      inlineCode: () => wrapHtml('<code>', '</code>'),
      codeBlock: () => insertHtml('<pre><code>code</code></pre>'),
      link: addLink
    };

    commands[tool]?.();
  }

  function applyColor(color: string) {
    if (mode === 'html') {
      wrapHtml(`<span style="color:${color}">`, '</span>');
      return;
    }
    runCommand('foreColor', color);
  }

  return (
    <div className="rich-editor">
      <div className="rich-toolbar">
        <button type="button" title="Paragraph" onClick={() => runCommand('formatBlock', 'p')}>
          <Pilcrow size={15} />
        </button>
        <button type="button" title="Heading" onClick={() => runCommand('formatBlock', 'h2')}>
          <Heading2 size={15} />
        </button>
        <button type="button" title="Bold" onClick={() => runCommand('bold')}>
          <Bold size={15} />
        </button>
        <button type="button" title="Italic" onClick={() => runCommand('italic')}>
          <Italic size={15} />
        </button>
        <button type="button" title="Underline" onClick={() => runCommand('underline')}>
          <Underline size={15} />
        </button>
        <button type="button" title="Strike" onClick={() => runCommand('strikeThrough')}>
          <Strikethrough size={15} />
        </button>
        <button type="button" title="Quote" onClick={() => runCommand('formatBlock', 'blockquote')}>
          <Quote size={15} />
        </button>
        <button type="button" title="List" onClick={() => runCommand('insertUnorderedList')}>
          <List size={15} />
        </button>
        <button type="button" title="Numbered list" onClick={() => runCommand('insertOrderedList')}>
          <ListOrdered size={15} />
        </button>
        <button type="button" title="Link" onClick={addLink}>
          <Link size={15} />
        </button>
        <button type="button" title="More tools" onMouseDown={saveSelection} onClick={() => setToolsOpen(true)}>
          <MoreHorizontal size={15} />
        </button>
        <button type="button" title="HTML" className={mode === 'html' ? 'active' : ''} onClick={() => setMode(mode === 'html' ? 'visual' : 'html')}>
          <Code2 size={15} />
        </button>
      </div>

      {mode === 'visual' ? (
        <div
          ref={editorRef}
          className="rich-surface"
          contentEditable
          suppressContentEditableWarning
          onInput={syncFromEditor}
          onKeyUp={saveSelection}
          onMouseUp={saveSelection}
          onBlur={syncFromEditor}
        />
      ) : (
        <textarea ref={htmlRef} className="html-editor" value={value} onChange={(event) => onChange(event.target.value)} />
      )}

      <RichTextToolsModal
        isOpen={toolsOpen}
        onClose={() => setToolsOpen(false)}
        onApplyTool={applyTool}
        onApplyColor={applyColor}
      />
    </div>
  );
}
