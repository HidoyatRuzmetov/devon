import { Dialog, DialogContent } from '../primitives/dialog.js'
import { Kbd } from '../primitives/kbd.js'

export interface ShortcutEntry {
  keys: string[]
  description: string
}

export interface ShortcutOverlayProps {
  title: string
  open: boolean
  onOpenChange: (open: boolean) => void
  shortcuts: readonly ShortcutEntry[]
}

/** spec.md §10.1: five shortcuts, no more; every one has a mouse equivalent; this overlay is their
 * discovery path (`?`, from the avatar menu and the search overlay footer). */
export function ShortcutOverlay({ title, open, onOpenChange, shortcuts }: ShortcutOverlayProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={title} className="max-w-105">
        <ul className="mt-4 flex flex-col gap-3">
          {shortcuts.map((shortcut) => (
            <li key={shortcut.description} className="flex items-center justify-between gap-4">
              <span data-shell-label className="text-body text-foreground">
                {shortcut.description}
              </span>
              <span className="flex gap-1">
                {shortcut.keys.map((key) => (
                  <Kbd key={key}>{key}</Kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  )
}
