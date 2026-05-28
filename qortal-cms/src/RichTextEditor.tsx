import React, { useEffect, useRef, useState } from 'react';
import { Bold, Code2, Heading2, Italic, Link, List, Pilcrow, Quote, Strikethrough } from 'lucide-react';

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
  const [mode, setMode] = useState<EditorMode>('visual');

  useEffect(() => {
    if (mode === 'visual' && editorRef.current && editorRef.current.innerHTML !== value) {
      editorRef.current.innerHTML = value;
    }
  }, [mode, value]);

  function syncFromEditor() {
    if (!editorRef.current) return;
    onChange(editorRef.current.innerHTML);
  }

  function runCommand(name: string, value?: string) {
    editorRef.current?.focus();
    command(name, value);
    syncFromEditor();
  }

  function addLink() {
    const url = window.prompt('URL');
    if (!url) return;
    runCommand('createLink', url);
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
        <button type="button" title="Strike" onClick={() => runCommand('strikeThrough')}>
          <Strikethrough size={15} />
        </button>
        <button type="button" title="Quote" onClick={() => runCommand('formatBlock', 'blockquote')}>
          <Quote size={15} />
        </button>
        <button type="button" title="List" onClick={() => runCommand('insertUnorderedList')}>
          <List size={15} />
        </button>
        <button type="button" title="Link" onClick={addLink}>
          <Link size={15} />
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
          onBlur={syncFromEditor}
        />
      ) : (
        <textarea className="html-editor" value={value} onChange={(event) => onChange(event.target.value)} />
      )}
    </div>
  );
}
