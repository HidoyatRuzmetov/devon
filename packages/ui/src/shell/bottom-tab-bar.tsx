import * as React from 'react'
import { motion } from 'motion/react'
import { useT } from '@devon/i18n'
import { cn } from '../lib/cn.js'
import { useReducedMotion } from '../lib/use-reduced-motion.js'
import { springSettle } from '../motion/tokens.js'
import type { NavEntry } from './nav-registry.js'

export interface BottomTabBarProps {
  /** At most five -- past that a tab bar becomes unreadable at 390 px and every mobile product
   * (iOS, Android, Slack, Gmail) stops at five for the same reason. Extra entries are ignored
   * rather than squeezed; the sheet menu behind the ☰ has the full list. */
  entries: readonly NavEntry[]
  activeRoute: string
  linkAs?: React.ElementType
  counts?: Readonly<Record<string, number | null | undefined>>
  /** Accessible name for the landmark, e.g. `t('shell.nav.aria')`. */
  label: string
  className?: string
}

const MAX_TABS = 5

/** UI-OVERHAUL.md §2 / the 390 px requirement: "sidebar becomes a Vaul sheet, bottom tab bar for the
 * five most used areas". Fixed to the bottom edge, safe-area aware, 60 px tall with 44 px targets --
 * the shape a civil servant already knows from every app on their phone. */
export function BottomTabBar({
  entries,
  activeRoute,
  linkAs: Link = 'a',
  counts,
  label,
  className,
}: BottomTabBarProps) {
  const t = useT()
  const reduced = useReducedMotion()
  const tabs = entries.slice(0, MAX_TABS)

  return (
    <nav
      aria-label={label}
      className={cn(
        'fixed inset-x-0 bottom-0 z-40 flex h-(--height-tabbar) items-stretch border-t border-border',
        'bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden',
        className,
      )}
    >
      {tabs.map((entry) => {
        const active = entry.route === activeRoute
        const Icon = entry.icon
        const count = counts?.[entry.id] ?? null
        return (
          <Link
            key={entry.id}
            href={entry.route}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'relative flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-1',
              'transition-colors duration-(--dur-micro) ease-out',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
              active ? 'text-primary' : 'text-muted-foreground',
            )}
          >
            {active ? (
              reduced ? (
                <span
                  aria-hidden="true"
                  className="absolute inset-x-4 top-0 h-0.5 rounded-full bg-primary"
                />
              ) : (
                <motion.span
                  layoutId="devon-tabbar-active"
                  aria-hidden="true"
                  className="absolute inset-x-4 top-0 h-0.5 rounded-full bg-primary"
                  transition={springSettle}
                />
              )
            ) : null}
            <span className="relative">
              <Icon className="size-5" aria-hidden="true" />
              {count && count > 0 ? (
                <span
                  aria-hidden="true"
                  className="absolute -right-1.5 -top-1 size-2 rounded-full bg-attention"
                />
              ) : null}
            </span>
            <span data-shell-label className="min-w-0 text-center text-caption leading-tight">
              {t(entry.labelKey)}
            </span>
          </Link>
        )
      })}
    </nav>
  )
}
