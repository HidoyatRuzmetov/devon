// The Mini App's bottom tab bar.
//
// `@devon/ui`'s `BottomTabBar` is the web shell's phone fallback and is deliberately `md:hidden` --
// on the web a wide viewport gets the sidebar instead. A Mini App has no sidebar at any width (a
// Telegram sheet on a tablet is still a sheet), so this is the same component with that one rule
// removed, built here as the merge instruction says a shared primitive should be: inside the
// feature, ready to be promoted if a second caller ever wants it.
//
// Everything else is the shell's own convention: five tabs maximum, 44 px targets, an active
// underline that slides between tabs on `--dur-standard`/`--ease-emphasized` (DESIGN.md §10's
// "morphing underline" row) and moves instantly under `prefers-reduced-motion` -- replaced, never
// deleted. The slide is one absolutely-positioned element driven by the active index rather than a
// shared `layoutId`, because `motion` (motion.dev) is `@devon/ui`'s dependency and nothing outside
// that package imports it directly (`packages/ui/src/motion/index.ts`).
//
// Labels are never ellipsized (DESIGN.md §5): each tab carries a deliberately short i18n key, with
// the full name as the accessible name.
import * as React from 'react'
import { cn, useReducedMotion } from '@devon/ui'
import { tg } from '../lib/telegram.js'
import { hrefFor, type Route } from '../lib/router.js'

export type TabEntry = {
  id: string
  route: Route
  label: string
  shortLabel: string
  icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>
  count?: number | null
}

export function TabBar({
  entries,
  activeId,
  label,
}: {
  entries: readonly TabEntry[]
  activeId: string
  label: string
}): React.ReactElement {
  const reduced = useReducedMotion()
  const tabs = entries.slice(0, 5)
  const activeIndex = Math.max(
    0,
    tabs.findIndex((entry) => entry.id === activeId),
  )
  const hasActive = tabs.some((entry) => entry.id === activeId)

  return (
    <nav
      aria-label={label}
      className={cn(
        'fixed inset-x-0 bottom-0 z-40 flex h-(--height-tabbar) items-stretch',
        'border-t border-border bg-card/95 backdrop-blur',
        'pb-[env(safe-area-inset-bottom)]',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute top-0 h-0.5 rounded-full bg-primary',
          reduced ? '' : 'transition-[left] duration-(--dur-standard) ease-(--ease-emphasized)',
          hasActive ? 'opacity-100' : 'opacity-0',
        )}
        style={{
          width: `calc(${100 / tabs.length}% - 2rem)`,
          left: `calc(${(activeIndex * 100) / tabs.length}% + 1rem)`,
        }}
      />
      {tabs.map((entry) => {
        const active = entry.id === activeId
        const Icon = entry.icon
        return (
          <a
            key={entry.id}
            href={hrefFor(entry.route)}
            aria-current={active ? 'page' : undefined}
            aria-label={entry.label}
            onClick={() => tg.haptic.tap()}
            className={cn(
              'relative flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-1',
              // Telegram-native feedback is scale *and* colour on the press itself -- the haptic
              // above only fires on a device that has one, and on every other device the tap had no
              // answer at all until the route changed.
              'transition-[transform,color,background-color] duration-(--dur-micro) ease-out',
              'active:bg-accent active:scale-[0.96] motion-reduce:active:scale-100',
              'focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-inset focus-visible:outline-none',
              active ? 'text-primary' : 'text-muted-foreground',
            )}
          >
            <span className="relative">
              <Icon className="size-5" aria-hidden />
              {entry.count ? (
                <span
                  className={cn(
                    'bg-attention text-foreground absolute -top-1 -right-2 min-w-4 rounded-full px-1',
                    'text-center text-[10px] leading-4 font-semibold',
                  )}
                >
                  {entry.count > 99 ? '99+' : entry.count}
                </span>
              ) : null}
            </span>
            <span className="text-[11px] leading-4 font-medium">{entry.shortLabel}</span>
          </a>
        )
      })}
    </nav>
  )
}
