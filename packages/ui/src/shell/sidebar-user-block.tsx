import * as React from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '../lib/cn.js'

export interface SidebarUserBlockProps {
  avatar: React.ReactNode
  name: string
  secondary?: string
  onSelect: () => void
  label: string
  collapsed?: boolean
  className?: string
}

/** The account identity is a direct, predictable route into profile settings. */
export function SidebarUserBlock({
  avatar,
  name,
  secondary,
  onSelect,
  label,
  collapsed = false,
  className,
}: SidebarUserBlockProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={label}
      className={cn(
        'flex min-h-11 w-full items-center gap-3 rounded-md px-2 py-2 text-left text-sidebar-foreground transition-colors duration-(--dur-micro) hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
        collapsed && 'justify-center px-0',
        className,
      )}
    >
      {avatar}
      {!collapsed ? (
        <>
          <span className="min-w-0 flex-1">
            <span data-shell-label className="block break-words text-small font-medium">
              {name}
            </span>
            {secondary ? (
              <span data-shell-label className="block break-words text-caption text-sidebar-muted">
                {secondary}
              </span>
            ) : null}
          </span>
          <ChevronRight className="size-4 shrink-0 text-sidebar-muted" aria-hidden="true" />
        </>
      ) : null}
    </button>
  )
}
