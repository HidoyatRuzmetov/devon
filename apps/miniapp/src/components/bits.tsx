// The small, repeated pieces three or more screens need. Anything used by exactly one screen lives
// in that screen's own file instead.
import * as React from 'react'
import { formatDate, formatTime, useLocale, useT } from '@devon/i18n'
import { Badge, Chip, cn } from '@devon/ui'

/** Section label above a group of rows. The eyebrow shape from DESIGN.md §2.3, at the size a phone
 * can still read. */
export function SectionLabel({
  children,
  count,
}: {
  children: React.ReactNode
  count?: number
}): React.ReactElement {
  return (
    <div className="mt-4 mb-2 flex items-baseline gap-2 first:mt-0">
      <h2 className="text-muted-foreground text-[11px] leading-4 font-semibold tracking-[0.08em] uppercase">
        {children}
      </h2>
      {count === undefined ? null : (
        <span className="text-muted-foreground text-[11px] tabular-nums">{count}</span>
      )}
    </div>
  )
}

/** A due date, with its own words for today/tomorrow/overdue. Colour is never the only signal
 * (DESIGN.md §2.1): the chip always says what it means. */
export function DueChip({
  dueAt,
  risk,
}: {
  dueAt: string | null
  risk: 'none' | 'at_risk' | 'overdue'
}): React.ReactElement | null {
  const t = useT()
  const locale = useLocale()
  if (!dueAt) return null
  const due = new Date(dueAt)
  if (Number.isNaN(due.getTime())) return null

  const startOfDay = (d: Date): number =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((startOfDay(due) - startOfDay(new Date())) / 86_400_000)

  const label =
    days === 0
      ? t('miniapp.due.today')
      : days === 1
        ? t('miniapp.due.tomorrow')
        : days === -1
          ? t('miniapp.due.yesterday')
          : formatDate(due, locale)

  const tone = risk === 'overdue' ? 'destructive' : risk === 'at_risk' ? 'attention' : 'neutral'
  return (
    <Chip tone={tone}>{risk === 'overdue' ? `${t('miniapp.due.overdue')} · ${label}` : label}</Chip>
  )
}

const PRIORITY_TONE = {
  urgent: 'destructive',
  high: 'warning',
  medium: 'info',
  low: 'neutral',
  none: 'neutral',
} as const

export function PriorityBadge({
  priority,
}: {
  priority: 'none' | 'low' | 'medium' | 'high' | 'urgent'
}): React.ReactElement | null {
  const t = useT()
  if (priority === 'none' || priority === 'low') return null
  return <Badge tone={PRIORITY_TONE[priority]}>{t(`miniapp.priority.${priority}`)}</Badge>
}

/** `Familiya Ism` in a list (DESIGN.md §5: casual lists use the short form). */
export function personName(person: { givenName: string; familyName: string }): string {
  return `${person.givenName} ${person.familyName}`.trim()
}

export function timeRange(
  startsAt: string,
  endsAt: string,
  locale: Parameters<typeof formatDate>[1],
): string {
  const start = new Date(startsAt)
  const end = new Date(endsAt)
  if (Number.isNaN(start.getTime())) return ''
  const sameDay = formatDate(start, locale) === formatDate(end, locale)
  return sameDay
    ? `${formatDate(start, locale)} · ${formatTime(start, locale)}–${formatTime(end, locale)}`
    : `${formatDate(start, locale)} ${formatTime(start, locale)} – ${formatDate(end, locale)} ${formatTime(end, locale)}`
}

/** A tappable row surface: 44 px minimum target, hover lift and press scale from the catalogue,
 * expressed as CSS transitions so the phone never pays for a spring it cannot feel. */
export const rowSurface = cn(
  'w-full rounded-md border border-border bg-card px-3 py-3 text-left',
  'shadow-1 transition-[transform,box-shadow,background-color] duration-(--dur-micro) ease-out',
  'hover:-translate-y-0.5 hover:shadow-2 active:translate-y-0 active:scale-[0.99]',
  'motion-reduce:transform-none motion-reduce:transition-colors',
  'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
)
