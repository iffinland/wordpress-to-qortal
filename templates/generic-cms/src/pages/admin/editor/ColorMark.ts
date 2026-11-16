import { Mark, mergeAttributes } from '@tiptap/react';
import { colorClass, colorFromClass, isTextColor } from '../../../lib/textColors.js';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    textColor: {
      setTextColor: (key: string) => ReturnType;
      unsetTextColor: () => ReturnType;
    };
  }
}

/** Text colour as a class-based mark: <span class="qms-color qms-color-red">. No inline styles. */
export const ColorMark = Mark.create({
  name: 'textColor',
  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: (element) => colorFromClass(element.getAttribute('class')),
        renderHTML: () => ({})
      }
    };
  },
  parseHTML() {
    return [{
      tag: 'span',
      getAttrs: (element) => (colorFromClass((element as HTMLElement).getAttribute('class')) ? null : false)
    }];
  },
  renderHTML({ mark, HTMLAttributes }) {
    const key = mark.attrs.color;
    return ['span', mergeAttributes(HTMLAttributes, { class: isTextColor(key) ? colorClass(key) : 'qms-color' }), 0];
  },
  addCommands() {
    return {
      setTextColor: (key: string) => ({ commands }) => (isTextColor(key) ? commands.setMark(this.name, { color: key }) : false),
      unsetTextColor: () => ({ commands }) => commands.unsetMark(this.name)
    };
  }
});
