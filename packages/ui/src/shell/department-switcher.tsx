import * as React from 'react'
import { Check, ChevronsUpDown, Plus } from 'lucide-react'
import { cn } from '../lib/cn.js'
import { Popover, PopoverContent, PopoverTrigger } from '../primitives/popover.js'
import { Avatar, initialsFromName } from '../primitives/avatar.js'

export interface DepartmentOption {
  id: string
  name: string
  /** "Boshliq" / "Xodim" -- the caller translates; this component never guesses a role name. */
  roleLabel: string
}

export interface DepartmentSwitcherProps {
  departments: readonly DepartmentOption[]
  activeId: string | null
  onSelect: (id: string) => void
  /** Accessible name for the trigger, e.g. `t('shell.department.aria')`. */
  label: string
  /** Heading above the list. */
  heading: string
  /** "Boʻlim yaratish yoki qoʻshilish" -- the way out for someone in no department, or in one and
   * wanting another. Omit to hide the row entirely. */
  addLabel?: string
  onAdd?: () => void
  /** Shown on the trigger when the user is in no department yet. */
  emptyLabel: string
  collapsed?: boolean
  className?: string
}

/** UI-OVERHAUL.md §2 row 1: the workspace switcher every product with more than one workspace puts
 * at the top of its sidebar (Linear, Slack, Notion, Vercel). A popover, not a dropdown menu: it
 * carries a heading, a list with a check on the active one, and one action at the foot. */
export function DepartmentSwitcher({
  departments,
  activeId,
  onSelect,
  label,
  heading,
  addLabel,
  onAdd,
  emptyLabel,
  collapsed = false,
  className,
}: DepartmentSwitcherProps) {
  const [open, setOpen] = React.useState(false)
  const active = departments.find((d) => d.id === activeId) ?? null

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className={cn(
            'flex min-h-11 w-full items-center gap-2 rounded-sm px-2 text-left',
            'text-sidebar-foreground transition-colors duration-(--dur-micro) ease-out',
            'hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2',
            'focus-visible:ring-ring focus-visible:ring-inset',
            collapsed && 'justify-center px-0',
            className,
          )}
        >
          <Avatar
            src={null}
            alt={active?.name ?? emptyLabel}
            initials={initialsFromName(active?.name ?? emptyLabel, '')}
            hueSeed={active?.id ?? 'none'}
            size="sm"
            className="rounded-sm"
          />
          {collapsed ? null : (
            <>
              <span className="flex min-w-0 flex-1 flex-col">
                <span data-shell-label className="min-w-0 text-body">
                  {active ? active.name : emptyLabel}
                </span>
                {active ? (
                  <span data-shell-label className="min-w-0 text-caption text-sidebar-muted">
                    {active.roleLabel}
                  </span>
                ) : null}
              </span>
              <ChevronsUpDown className="size-4 shrink-0 text-sidebar-muted" aria-hidden="true" />
            </>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" side="bottom" className="w-70 p-1">
        <p
          data-shell-label
          className="px-2 py-1.5 text-eyebrow uppercase tracking-(--text-eyebrow--letter-spacing) text-muted-foreground"
        >
          {heading}
        </p>
        <ul className="flex flex-col">
          {departments.map((department) => (
            <li key={department.id}>
              <button
                type="button"
                onClick={() => {
                  onSelect(department.id)
                  setOpen(false)
                }}
                className={cn(
                  'flex min-h-11 w-full items-center gap-2 rounded-sm px-2 text-left text-body',
                  'transition-colors duration-(--dur-micro) ease-out hover:bg-accent',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                )}
              >
                <Avatar
                  src={null}
                  alt={department.name}
                  initials={initialsFromName(department.name, '')}
                  hueSeed={department.id}
                  size="sm"
                  className="rounded-sm"
                />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span data-shell-label className="min-w-0">
                    {department.name}
                  </span>
                  <span data-shell-label className="min-w-0 text-caption text-muted-foreground">
                    {department.roleLabel}
                  </span>
                </span>
                {department.id === activeId ? (
                  <Check className="size-4 shrink-0 text-primary" aria-hidden="true" />
                ) : null}
              </button>
            </li>
          ))}
        </ul>
        {addLabel && onAdd ? (
          <>
            <div className="my-1 h-px bg-border" />
            <button
              type="button"
              onClick={() => {
                onAdd()
                setOpen(false)
              }}
              className="flex min-h-11 w-full items-center gap-2 rounded-sm px-2 text-left text-body text-foreground transition-colors duration-(--dur-micro) hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Plus className="size-4 shrink-0" aria-hidden="true" />
              <span data-shell-label className="min-w-0">
                {addLabel}
              </span>
            </button>
          </>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}
