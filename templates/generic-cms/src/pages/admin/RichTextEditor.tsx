import { useEffect, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import { AttachmentNode } from './editor/AttachmentNode';
import { AttachButton, AttachmentsPanel, type AttachmentStore } from './editor/AttachmentTools';
import { ColorMark } from './editor/ColorMark';
import { ColorPicker } from './editor/ColorPicker';
import { parseQortalLink } from '../../lib/links.js';

export function RichTextEditor(props: {
  value: string;
  onChange: (html: string) => void;
  onInsertMedia: () => void;
  qdnName?: string;
  attachmentStore?: AttachmentStore;
  publicNode?: boolean;
}) {
  const [attachNotice, setAttachNotice] = useState<{ message: string; error: boolean }>({ message: '', error: false });
  const [fallbackStore] = useState<AttachmentStore>(() => new Map());
  const store = props.attachmentStore || fallbackStore;
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3] } }),
      Link.configure({ openOnClick: false, autolink: true, protocols: ['http', 'https', 'qortal'], HTMLAttributes: { rel: 'noopener noreferrer' } }),
      Image.configure({ inline: false, allowBase64: false }),
      ColorMark,
      AttachmentNode,
      Placeholder.configure({ placeholder: 'Write the post…' })
    ],
    content: props.value || '',
    onUpdate: ({ editor: current }) => props.onChange(current.getHTML())
  });

  useEffect(() => {
    if (editor && props.value !== editor.getHTML()) {
      editor.commands.setContent(props.value || '', false);
    }
  }, [editor, props.value]);

  if (!editor) return <p className="muted">Loading editor…</p>;

  const setLink = () => {
    const previous = editor.getAttributes('link').href as string | undefined;
    const href = window.prompt('Link URL (https://, qortal:// or #/internal-path)', previous || 'https://');
    if (href == null) return;
    if (href === '') { editor.chain().focus().extendMarkRange('link').unsetLink().run(); return; }
    try {
      const value = href.trim();
      if (value.startsWith('#/')) {
        editor.chain().focus().extendMarkRange('link').setLink({ href: value }).run();
        return;
      }
      if (/^qortal:\/\//i.test(value)) {
        if (!parseQortalLink(value)) throw new Error('Invalid qortal link');
        editor.chain().focus().extendMarkRange('link').setLink({ href: value }).run();
        return;
      }
      const parsed = new URL(value, window.location.origin);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Unsupported protocol');
      editor.chain().focus().extendMarkRange('link').setLink({ href: value }).run();
    } catch {
      window.alert('Use an http(s) URL, a valid qortal:// link, or an internal #/ path.');
    }
  };

  const button = (label: string, action: () => void, active = false, disabled = false) => (
    <button
      type="button"
      className={'editor-toolbar__button' + (active ? ' is-active' : '')}
      aria-pressed={active}
      onClick={action}
      disabled={disabled}
    >
      {label}
    </button>
  );

  return (
    <div className="editor">
      <div className="editor-toolbar" role="toolbar" aria-label="Formatting">
        {button('H2', () => editor.chain().focus().toggleHeading({ level: 2 }).run(), editor.isActive('heading', { level: 2 }))}
        {button('H3', () => editor.chain().focus().toggleHeading({ level: 3 }).run(), editor.isActive('heading', { level: 3 }))}
        {button('Bold', () => editor.chain().focus().toggleBold().run(), editor.isActive('bold'))}
        {button('Italic', () => editor.chain().focus().toggleItalic().run(), editor.isActive('italic'))}
        {button('Bullets', () => editor.chain().focus().toggleBulletList().run(), editor.isActive('bulletList'))}
        {button('Numbers', () => editor.chain().focus().toggleOrderedList().run(), editor.isActive('orderedList'))}
        {button('Quote', () => editor.chain().focus().toggleBlockquote().run(), editor.isActive('blockquote'))}
        <ColorPicker
          active={(editor.getAttributes('textColor').color as string) || null}
          onPick={(key) => editor.chain().focus().setTextColor(key).run()}
          onReset={() => editor.chain().focus().unsetTextColor().run()}
        />
        {button('Link', setLink, editor.isActive('link'))}
        {button('Image', props.onInsertMedia)}
        <AttachButton editor={editor} qdnName={props.qdnName || ''} store={store} publicNode={Boolean(props.publicNode)} onStatus={(message, error) => setAttachNotice({ message, error: Boolean(error) })} />
        {button('Undo', () => editor.chain().focus().undo().run(), false, !editor.can().undo())}
        {button('Redo', () => editor.chain().focus().redo().run(), false, !editor.can().redo())}
      </div>
      <p className={'muted attach-notice' + (attachNotice.error ? ' attach-notice--error' : '')} role={attachNotice.error ? 'alert' : 'status'} aria-live="polite">{attachNotice.message}</p>
      <EditorContent editor={editor} className="editor__content" />
      <AttachmentsPanel editor={editor} store={store} onStatus={(message, error) => setAttachNotice({ message, error: Boolean(error) })} />
    </div>
  );
}

