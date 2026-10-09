import * as React from 'react'
import { Dialog, DialogContent } from '../primitives/dialog.js'
import { Kbd } from '../primitives/kbd.js'

export interface ShortcutEntry {
  keys: string[]
  description: string
  /** Heading this shortcut belongs under, e.g. "Umumiy" / "Oʻtish". Entries with no group fall into
   * a single leading, unlabelled block. */
  group?: string
}

export interface ShortcutOverlayProps {
  title: string
  open: boolean
  onOpenChange: (open: boolean) => void
  shortcuts: readonly ShortcutEntry[]
}

/** spec.md §10.1 / UI-OVERHAUL.md §2 "Shortcuts overlay": Linear's `?` sheet -- a grouped,
 * two-column list. Reached from `?`, from the avatar menu and from the palette's own footer. */
export function ShortcutOverlay({ title, open, onOpenChange, shortcuts }: ShortcutOverlayProps) {
  const groups: Array<{ name: string | null; entries: ShortcutEntry[] }> = []
  for (const shortcut of shortcuts) {
    const name = shortcut.group ?? null
    const bucket = groups.find((g) => g.name === name)
    if (bucket) bucket.entries.push(shortcut)
    else groups.push({ name, entries: [shortcut] })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={title} className="max-w-160">
        <div className="mt-5 grid grid-cols-1 gap-x-10 gap-y-6 sm:grid-cols-2">
          {groups.map((group) => (
            <section key={group.name ?? 'general'} className="flex flex-col gap-2">
              {group.name ? (
                <h3
                  data-shell-label
                  className="text-eyebrow uppercase tracking-(--text-eyebrow--letter-spacing) text-muted-foreground"
                >
                  {group.name}
                </h3>
              ) : null}
              <ul className="flex flex-col gap-2">
                {group.entries.map((shortcut) => (
                  <li
                    key={JSON.stringify([shortcut.keys, shortcut.description])}
                    className="flex min-h-8 items-center justify-between gap-4"
                  >
                    <span data-shell-label className="min-w-0 text-body text-foreground">
                      {shortcut.description}
                    </span>
                    <span className="flex shrink-0 gap-1">
                      {shortcut.keys.map((key) => (
                        <Kbd key={key}>{key}</Kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
