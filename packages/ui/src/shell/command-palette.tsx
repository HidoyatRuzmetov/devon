import * as React from 'react'
import { Command } from 'cmdk'
import { Dialog, DialogContent } from '../primitives/dialog.js'
import { Sheet, SheetContent } from '../primitives/sheet.js'
import { Skeleton } from '../primitives/skeleton.js'
import { Button } from '../primitives/button.js'
import { cn } from '../lib/cn.js'

export interface CommandPaletteItem {
  id: string
  label: string
  icon?: React.ComponentType<React.SVGProps<SVGSVGElement>>
  onSelect: () => void
}

export interface CommandPaletteGroup {
  heading: string
  items: readonly CommandPaletteItem[]
}

export interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Accessible name, e.g. `t('search.aria')` = "Qidirish va amallar" -- not shown visually
   * (spec.md §5: the palette's own structure starts with the input, no heading above it). */
  title: string
  placeholder: string
  emptyMessage: string
  emptyActionLabel: string
  onEmptyAction: () => void
  /** "↑↓ tanlash · ↵ ochish · Esc yopish" (spec.md §5, §9.2 `cmd.hint`). */
  hint: string
  groups: readonly CommandPaletteGroup[]
  /** spec.md §5: "Loading (nested async pages, later epics): three 40px skeleton rows, never a
   * spinner." Nothing in this epic is async yet -- the flag exists so the shell is ready. */
  loading?: boolean
  /** >=1024 centred dialog vs. 390 bottom sheet (spec.md §5). The breakpoint decision belongs to
   * the caller (`apps/web`) -- this package does not sniff viewport width. */
  variant?: 'dialog' | 'sheet'
}

const GROUP_HEADING_CLASS =
  '[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-eyebrow ' +
  '[&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-(--text-eyebrow--letter-spacing) ' +
  '[&_[cmdk-group-heading]]:text-muted-foreground'

function CommandPaletteBody({
  placeholder,
  emptyMessage,
  emptyActionLabel,
  onEmptyAction,
  hint,
  groups,
  loading,
}: Omit<CommandPaletteProps, 'open' | 'onOpenChange' | 'title' | 'variant'>) {
  return (
    <Command shouldFilter loop className="flex h-full flex-col">
      <Command.Input
        placeholder={placeholder}
        className={cn(
          'h-12 w-full border-0 border-b border-border bg-transparent px-4 text-body text-foreground',
          'outline-none placeholder:text-muted-foreground',
        )}
      />
      <Command.List className="flex-1 overflow-y-auto p-1">
        {loading ? (
          <div className="flex flex-col gap-1 p-2" aria-hidden="true">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : (
          <>
            <Command.Empty className="flex flex-col items-center gap-3 p-8 text-center">
              <span data-shell-label className="text-body text-muted-foreground">
                {emptyMessage}
              </span>
              <Button data-primary size="sm" variant="secondary" onClick={onEmptyAction}>
                <span data-shell-label>{emptyActionLabel}</span>
              </Button>
            </Command.Empty>
            {groups.map((group) => (
              <Command.Group
                key={group.heading}
                heading={<span data-shell-label>{group.heading}</span>}
                className={GROUP_HEADING_CLASS}
              >
                {group.items.map((item) => (
                  <Command.Item
                    key={item.id}
                    onSelect={item.onSelect}
                    className={cn(
                      'flex h-10 cursor-pointer items-center gap-2 rounded-sm px-2 text-body text-foreground',
                      'data-[selected=true]:bg-accent',
                    )}
                  >
                    {item.icon ? <item.icon className="size-4" aria-hidden="true" /> : null}
                    <span data-shell-label>{item.label}</span>
                  </Command.Item>
                ))}
              </Command.Group>
            ))}
          </>
        )}
      </Command.List>
      <div
        data-shell-label
        className="border-t border-border px-4 py-2 text-caption text-muted-foreground"
      >
        {hint}
      </div>
    </Command>
  )
}

/** design.md §3 CommandPalette shell / spec.md §5. "Shell" per the item handoff: structure, states
 * and keyboard/`role` semantics (delegated to `cmdk`) are real; the *sources* it filters over are
 * wired by `apps/web` (EPIC-000.7) via the `groups` prop -- this package ships no navigation, no
 * routing and no fetch. */
export function CommandPalette({
  open,
  onOpenChange,
  title,
  variant = 'dialog',
  ...body
}: CommandPaletteProps) {
  if (variant === 'sheet') {
    return (
      <Sheet direction="bottom" open={open} onOpenChange={onOpenChange}>
        <SheetContent title={title} side="bottom" className="flex h-[60vh] flex-col p-0">
          <CommandPaletteBody {...body} />
        </SheetContent>
      </Sheet>
    )
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={title}
        titleHidden
        showClose={false}
        className="top-[15vh] flex h-100 max-w-160 -translate-y-0 flex-col p-0"
      >
        <CommandPaletteBody {...body} />
      </DialogContent>
    </Dialog>
  )
}
