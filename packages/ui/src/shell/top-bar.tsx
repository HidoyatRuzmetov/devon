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

/** design.md §3 TopBar / spec.md §3.1-§3.4: sticky, at least 56 px, with a 1 px official hairline
 * -- one of the two touchpoints where the ministry navy is used verbatim (DESIGN.md §2.1).
 *
 * The opaque card fill keeps controls readable when enlarged page text scrolls behind the bar,
 * including browsers that do not blur the backdrop. The caller supplies auth, locale and routing. */
export function TopBar({ leading, title, search, trailing, className }: TopBarProps) {
  return (
    <header
      className={cn(
        'sticky top-0 z-40 flex min-h-(--height-topbar) flex-wrap items-center gap-1 border-b border-official/70 sm:gap-2',
        'bg-card px-2 py-1.5 sm:px-4',
        className,
      )}
    >
      {leading}
      {title ? <div className="min-w-0 flex-none">{title}</div> : null}
      <div className="flex min-w-9 flex-1 justify-center">{search}</div>
      <div className="flex max-w-full flex-none flex-wrap items-center justify-end gap-1 sm:gap-1.5">
        {trailing}
      </div>
    </header>
  )
}
