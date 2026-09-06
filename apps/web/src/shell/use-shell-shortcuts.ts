import { useEffect, useRef } from 'react'
import { navigate } from '../lib/router.js'

export interface ShellShortcutHandlers {
  onOpenPalette: () => void
  onOpenShortcuts: () => void
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT'
}

/** design.md §10.1: five shortcuts, no more, every one with a mouse equivalent. `Ctrl/⌘+K` works even
 * while typing elsewhere (it is how a user escapes into search); the rest yield to normal typing. */
export function useShellShortcuts({ onOpenPalette, onOpenShortcuts }: ShellShortcutHandlers): void {
  const lastGAt = useRef(0)

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        onOpenPalette()
        return
      }
      if (isTypingTarget(e.target) || mod || e.altKey) return

      if (e.key === '/') {
        e.preventDefault()
        onOpenPalette()
        return
      }
      if (e.key === '?') {
        e.preventDefault()
        onOpenShortcuts()
        return
      }
      if (e.key.toLowerCase() === 'g') {
        lastGAt.current = Date.now()
        return
      }
      if (e.key.toLowerCase() === 'h' && Date.now() - lastGAt.current < 900) {
        e.preventDefault()
        navigate('/')
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onOpenPalette, onOpenShortcuts])
}
