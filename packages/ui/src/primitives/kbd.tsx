import * as React from 'react'
import { cn } from '../lib/cn.js'
import { modKeyLabel } from '../lib/platform.js'

export interface KbdProps extends React.HTMLAttributes<HTMLElement> {
  keys?: string[]
}

/** DESIGN.md §4.2: the search trigger's shortcut hint, platform-detected. `--font-mono` per
 * DESIGN.md §2.3 ("the request id and the setup token") -- a keycap reads as a literal key, so mono
 * is right here too. */
export const Kbd = React.forwardRef<HTMLElement, KbdProps>(
  ({ className, keys, children, ...props }, ref) => (
    <kbd
      ref={ref}
      className={cn(
        'inline-flex items-center gap-0.5 rounded-sm border border-border bg-muted px-1.5 py-0.5',
        'font-mono text-caption text-muted-foreground',
        className,
      )}
      {...props}
    >
      {children ?? keys?.join(' ')}
    </kbd>
  ),
)
Kbd.displayName = 'Kbd'

/** The specific "open search" hint used by the TopBar search trigger and the ShortcutOverlay --
 * `Ctrl K` on Windows/Linux, `⌘ K` on macOS, never both (spec.md §4.2). */
export function ModKbd({ letter, className }: { letter: string; className?: string }) {
  const [mod, setMod] = React.useState('Ctrl')
  React.useEffect(() => setMod(modKeyLabel()), [])
  return <Kbd className={className}>{`${mod} ${letter}`}</Kbd>
}
