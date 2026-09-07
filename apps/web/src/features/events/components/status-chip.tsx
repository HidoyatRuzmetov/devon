// A tinted event status/category chip (UI-OVERHAUL.md item 14 of this pass: "Event category and
// status chips are tinted, not solid"). `@devon/ui`'s `Badge` primitive is solid-fill only and lives
// outside this pass's editable surface (packages/ui), so events draws its own low-chroma pill here --
// same box shape and size as `Badge` (`h-6`, `rounded-sm`, `text-caption`), a token colour at reduced
// opacity instead of a full fill, matching how `work`'s own tinted badges (`fdf4cc5`) read: colour as
// a wash, not a block.
import type { ReactNode } from 'react'
import { cn } from '@devon/ui'

export type EventChipTone = 'neutral' | 'info' | 'warning' | 'destructive' | 'outline'

const TONE_CLASS: Record<EventChipTone, string> = {
  neutral: 'bg-muted text-muted-foreground',
  info: 'bg-info/15 text-foreground',
  warning: 'bg-warning/15 text-foreground',
  destructive: 'bg-destructive/15 text-foreground',
  // The event's category has no semantic colour of its own (it isn't a status), so it reads as a
  // plain outline pill -- present, but never competing with the status chip's tint for attention.
  outline: 'border border-border bg-transparent text-foreground',
}

export function EventChip({
  tone = 'neutral',
  className,
  children,
}: {
  tone?: EventChipTone
  className?: string
  children: ReactNode
}) {
  return (
    <span
      className={cn(
        'inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-sm px-2 text-caption font-medium',
        TONE_CLASS[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}
