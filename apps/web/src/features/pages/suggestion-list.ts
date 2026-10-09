export type SuggestionLabels = { name: string; empty: string }

let listSequence = 0

/** Slash commands and mentions share caret positioning, selection, and touch behavior. */
export class SuggestionList<Item extends { id: string; label: string }> {
  readonly el: HTMLDivElement
  private items: Item[] = []
  private selectedIndex = 0
  private command: (item: Item) => void
  private anchor: () => DOMRect | null
  private readonly editor: HTMLElement
  private readonly dismiss: () => void

  constructor(
    editor: HTMLElement,
    command: (item: Item) => void,
    anchor: () => DOMRect | null,
    dismiss: () => void,
  ) {
    this.editor = editor
    this.command = command
    this.anchor = anchor
    this.dismiss = dismiss
    this.el = document.createElement('div')
    this.el.id = `page-suggestions-${++listSequence}`
    this.el.setAttribute('role', 'listbox')
    this.el.className =
      'fixed z-50 max-h-72 w-64 max-w-[calc(100vw-1rem)] overflow-auto rounded-md border border-border bg-card p-1 shadow-2'
    document.body.appendChild(this.el)
    editor.setAttribute('aria-controls', this.el.id)
    editor.setAttribute('aria-autocomplete', 'list')
    window.addEventListener('resize', this.position)
    document.addEventListener('scroll', this.position, true)
    document.addEventListener('pointerdown', this.onOutsidePointer)
  }

  private onOutsidePointer = (event: PointerEvent) => {
    if (
      event.target instanceof Node &&
      !this.el.contains(event.target) &&
      !this.editor.contains(event.target)
    )
      this.dismiss()
  }

  update(
    items: Item[],
    command: (item: Item) => void,
    labels: SuggestionLabels,
    anchor: () => DOMRect | null,
  ) {
    this.items = items
    this.command = command
    this.anchor = anchor
    this.selectedIndex = 0
    this.el.setAttribute('aria-label', labels.name)
    this.el.replaceChildren()
    if (items.length === 0) {
      const empty = document.createElement('div')
      empty.setAttribute('role', 'status')
      empty.className = 'px-2 py-2 text-small text-muted-foreground'
      empty.textContent = labels.empty
      this.el.appendChild(empty)
    }
    items.forEach((item, index) => {
      const row = document.createElement('button')
      row.type = 'button'
      row.tabIndex = -1
      row.id = `${this.el.id}-${index}`
      row.setAttribute('role', 'option')
      row.className =
        'block min-h-9 max-md:min-h-11 w-full break-words rounded-sm px-2 py-2 text-left text-small text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
      row.textContent = item.label
      // Keep the document selection while a mouse/touch action activates the command.
      let selectedByTouch = false
      row.addEventListener('pointerdown', (event) => {
        selectedByTouch = false
        event.preventDefault()
      })
      // WebKit suppresses the compatibility click after a cancelled touch pointerdown.
      // A scroll gesture sends pointercancel instead of pointerup, so it does not select.
      row.addEventListener('pointerup', (event) => {
        if (event.pointerType !== 'touch') return
        selectedByTouch = true
        event.preventDefault()
        this.command(item)
      })
      row.addEventListener('click', () => {
        if (!selectedByTouch) this.command(item)
      })
      this.el.appendChild(row)
    })
    this.updateSelection()
    this.position()
  }

  private updateSelection() {
    const rows = [...this.el.querySelectorAll<HTMLElement>('[role="option"]')]
    rows.forEach((row, index) => {
      const selected = index === this.selectedIndex
      row.setAttribute('aria-selected', String(selected))
      row.classList.toggle('bg-accent', selected)
      row.classList.toggle('text-accent-foreground', selected)
    })
    const row = rows[this.selectedIndex]
    if (row) {
      this.editor.setAttribute('aria-activedescendant', row.id)
      if (row.offsetTop < this.el.scrollTop) this.el.scrollTop = row.offsetTop
      else if (row.offsetTop + row.offsetHeight > this.el.scrollTop + this.el.clientHeight)
        this.el.scrollTop = row.offsetTop + row.offsetHeight - this.el.clientHeight
    } else this.editor.removeAttribute('aria-activedescendant')
  }

  moveSelection(delta: number) {
    if (this.items.length === 0) return
    this.selectedIndex = (this.selectedIndex + delta + this.items.length) % this.items.length
    this.updateSelection()
  }

  selectCurrent(): boolean {
    const item = this.items[this.selectedIndex]
    if (!item) return false
    this.command(item)
    return true
  }

  private position = () => {
    const rect = this.anchor()
    if (!rect) return
    const margin = 8
    const availableHeight = Math.max(0, window.innerHeight - margin * 2)
    this.el.style.maxHeight = `${Math.min(288, availableHeight)}px`
    const bounds = this.el.getBoundingClientRect()
    const left = Math.max(margin, Math.min(rect.left, window.innerWidth - bounds.width - margin))
    const below = rect.bottom + 4
    const preferredTop =
      below + bounds.height <= window.innerHeight - margin ? below : rect.top - bounds.height - 4
    const top = Math.max(
      margin,
      Math.min(preferredTop, window.innerHeight - bounds.height - margin),
    )
    this.el.style.left = `${left}px`
    this.el.style.top = `${top}px`
  }

  destroy() {
    window.removeEventListener('resize', this.position)
    document.removeEventListener('scroll', this.position, true)
    document.removeEventListener('pointerdown', this.onOutsidePointer)
    this.editor.removeAttribute('aria-controls')
    this.editor.removeAttribute('aria-autocomplete')
    this.editor.removeAttribute('aria-activedescendant')
    this.el.remove()
  }
}
