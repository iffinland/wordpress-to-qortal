import { Node, mergeAttributes } from '@tiptap/react';
import { attributesFromMeta, metaFromElement, normalizeAttachmentMeta } from '../../../lib/attachments.js';

declare module '@tiptap/react' {
  interface Commands<ReturnType> {
    attachment: {
      insertAttachment: (meta: Record<string, unknown>) => ReturnType;
    };
  }
}

/**
 * Attachment block. Serialised as
 * <div class="qms-attachment" data-qms-attachment="1" data-...>Title</div>;
 * the viewer hydrates it into a player or download card. All values are plain
 * text attributes validated by normalizeAttachmentMeta.
 */
export const AttachmentNode = Node.create({
  name: 'attachment',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    const keys = ['kind', 'service', 'name', 'identifier', 'filename', 'title', 'mime', 'size', 'sha256', 'poster'];
    return Object.fromEntries(keys.map((key) => [key, { default: key === 'size' ? 0 : '' }]));
  },
  parseHTML() {
    return [{
      tag: 'div[data-qms-attachment]',
      getAttrs: (element) => {
        const meta = metaFromElement(element as HTMLElement);
        return meta || false;
      }
    }];
  },
  renderHTML({ node }) {
    const meta = normalizeAttachmentMeta(node.attrs);
    if (!meta) return ['div', { class: 'qms-attachment' }, ''];
    return ['div', mergeAttributes({ class: 'qms-attachment ' + 'qms-attachment--' + meta.kind }, attributesFromMeta(meta)), meta.title];
  },
  addCommands() {
    return {
      insertAttachment: (meta) => ({ commands }) => {
        const clean = normalizeAttachmentMeta(meta);
        return clean ? commands.insertContent({ type: this.name, attrs: clean }) : false;
      }
    };
  }
});
