import { useEffect, useRef } from 'react'
import { navigate } from '../lib/router.js'

export interface ShellShortcutHandlers {
  onOpenPalette: () => void
  onOpenShortcuts: () => void
  /** `Ctrl/⌘+B` -- the collapse toggle every product with a collapsible sidebar binds to this key
   * (VS Code, Linear, shadcn's own Sidebar). Jakob's Law: it is the one shortcut people arrive
   * already knowing. */
  onToggleSidebar?: () => void
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT'
}

/** design.md §10.1: a small, fixed set of shortcuts, every one with a mouse equivalent, all of them
 * listed in the `?` overlay. `Ctrl/⌘+K` and `Ctrl/⌘+B` work even while typing elsewhere (they are how
 * a user escapes into search, and how they reclaim screen width); the rest yield to normal typing. */
export function useShellShortcuts({
  onOpenPalette,
  onOpenShortcuts,
  onToggleSidebar,
}: ShellShortcutHandlers): void {
  const lastGAt = useRef(0)

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        onOpenPalette()
        return
      }
      if (mod && e.key.toLowerCase() === 'b' && onToggleSidebar) {
        e.preventDefault()
        onToggleSidebar()
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
      // `g` then a destination letter, within 900 ms -- Linear's "go to" chord, and the only
      // multi-key sequence in the product.
      const chordIsLive = Date.now() - lastGAt.current < 900
      if (!chordIsLive) return
      if (e.key.toLowerCase() === 'h') {
        e.preventDefault()
        navigate('/')
        return
      }
      if (e.key.toLowerCase() === 'i') {
        e.preventDefault()
        navigate('/inbox')
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onOpenPalette, onOpenShortcuts, onToggleSidebar])
}
