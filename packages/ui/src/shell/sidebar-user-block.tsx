import * as React from 'react'
import { ChevronsUpDown } from 'lucide-react'
import { cn } from '../lib/cn.js'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../primitives/dropdown-menu.js'

export interface UserBlockAction {
  id: string
  label: string
  icon?: React.ComponentType<React.SVGProps<SVGSVGElement>>
  onSelect: () => void
  /** Renders above a separator, at the foot of the menu. */
  danger?: boolean
}

export interface SidebarUserBlockProps {
  /** The composed `<Avatar>` -- a slot, so this component never has to know about avatar URLs. */
  avatar: React.ReactNode
  name: string
  /** Second line: the job title, or the login. */
  secondary?: string
  actions: readonly UserBlockAction[]
  /** Accessible name for the trigger, e.g. `t('shell.account.aria')`. */
  label: string
  collapsed?: boolean
  className?: string
}

/** UI-OVERHAUL.md §2 row 1: "bottom user block". Linear, Huly, Vercel and Supabase all put the
 * signed-in identity at the *foot* of the sidebar, not only in the top-right corner -- so a user can
 * always see which account they are acting as without opening anything. Devon keeps the top-right
 * avatar menu too (Jakob's Law cuts both ways: web apps put the account menu there), and both open
 * the same actions. */
export function SidebarUserBlock({
  avatar,
  name,
  secondary,
  actions,
  label,
  collapsed = false,
  className,
}: SidebarUserBlockProps) {
  const danger = actions.filter((a) => a.danger)
  const normal = actions.filter((a) => !a.danger)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={label}
        className={cn(
          'min-h-11 w-full items-center gap-x-2 rounded-sm px-2 py-1 text-left text-sidebar-foreground',
          'transition-colors duration-(--dur-micro) ease-out hover:bg-sidebar-accent',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
          collapsed ? 'flex justify-center px-0' : 'grid grid-cols-[auto_minmax(0,1fr)_auto]',
          className,
        )}
      >
        {avatar}
        {collapsed ? null : (
          <>
            <span data-shell-label className="min-w-0 text-body [overflow-wrap:anywhere]">
              {name}
            </span>
            <ChevronsUpDown className="size-4 shrink-0 text-sidebar-muted" aria-hidden="true" />
            {secondary ? (
              <span
                data-shell-label
                className="col-span-3 min-w-0 text-caption text-sidebar-muted [overflow-wrap:anywhere]"
              >
                {secondary}
              </span>
            ) : null}
          </>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="top"
        collisionPadding={8}
        className="max-h-(--radix-dropdown-menu-content-available-height) w-60 min-w-0 max-w-[calc(100vw-1rem)] overflow-y-auto"
      >
        {normal.map((action) => (
          <DropdownMenuItem key={action.id} onSelect={action.onSelect}>
            {action.icon ? <action.icon className="size-4 shrink-0" aria-hidden="true" /> : null}
            <span data-shell-label className="min-w-0 flex-1 [overflow-wrap:anywhere]">
              {action.label}
            </span>
          </DropdownMenuItem>
        ))}
        {danger.length > 0 && normal.length > 0 ? <DropdownMenuSeparator /> : null}
        {danger.map((action) => (
          <DropdownMenuItem key={action.id} onSelect={action.onSelect}>
            {action.icon ? <action.icon className="size-4 shrink-0" aria-hidden="true" /> : null}
            <span data-shell-label className="min-w-0 flex-1 [overflow-wrap:anywhere]">
              {action.label}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
