import * as React from 'react'
import { cn } from '../lib/cn.js'

export interface ReadOnlyStripProps {
  children: React.ReactNode
  /** A small glyph for the strip, already sized by the caller. Decorative -- the sentence carries
   * the meaning, the icon only helps the eye find it. */
  icon?: React.ReactNode
  className?: string
}

/**
 * v1.1 critique SEV2 #17 -- "four different shapes of no-permission remain".
 *
 * Most head-only screens now answer a member with the full `StateView kind="forbidden"` treatment:
 * what the page is, who to ask, and exactly one alternative action. Two screens are deliberate
 * exceptions, because showing a member their *own* data is better than showing them a locked door:
 *
 *   * `/work/workload` renders the member's own row instead of the department grid;
 *   * `/department` renders the department's own settings with every control read-only.
 *
 * Those two still have to say why what they are looking at is narrower than what the page is for --
 * and before this they each said it in their own hand-rolled markup. This is that one sentence's one
 * shape: a quiet bordered strip, `role="status"` so a screen reader picks it up when it appears, and
 * no colour signal at all. It is not a warning; nothing is wrong.
 */
export function ReadOnlyStrip({
  children,
  icon,
  className,
}: ReadOnlyStripProps): React.JSX.Element {
  return (
    <p
      role="status"
      className={cn(
        'flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2',
        'text-small text-muted-foreground',
        className,
      )}
    >
      {icon}
      <span className="min-w-0">{children}</span>
    </p>
  )
}
