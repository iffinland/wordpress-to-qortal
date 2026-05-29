import { Code2, Heading2, Heading3, Link, List, ListOrdered, Palette, Quote, Type, XCircle } from 'lucide-react';

export type RichTextTool =
  | 'heading2'
  | 'heading3'
  | 'paragraph'
  | 'bold'
  | 'italic'
  | 'underline'
  | 'strike'
  | 'quote'
  | 'inlineCode'
  | 'codeBlock'
  | 'unorderedList'
  | 'orderedList'
  | 'link';

interface RichTextToolsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApplyTool: (tool: RichTextTool) => void;
  onApplyColor: (color: string) => void;
}

const toolGroups: Array<{ title: string; items: Array<{ label: string; tool: RichTextTool; icon: JSX.Element }> }> = [
  {
    title: 'Structure',
    items: [
      { label: 'Paragraph', tool: 'paragraph', icon: <Type size={16} /> },
      { label: 'Heading 2', tool: 'heading2', icon: <Heading2 size={16} /> },
      { label: 'Heading 3', tool: 'heading3', icon: <Heading3 size={16} /> },
      { label: 'Quote', tool: 'quote', icon: <Quote size={16} /> }
    ]
  },
  {
    title: 'Inline',
    items: [
      { label: 'Bold', tool: 'bold', icon: <strong>B</strong> },
      { label: 'Italic', tool: 'italic', icon: <em>I</em> },
      { label: 'Underline', tool: 'underline', icon: <span className="tool-underline">U</span> },
      { label: 'Strike', tool: 'strike', icon: <span className="tool-strike">S</span> },
      { label: 'Inline code', tool: 'inlineCode', icon: <Code2 size={16} /> },
      { label: 'Link', tool: 'link', icon: <Link size={16} /> }
    ]
  },
  {
    title: 'Blocks',
    items: [
      { label: 'Code block', tool: 'codeBlock', icon: <Code2 size={16} /> },
      { label: 'Bullet list', tool: 'unorderedList', icon: <List size={16} /> },
      { label: 'Numbered list', tool: 'orderedList', icon: <ListOrdered size={16} /> }
    ]
  }
];

const colors = ['#111827', '#2563EB', '#16A34A', '#DC2626', '#9333EA', '#C2410C'];

export function RichTextToolsModal({ isOpen, onClose, onApplyTool, onApplyColor }: RichTextToolsModalProps) {
  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div className="rich-tools-modal" role="dialog" aria-modal="true" aria-label="Rich text tools" onClick={(event) => event.stopPropagation()}>
        <div className="modal-title">
          <strong>Text Tools</strong>
          <button type="button" onClick={onClose}><XCircle size={18} /> Close</button>
        </div>

        {toolGroups.map((group) => (
          <section key={group.title} className="rich-tool-group">
            <h3>{group.title}</h3>
            <div className="rich-tool-grid">
              {group.items.map((item) => (
                <button
                  key={item.tool}
                  type="button"
                  onClick={() => {
                    onApplyTool(item.tool);
                    onClose();
                  }}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          </section>
        ))}

        <section className="rich-tool-group">
          <h3><Palette size={16} /> Color</h3>
          <div className="color-swatch-row">
            {colors.map((color) => (
              <button
                key={color}
                type="button"
                title={color}
                aria-label={`Apply color ${color}`}
                style={{ backgroundColor: color }}
                onClick={() => {
                  onApplyColor(color);
                  onClose();
                }}
              />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
