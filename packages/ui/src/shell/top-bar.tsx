import * as React from 'react'
import { cn } from '../lib/cn.js'

export interface TopBarProps {
  /** Sidebar-collapse toggle at >=768, the ☰ drawer trigger at 390 (spec.md §3.2/§3.4). */
  leading?: React.ReactNode
  /** Eyebrow + page name at >=768; the wordmark at 390 (spec.md §4.1). */
  title?: React.ReactNode
  /** The `SearchTrigger`, centred at >=768 (spec.md §3.2), inline at 390. */
  search?: React.ReactNode
  /** QuickAdd, InboxBell, ThemeToggle, LocaleMenu, AvatarMenu, in that order (spec.md §3.2, §4.4). */
  trailing?: React.ReactNode
  className?: string
}

/** design.md §3 TopBar / spec.md §3.1-§3.4: sticky, 56 px, a 1 px `--color-official` bottom hairline
 * -- one of the two touchpoints where the ministry navy is used verbatim (DESIGN.md §2.1).
 *
 * Overhaul polish: the fill is a translucent card colour over a blur, so content scrolling under the
 * bar stays faintly visible instead of vanishing at a hard edge (the Linear/Vercel/Notion treatment
 * -- Jakob's Law). Purely a layout shell otherwise: it renders whatever the caller composes and has
 * no opinion about auth, locale state or routing. */
export function TopBar({ leading, title, search, trailing, className }: TopBarProps) {
  return (
    <header
      className={cn(
        'sticky top-0 z-40 flex h-(--height-topbar) items-center gap-2 border-b border-official/70',
        'bg-card/85 px-3 backdrop-blur-md sm:px-4',
        className,
      )}
    >
      {leading}
      {title ? <div className="min-w-0 flex-none">{title}</div> : null}
      <div className="flex min-w-0 flex-1 justify-center">{search}</div>
      <div className="flex flex-none items-center gap-1 sm:gap-1.5">{trailing}</div>
    </header>
  )
}
