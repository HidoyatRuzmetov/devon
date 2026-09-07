import * as React from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Monitor, Moon, Sun } from 'lucide-react'
import { cn } from '../lib/cn.js'
import { useReducedMotion } from '../lib/use-reduced-motion.js'
import { crossfade, tweenMicro } from '../motion/tokens.js'
import { originOf, useViewTransitionTheme } from '../motion/use-view-transition-theme.js'

export type ThemeToggleValue = 'light' | 'dark' | 'system'

export interface ThemeToggleProps {
  value: ThemeToggleValue
  /** Called inside the View Transition, so the DOM change and the circular reveal are the same
   * frame. Apply the theme here -- do not apply it before calling. */
  onChange: (next: ThemeToggleValue) => void
  /** Accessible name, e.g. `t('shell.theme.label')`. The current mode is announced through
   * `title`/`aria-label` by the caller's own translation of the next state. */
  label: string
  className?: string
}

const ORDER: readonly ThemeToggleValue[] = ['light', 'dark', 'system']
const ICON: Record<ThemeToggleValue, React.ComponentType<React.SVGProps<SVGSVGElement>>> = {
  light: Sun,
  dark: Moon,
  system: Monitor,
}

/** UI-OVERHAUL.md §3 "Theme toggle": icon morph, plus a circular reveal from the button when View
 * Transitions exist.
 *
 * One button cycling light → dark → system, rather than a three-item menu: the theme is the single
 * most-pressed piece of chrome in a product people use all day in an office that goes dark at 17:00,
 * and Jakob's Law says people expect one press to change it (Vercel, Linear, GitHub all do this).
 * The full three-way choice still lives in the avatar menu and the command palette for anyone who
 * wants to pick "system" explicitly. */
export function ThemeToggle({ value, onChange, label, className }: ThemeToggleProps) {
  const reduced = useReducedMotion()
  const startTransition = useViewTransitionTheme()
  const ref = React.useRef<HTMLButtonElement>(null)
  const Icon = ICON[value]

  function cycle(): void {
    const next = ORDER[(ORDER.indexOf(value) + 1) % ORDER.length] ?? 'light'
    startTransition(() => onChange(next), originOf(ref.current))
  }

  return (
    <button
      ref={ref}
      type="button"
      onClick={cycle}
      aria-label={label}
      className={cn(
        'relative inline-flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-sm',
        'text-foreground transition-colors duration-(--dur-micro) ease-out hover:bg-accent',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        className,
      )}
    >
      <AnimatePresence initial={false} mode="wait">
        <motion.span
          key={value}
          className="absolute inset-0 flex items-center justify-center"
          initial={reduced ? { opacity: 0 } : { opacity: 0, rotate: -60, scale: 0.6 }}
          animate={reduced ? { opacity: 1 } : { opacity: 1, rotate: 0, scale: 1 }}
          exit={reduced ? { opacity: 0 } : { opacity: 0, rotate: 60, scale: 0.6 }}
          transition={reduced ? crossfade : tweenMicro}
        >
          <Icon className="size-4.5" aria-hidden="true" />
        </motion.span>
      </AnimatePresence>
    </button>
  )
}
