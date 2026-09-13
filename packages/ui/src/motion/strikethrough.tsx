import * as React from 'react'
import { cn } from '../lib/cn.js'

export interface StrikethroughProps {
  done: boolean
  children: React.ReactNode
  className?: string
  as?: 'span' | 'p' | 'div'
}

/** The third beat of "task done", after the check draws and the burst fires: the label rules itself
 * through. Without it the checkbox celebrates and the text it belongs to does not change at all,
 * which is how a finished to-do ends up looking exactly like an unfinished one.
 *
 * Implemented as a `text-decoration-color` transition from transparent to the current colour rather
 * than a wiping overlay, for one reason that matters more than the wipe would look nicer: **it
 * wraps.** A checklist item in Uzbek routinely runs to two lines, and an absolutely-positioned rule
 * can only ever strike the first of them. The decoration is painted by the text itself, so every
 * line gets struck, at any width, in any locale. It also costs no layout — the line is already
 * reserved whether it is visible or not, so nothing reflows when a row completes.
 *
 * The colour fade to `--color-muted-foreground` rides along on the same duration, so "done" reads
 * as one gesture rather than two.
 *
 * Reduced motion: the global backstop in `tokens.css` collapses both transitions to an instant
 * change. The strike and the dimming still happen — they simply arrive rather than draw. */
export function Strikethrough({
  done,
  children,
  className,
  as: Comp = 'span',
}: StrikethroughProps): React.JSX.Element {
  return (
    <Comp
      className={cn(
        'line-through decoration-2 transition-[color,text-decoration-color]',
        'duration-(--dur-standard) ease-(--ease-standard)',
        done ? 'text-muted-foreground decoration-current' : 'decoration-transparent',
        className,
      )}
    >
      {children}
    </Comp>
  )
}
