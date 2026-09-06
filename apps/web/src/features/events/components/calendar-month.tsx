// Month grid (TECH-SPEC §5: "Calendar: month/list"). A small, dependency-free grid rather than
// FullCalendar (not a dependency of `@devon/web` yet -- TECH-SPEC §1.2 names it for the product;
// pulling a new heavyweight dependency into one module's first cut is exactly the kind of "ask in an
// escalation" tradeoff MODULE-GUIDE.md flags for a genuinely new capability, and the list view already
// covers the same data completely). Weeks start Monday (DESIGN.md §5 copy rule).
import * as React from 'react'
import { useT, useLocale } from '@devon/i18n'
import { Button } from '@devon/ui'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { EventDto } from '../schemas.js'

const MONTH_LABEL_LOCALE: Record<string, string> = {
  'uz-Latn': 'uz-Latn',
  'uz-Cyrl': 'uz-Cyrl',
  ru: 'ru-RU',
  en: 'en-US',
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

function startOfGrid(monthStart: Date): Date {
  // Monday-first: JS `getDay()` is 0=Sunday..6=Saturday; shift so Monday is 0.
  const dow = (monthStart.getDay() + 6) % 7
  const d = new Date(monthStart)
  d.setDate(d.getDate() - dow)
  return d
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

export function CalendarMonth({
  month,
  onMonthChange,
  events,
  onOpen,
}: {
  month: Date
  onMonthChange: (next: Date) => void
  events: EventDto[]
  onOpen: (eventId: string) => void
}) {
  const t = useT()
  const locale = useLocale()
  const monthStart = startOfMonth(month)
  const gridStart = startOfGrid(monthStart)
  const today = new Date()

  const days = React.useMemo(() => {
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(gridStart)
      d.setDate(d.getDate() + i)
      return d
    })
  }, [gridStart])

  const eventsByDay = React.useMemo(() => {
    const map = new Map<string, EventDto[]>()
    for (const event of events) {
      const d = new Date(event.startsAt)
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
      const list = map.get(key) ?? []
      list.push(event)
      map.set(key, list)
    }
    return map
  }, [events])

  const weekdayLabels = React.useMemo(() => {
    const base = new Date(2026, 0, 5) // a Monday
    const fmt = new Intl.DateTimeFormat(MONTH_LABEL_LOCALE[locale] ?? 'en-US', { weekday: 'short' })
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(base)
      d.setDate(d.getDate() + i)
      return fmt.format(d)
    })
  }, [locale])

  const monthLabel = new Intl.DateTimeFormat(MONTH_LABEL_LOCALE[locale] ?? 'en-US', {
    month: 'long',
    year: 'numeric',
  }).format(monthStart)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onMonthChange(new Date(monthStart.getFullYear(), monthStart.getMonth() - 1, 1))}
          aria-label={t('events.actions.back')}
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
        </Button>
        <p className="text-lead font-medium capitalize text-foreground">{monthLabel}</p>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onMonthChange(new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1))}
          aria-label={t('events.actions.back')}
        >
          <ChevronRight className="size-4" aria-hidden="true" />
        </Button>
      </div>
      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-md border border-border bg-border text-caption">
        {weekdayLabels.map((label) => (
          <div key={label} className="bg-muted p-2 text-center font-medium text-muted-foreground">
            {label}
          </div>
        ))}
        {days.map((day) => {
          const key = `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`
          const dayEvents = eventsByDay.get(key) ?? []
          const inMonth = day.getMonth() === monthStart.getMonth()
          return (
            <div
              key={key}
              className={`flex min-h-24 flex-col gap-1 bg-card p-1.5 ${inMonth ? '' : 'opacity-40'}`}
            >
              <span
                className={`self-end text-caption ${sameDay(day, today) ? 'flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
              >
                {day.getDate()}
              </span>
              <div className="flex flex-col gap-1">
                {dayEvents.slice(0, 3).map((event) => (
                  <button
                    key={event.id}
                    type="button"
                    onClick={() => onOpen(event.id)}
                    className={`truncate rounded-sm px-1.5 py-0.5 text-left text-caption font-medium text-primary-foreground hover:opacity-90 ${
                      event.status === 'cancelled' ? 'bg-muted-foreground line-through' : 'bg-primary'
                    }`}
                  >
                    {event.title}
                  </button>
                ))}
                {dayEvents.length > 3 ? (
                  <span className="text-caption text-muted-foreground">+{dayEvents.length - 3}</span>
                ) : null}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
