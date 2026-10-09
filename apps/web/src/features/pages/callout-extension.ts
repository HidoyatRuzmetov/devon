// A custom Tiptap node for "callouts" (TECH-SPEC §5: "Tiptap 3.31 with mentions, checklist items,
// callouts, links with unfurled titles") -- Tiptap ships no callout node itself, so this is a small,
// self-contained block node: `<div data-callout data-variant="info">...</div>`, one paragraph of
// content, toggled from the toolbar. Variant only changes the accent colour token used to render it
// (`packages/ui`'s `--color-info`/`--color-warning`/`--color-attention`), never a raw hex.
import { mergeAttributes, Node } from '@tiptap/core'

export type CalloutVariant = 'info' | 'warning' | 'attention'

export interface CalloutOptions {
  HTMLAttributes: Record<string, unknown>
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    callout: {
      setCallout: (variant?: CalloutVariant) => ReturnType
      toggleCallout: (variant?: CalloutVariant) => ReturnType
    }
  }
}

export const Callout = Node.create<CalloutOptions>({
  name: 'callout',
  group: 'block',
  content: 'paragraph+',
  defining: true,
  isolating: true,

  addOptions() {
    return { HTMLAttributes: {} }
  },

  addAttributes() {
    return {
      variant: {
        default: 'info' as CalloutVariant,
        parseHTML: (element) => element.getAttribute('data-variant') ?? 'info',
        renderHTML: (attributes) => ({ 'data-variant': attributes['variant'] as string }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-callout]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, { 'data-callout': '' }),
      0,
    ]
  },

  addCommands() {
    return {
      setCallout:
        (variant: CalloutVariant = 'info') =>
        ({ commands }) =>
          commands.wrapIn(this.name, { variant }),
      toggleCallout:
        (variant: CalloutVariant = 'info') =>
        ({ commands, state, tr, dispatch }) => {
          const range = state.selection.$from.blockRange(
            state.selection.$to,
            (node) => node.type.name === this.name,
          )
          if (!range) return commands.wrapIn(this.name, { variant })
          // Isolation protects the callout from accidental boundary edits, but also stops the
          // standard toggleWrap lift. An explicit toolbar action may lift its paragraphs out.
          if (dispatch) tr.lift(range, range.depth - 1)
          return true
        },
    }
  },
})
