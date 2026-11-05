import { useEffect } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';

export function RichTextEditor(props: {
  value: string;
  onChange: (html: string) => void;
  onInsertMedia: () => void;
}) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3] } }),
      Link.configure({ openOnClick: false, autolink: true, protocols: ['http', 'https'], HTMLAttributes: { rel: 'noopener noreferrer' } }),
      Image.configure({ inline: false, allowBase64: false }),
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
    const href = window.prompt('Link URL (https:// or /internal-path)', previous || 'https://');
    if (href == null) return;
    if (href === '') { editor.chain().focus().extendMarkRange('link').unsetLink().run(); return; }
    try {
      const parsed = new URL(href, window.location.origin);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Unsupported protocol');
      editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
    } catch {
      window.alert('Only http and https links are allowed.');
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
        {button('Link', setLink, editor.isActive('link'))}
        {button('Image', props.onInsertMedia)}
        {button('Undo', () => editor.chain().focus().undo().run(), false, !editor.can().undo())}
        {button('Redo', () => editor.chain().focus().redo().run(), false, !editor.can().redo())}
      </div>
      <EditorContent editor={editor} className="editor__content" />
    </div>
  );
}

