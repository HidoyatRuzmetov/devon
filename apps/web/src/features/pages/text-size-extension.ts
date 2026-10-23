import { Mark } from '@tiptap/core'

/** Bounded typography presets: no arbitrary CSS is accepted or emitted from stored documents. */
const sizes: Record<string, string> = {
  small: '14px',
  normal: '16px',
  large: '20px',
  xlarge: '24px',
}
export const TextSize = Mark.create({
  name: 'textSize',
  addAttributes() {
    return {
      size: { default: 'normal', parseHTML: (element) => element.getAttribute('data-text-size') },
    }
  },
  parseHTML() {
    return [{ tag: 'span[data-text-size]' }]
  },
  renderHTML({ mark }) {
    const size = String(mark.attrs['size'])
    return [
      'span',
      { 'data-text-size': size, style: `font-size:${sizes[size] ?? sizes['normal']}` },
      0,
    ]
  },
})
