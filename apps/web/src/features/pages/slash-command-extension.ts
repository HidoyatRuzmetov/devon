// The block editor's slash menu (UI-OVERHAUL.md §2 "Pages ... block editor with slash menu"): typing
// `/` opens a small command list, the same dependency-free floating-`<div>` pattern
// `mention-suggestion.ts` already uses for `@` (no tippy.js/floating-ui -- a fixed-position list under
// the caret is all either menu needs). Item labels/icons stay in `page-editor.tsx` (an i18n and React
// concern); this file only wires Tiptap's `Suggestion` plugin to whatever list it is given.
import { Extension, type Editor } from '@tiptap/core'
import Suggestion, {
  type SuggestionKeyDownProps,
  type SuggestionOptions,
  type SuggestionProps,
} from '@tiptap/suggestion'
import { PluginKey } from '@tiptap/pm/state'

export type SlashCommandItem = {
  id: string
  label: string
  run: (editor: Editor) => void
}

function filterItems(items: SlashCommandItem[], query: string): SlashCommandItem[] {
  const q = query.trim().toLowerCase()
  if (q.length === 0) return items
  return items.filter((i) => i.label.toLowerCase().includes(q))
}

class SlashList {
  el: HTMLDivElement
  items: SlashCommandItem[] = []
  selectedIndex = 0
  private select: (item: SlashCommandItem) => void

  constructor(select: (item: SlashCommandItem) => void) {
    this.select = select
    this.el = document.createElement('div')
    this.el.setAttribute('role', 'listbox')
    this.el.className =
      'fixed z-50 max-h-72 w-64 overflow-auto rounded-md border border-border bg-card p-1 shadow-2'
  }

  setItems(items: SlashCommandItem[]) {
    this.items = items
    this.selectedIndex = 0
    this.render()
  }

  private render() {
    this.el.innerHTML = ''
    if (this.items.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'px-2 py-1.5 text-small text-muted-foreground'
      empty.textContent = '…'
      this.el.appendChild(empty)
      return
    }
    this.items.forEach((item, index) => {
      const row = document.createElement('button')
      row.type = 'button'
      row.setAttribute('role', 'option')
      row.setAttribute('aria-selected', String(index === this.selectedIndex))
      row.className =
        'block w-full rounded-sm px-2 py-1.5 text-left text-small ' +
        (index === this.selectedIndex
          ? 'bg-accent text-accent-foreground'
          : 'text-foreground hover:bg-accent')
      row.textContent = item.label
      row.addEventListener('mousedown', (e) => {
        e.preventDefault()
        this.select(item)
      })
      this.el.appendChild(row)
    })
  }

  moveSelection(delta: number) {
    if (this.items.length === 0) return
    this.selectedIndex = (this.selectedIndex + delta + this.items.length) % this.items.length
    this.render()
  }

  selectCurrent() {
    const item = this.items[this.selectedIndex]
    if (item) this.select(item)
  }

  positionAt(rect: DOMRect) {
    this.el.style.left = `${rect.left}px`
    this.el.style.top = `${rect.bottom + 4}px`
  }

  mount() {
    document.body.appendChild(this.el)
  }

  destroy() {
    this.el.remove()
  }
}

const slashPluginKey = new PluginKey('slashCommand')

export function createSlashCommandExtension(getItems: () => SlashCommandItem[]) {
  return Extension.create({
    name: 'slashCommand',

    addProseMirrorPlugins() {
      const suggestion: Omit<SuggestionOptions<SlashCommandItem>, 'editor'> = {
        char: '/',
        pluginKey: slashPluginKey,
        // Only open at the start of an empty block ("/" mid-sentence is just a slash) -- Tiptap's own
        // documented guard for this exact case.
        allow: ({ state, range }) => {
          const from = range.from
          const $from = state.doc.resolve(from)
          return $from.parent.type.name !== 'codeBlock' && $from.parentOffset <= 1
        },
        items: ({ query }: { query: string }) => filterItems(getItems(), query),
        command: ({ editor, range, props }) => {
          editor.chain().focus().deleteRange(range).run()
          props.run(editor)
        },
        render: () => {
          let list: SlashList | null = null
          return {
            onStart: (props: SuggestionProps<SlashCommandItem>) => {
              list = new SlashList((item) => props.command(item))
              list.setItems(props.items)
              list.mount()
              const rect = props.clientRect?.()
              if (rect) list.positionAt(rect)
            },
            onUpdate: (props: SuggestionProps<SlashCommandItem>) => {
              list?.setItems(props.items)
              const rect = props.clientRect?.()
              if (rect && list) list.positionAt(rect)
            },
            onKeyDown: (props: SuggestionKeyDownProps) => {
              if (!list) return false
              if (props.event.key === 'ArrowDown') {
                list.moveSelection(1)
                return true
              }
              if (props.event.key === 'ArrowUp') {
                list.moveSelection(-1)
                return true
              }
              if (props.event.key === 'Enter') {
                list.selectCurrent()
                return true
              }
              if (props.event.key === 'Escape') {
                list.destroy()
                list = null
                return true
              }
              return false
            },
            onExit: () => {
              list?.destroy()
              list = null
            },
          }
        },
      }
      return [Suggestion({ editor: this.editor, ...suggestion })]
    },
  })
}
