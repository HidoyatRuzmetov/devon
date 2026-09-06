import * as React from 'react'
import { cn } from '../lib/cn.js'

export interface TopBarProps {
  /** Sidebar-collapse toggle at >=1024, the ☰ drawer trigger at 390 (spec.md §3.2/§3.4). */
  leading?: React.ReactNode
  /** Eyebrow + page name at >=1024; the wordmark at 390 (spec.md §4.1). */
  title?: React.ReactNode
  /** The `SearchTrigger`, centred at >=1024 (spec.md §3.2), inline at 390. */
  search?: React.ReactNode
  /** `DemoChip`, `LocaleMenu`, `AvatarMenu`, in that order (spec.md §3.2, §4.4). */
  trailing?: React.ReactNode
  className?: string
}

/** design.md §3 TopBar / spec.md §3.1-§3.4: sticky, 56px, `--color-card` fill, a 1px
 * `--color-official` bottom hairline -- one of the two touchpoints where the ministry navy is used
 * verbatim (DESIGN.md §2.1). Purely a layout shell: it renders whatever the caller composes from
 * `SearchTrigger` / `DemoChip` / `LocaleMenu` / `AvatarMenu` / `Sidebar`'s collapse `IconButton` --
 * it has no opinion about auth, locale state or routing. */
export function TopBar({ leading, title, search, trailing, className }: TopBarProps) {
  return (
    <header
      className={cn(
        'sticky top-0 z-40 flex h-(--height-topbar) items-center gap-3 border-b border-official bg-card px-4',
        className,
      )}
    >
      {leading}
      <div className="min-w-0 flex-none">{title}</div>
      <div className="flex min-w-0 flex-1 justify-center">{search}</div>
      <div className="flex flex-none items-center gap-2">{trailing}</div>
    </header>
  )
}
