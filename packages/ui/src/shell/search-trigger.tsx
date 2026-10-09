import * as React from 'react'
import { Search } from 'lucide-react'
import { cn } from '../lib/cn.js'
import { IconButton } from '../primitives/icon-button.js'
import { ModKbd } from '../primitives/kbd.js'

export interface SearchTriggerProps {
  label: string
  compact?: boolean
  onClick: React.MouseEventHandler<HTMLButtonElement>
  className?: string
  ref?: React.Ref<HTMLButtonElement>
}

/** spec.md §4.2, "the single most important control in this epic": a *field-shaped button*, not a
 * bare icon, with the shortcut printed inside it -- read, not guessed (AC-8). Collapses to a 44px
 * icon button below 640px (`compact`); the Kbd hint moves into the overlay footer at that size. */
export function SearchTrigger({
  label,
  compact = false,
  onClick,
  className,
  ref,
}: SearchTriggerProps) {
  if (compact) {
    return (
      <IconButton ref={ref} aria-label={label} size="touch" onClick={onClick} className={className}>
        <Search aria-hidden="true" />
      </IconButton>
    )
  }
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      className={cn(
        'flex h-9 w-full min-w-0 max-w-105 items-center gap-2 rounded-sm border border-border bg-muted/60 px-3',
        'text-small text-muted-foreground',
        'transition-colors duration-(--dur-micro) ease-out hover:bg-accent',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        className,
      )}
    >
      <Search className="size-4 shrink-0" aria-hidden="true" />
      {/* One line, always: the trigger sits in a 56px bar between the quick-add and the bell, and a
          wrapped label would push both out of the row. It is not truncated (the shell forbids
          that) -- the whole button shrinks instead, and below 640px the caller passes `compact` and
          gets the icon-only form. */}
      <span data-shell-label className="min-w-0 flex-1 whitespace-nowrap text-left">
        {label}
      </span>
      <ModKbd letter="K" className="shrink-0" />
    </button>
  )
}
