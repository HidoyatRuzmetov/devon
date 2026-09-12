// A segmented control: two or three mutually exclusive views of the same data, shown side by side so
// both options are readable before either is chosen.
//
// Why this and not `Tabs`: `Tabs` is the *page's* navigation (underlined, on a border, one per
// screen). A segmented control is a control inside a toolbar -- "Hammasi | Mening" on the board
// (SPEC §3.3), "Hafta | Oy" on a chart -- and Jakob's Law puts it in a filled pill, the shape every
// desktop and mobile OS has used for this since the 1990s. Shipping it as a primitive rather than
// per screen because v1.1 puts the same control on the board, the table, the timeline and the
// calendar, and three hand-rolled versions would drift within a week.
//
// Keyboard: a real radiogroup. Arrow keys move between options and select as they go (the standard
// radio-group behaviour a screen-reader user expects), Tab enters and leaves the group as one stop.
import * as React from 'react'
import { motion, LayoutGroup } from 'motion/react'
import { cn } from '../lib/cn.js'
import { useReducedMotion } from '../lib/use-reduced-motion.js'

export type SegmentedOption<T extends string> = {
  value: T
  label: string
  /** Small trailing count, the way Linear labels a view. */
  count?: number
  /** Optional longer text for the accessible name when `label` is an abbreviation. */
  description?: string
}

export interface SegmentedControlProps<T extends string> {
  value: T
  onValueChange: (value: T) => void
  options: readonly SegmentedOption<T>[]
  /** The group's accessible name -- what this control is choosing between. */
  label: string
  size?: 'sm' | 'md'
  className?: string
}

export function SegmentedControl<T extends string>({
  value,
  onValueChange,
  options,
  label,
  size = 'md',
  className,
}: SegmentedControlProps<T>): React.JSX.Element {
  const groupId = React.useId()
  const reduced = useReducedMotion()
  const refs = React.useRef(new Map<string, HTMLButtonElement | null>())

  function move(delta: number): void {
    const index = options.findIndex((o) => o.value === value)
    if (index === -1) return
    const next = options[(index + delta + options.length) % options.length]
    if (!next) return
    onValueChange(next.value)
    // Selection follows focus, which is what a radio group does -- so focus has to follow too.
    requestAnimationFrame(() => refs.current.get(next.value)?.focus())
  }

  return (
    <LayoutGroup id={groupId}>
      <div
        role="radiogroup"
        aria-label={label}
        className={cn(
          'inline-flex items-center gap-0.5 rounded-md border border-border bg-muted p-0.5',
          className,
        )}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
            e.preventDefault()
            move(1)
          } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
            e.preventDefault()
            move(-1)
          }
        }}
      >
        {options.map((option) => {
          const selected = option.value === value
          return (
            <button
              key={option.value}
              ref={(el) => {
                refs.current.set(option.value, el)
              }}
              type="button"
              role="radio"
              aria-checked={selected}
              // Only the selected option is in the tab order: the group is one stop, arrows move
              // inside it.
              tabIndex={selected ? 0 : -1}
              title={option.description}
              onClick={() => onValueChange(option.value)}
              className={cn(
                'relative rounded-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
                size === 'sm' ? 'px-2 py-0.5 text-caption' : 'px-3 py-1 text-small',
                selected ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {selected ? (
                <motion.span
                  layoutId="segmented-thumb"
                  className="absolute inset-0 rounded-sm bg-card shadow-1"
                  transition={
                    reduced ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 34 }
                  }
                  aria-hidden="true"
                />
              ) : null}
              <span className="relative flex items-center gap-1.5 whitespace-nowrap">
                {option.label}
                {option.count === undefined ? null : (
                  <span
                    className={cn(
                      'tabular-nums',
                      selected ? 'text-muted-foreground' : 'text-muted-foreground/80',
                    )}
                  >
                    {option.count}
                  </span>
                )}
              </span>
            </button>
          )
        })}
      </div>
    </LayoutGroup>
  )
}
