import { cn } from '../lib/cn.js'
import { Popover, PopoverContent, PopoverTrigger } from '../primitives/popover.js'

export interface DemoChipProps {
  label: string
  popoverText: string
  className?: string
}

/** spec.md §4.4 (AC-1, AC-2): rendered only when the caller decides to render it -- from the server
 * bootstrap payload's `isDemo` flag, never a client-readable env var (that decision is made by the
 * caller in `apps/web`; this component has no opinion about *whether* to mount, only how it looks
 * once mounted). A focusable button, not a silent badge -- a screen reader must be able to reach the
 * one screen whose whole job is "this data is not real". */
export function DemoChip({ label, popoverText, className }: DemoChipProps) {
  return (
    <Popover>
      <PopoverTrigger
        className={cn(
          'inline-flex h-6 min-h-6 items-center rounded-sm bg-attention px-2 text-caption font-medium text-attention-foreground',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          className,
        )}
      >
        <span data-shell-label>{label}</span>
      </PopoverTrigger>
      <PopoverContent className="max-w-70 text-small" align="end">
        {popoverText}
      </PopoverContent>
    </Popover>
  )
}
