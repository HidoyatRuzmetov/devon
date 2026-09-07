// A minimal, dependency-free suggestion renderer for `@tiptap/extension-mention` (no tippy.js/
// floating-ui -- this app's dependency budget stays small, and a fixed-position list under the
// caret is all "mention a department member" needs). Mirrors Tiptap's own documented non-React
// suggestion-render pattern: a plain object with `onStart`/`onUpdate`/`onKeyDown`/`onExit`, each
// managing one floating `<div>` appended to `document.body`.
import type { SuggestionOptions, SuggestionProps, SuggestionKeyDownProps } from '@tiptap/suggestion'

export type MentionCandidate = { id: string; label: string }

function filterCandidates(candidates: MentionCandidate[], query: string): MentionCandidate[] {
  const q = query.trim().toLowerCase()
  if (q.length === 0) return candidates.slice(0, 8)
  return candidates.filter((c) => c.label.toLowerCase().includes(q)).slice(0, 8)
}

class MentionList {
  el: HTMLDivElement
  items: MentionCandidate[] = []
  selectedIndex = 0
  private command: (item: MentionCandidate) => void

  constructor(command: (item: MentionCandidate) => void) {
    this.command = command
    this.el = document.createElement('div')
    this.el.setAttribute('role', 'listbox')
    this.el.className =
      'fixed z-50 max-h-56 w-56 overflow-auto rounded-md border border-border bg-card p-1 shadow-2'
  }

  setItems(items: MentionCandidate[]) {
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
        this.command(item)
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
    if (item) this.command(item)
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

export function createMentionSuggestion(
  getCandidates: () => MentionCandidate[],
): Omit<SuggestionOptions<MentionCandidate>, 'editor'> {
  return {
    char: '@',
    items: ({ query }: { query: string }) => filterCandidates(getCandidates(), query),
    render: () => {
      let list: MentionList | null = null

      return {
        onStart: (props: SuggestionProps<MentionCandidate>) => {
          list = new MentionList((item) => props.command({ id: item.id, label: item.label }))
          list.setItems(props.items)
          list.mount()
          const rect = props.clientRect?.()
          if (rect) list.positionAt(rect)
        },
        onUpdate: (props: SuggestionProps<MentionCandidate>) => {
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
}
