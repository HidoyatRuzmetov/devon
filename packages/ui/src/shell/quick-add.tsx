import * as React from 'react'
import { Plus } from 'lucide-react'
import { cn } from '../lib/cn.js'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../primitives/dropdown-menu.js'
import { Kbd } from '../primitives/kbd.js'

export interface QuickAddAction {
  id: string
  label: string
  icon?: React.ComponentType<React.SVGProps<SVGSVGElement>>
  /** Rendered right-aligned as a keycap, e.g. `C`. */
  shortcut?: string
  onSelect: () => void
}

export interface QuickAddProps {
  actions: readonly QuickAddAction[]
  /** Accessible name for the trigger, e.g. `t('shell.quickAdd.aria')`. */
  label: string
  /** Visible label at >=768; the button collapses to the `+` icon below that. */
  shortLabel?: string
  compact?: boolean
  className?: string
}

/** UI-OVERHAUL.md §2 row 1: "top bar with quick-add, search/⌘K, inbox bell with badge, avatar menu
 * top-right". The quick-add is the product's one always-available "make something" affordance --
 * Linear's `+`, Notion's "New", Google Workspace's "Create".
 *
 * It renders nothing when a session has no creatable things (a brand-new account with no
 * department): an affordance whose menu would be empty is dead chrome, which design.md §1.1 refuses. */
export function QuickAdd({
  actions,
  label,
  shortLabel,
  compact = false,
  className,
}: QuickAddProps): React.JSX.Element | null {
  if (actions.length === 0) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={label}
        className={cn(
          'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-sm bg-primary',
          'font-medium text-primary-foreground transition-[colors,transform] duration-(--dur-micro) ease-out',
          'hover:opacity-90 active:scale-[0.98]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          compact || !shortLabel ? 'size-9' : 'h-9 px-3 text-small',
          className,
        )}
      >
        <Plus className="size-4 shrink-0" aria-hidden="true" />
        {compact || !shortLabel ? null : <span data-shell-label>{shortLabel}</span>}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-60">
        {actions.map((action) => (
          <DropdownMenuItem key={action.id} onSelect={action.onSelect}>
            {action.icon ? <action.icon className="size-4" aria-hidden="true" /> : null}
            <span data-shell-label className="min-w-0 flex-1">
              {action.label}
            </span>
            {action.shortcut ? <Kbd>{action.shortcut}</Kbd> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
