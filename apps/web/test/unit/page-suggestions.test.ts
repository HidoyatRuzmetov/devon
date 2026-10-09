import { afterEach, describe, expect, it, vi } from 'vitest'
import { SuggestionList } from '../../src/features/pages/suggestion-list.js'

let list: SuggestionList<{ id: string; label: string }> | undefined
afterEach(() => {
  list?.destroy()
  document.body.replaceChildren()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
function setup() {
  const editor = document.createElement('div')
  document.body.appendChild(editor)
  const command = vi.fn()
  const dismiss = vi.fn()
  const anchor = () => new DOMRect(310, 400, 0, 20)
  list = new SuggestionList(editor, command, anchor, dismiss)
  return { editor, command, dismiss, anchor, popup: list }
}
describe('page suggestion controls', () => {
  it('uses the latest filtered command, supports click, and announces keyboard selection', () => {
    const { editor, popup, anchor, command } = setup()
    popup.update(
      [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
      ],
      command,
      { name: 'Commands', empty: 'No options' },
      anchor,
    )
    popup.moveSelection(-1)
    expect(editor.getAttribute('aria-activedescendant')).toBe(`${popup.el.id}-1`)
    expect(popup.el.querySelector('[aria-selected="true"]')).toHaveTextContent('B')
    const latest = vi.fn()
    popup.update(
      [{ id: 'filtered', label: 'Filtered' }],
      latest,
      { name: 'Commands', empty: 'No options' },
      anchor,
    )
    popup.el.querySelector('button')!.click()
    expect(latest).toHaveBeenCalledExactlyOnceWith({ id: 'filtered', label: 'Filtered' })
    expect(command).not.toHaveBeenCalled()
  })
  it('bounds the popup within a narrow short viewport and flips above the caret', () => {
    vi.stubGlobal('innerWidth', 320)
    vi.stubGlobal('innerHeight', 480)
    const { popup, anchor, command } = setup()
    vi.spyOn(popup.el, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 256, 180))
    popup.update(
      [{ id: 'a', label: 'A' }],
      command,
      { name: 'Commands', empty: 'No options' },
      anchor,
    )
    expect(popup.el.style.left).toBe('56px')
    expect(popup.el.style.top).toBe('216px')
  })
  it('selects once on touch release even when the compatibility click is suppressed', () => {
    const { popup, anchor, command } = setup()
    popup.update(
      [{ id: 'touch', label: 'Touch' }],
      command,
      { name: 'Commands', empty: 'No options' },
      anchor,
    )
    const row = popup.el.querySelector('button')!
    const pointer = (name: string) => {
      const event = new Event(name, { bubbles: true, cancelable: true })
      Object.defineProperty(event, 'pointerType', { value: 'touch' })
      return event
    }
    row.dispatchEvent(pointer('pointerdown'))
    expect(command).not.toHaveBeenCalled()
    row.dispatchEvent(pointer('pointerup'))
    expect(command).toHaveBeenCalledExactlyOnceWith({ id: 'touch', label: 'Touch' })
    row.click()
    expect(command).toHaveBeenCalledOnce()
  })
  it('keeps empty results readable without swallowing Enter and cleans editor ARIA on exit', () => {
    const { editor, popup, anchor, command, dismiss } = setup()
    popup.update([], command, { name: 'Mentions', empty: 'No matching colleagues' }, anchor)
    expect(popup.el.querySelector('[role="status"]')).toHaveTextContent('No matching colleagues')
    expect(popup.selectCurrent()).toBe(false)
    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    expect(dismiss).toHaveBeenCalledOnce()
    popup.destroy()
    expect(editor).not.toHaveAttribute('aria-controls')
    expect(editor).not.toHaveAttribute('aria-activedescendant')
  })
})
