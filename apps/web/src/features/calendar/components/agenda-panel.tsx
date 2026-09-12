// "The days ahead": exactly what the ICS subscription contains, rendered in the app, so what a
// person sees here and what lands in the calendar on their phone can never disagree (one query on
// the API, two renderings).
import * as React from 'react'
import { useT, useLocale, formatDate, formatTime } from '@devon/i18n'
import {
  Reveal,
  SegmentedControl,
  Stagger,
  StaggerItem,
  StateView,
  HoverLift,
} from '@devon/ui'
import { CalendarDays, KanbanSquare, MapPin } from 'lucide-react'
import { ApiError } from '../../../lib/api-client.js'
import { navigate } from '../../../lib/router.js'
import { useOnline } from '../../../lib/use-online.js'
import { useAgendaQuery } from '../hooks.js'
import type { AgendaItem } from '../schemas.js'

const RANGES = [7, 30, 90] as const
type Range = (typeof RANGES)[number]

const RANGE_LABEL_KEY: Record<Range, string> = {
  7: 'calendar.agenda.range.week',
  30: 'calendar.agenda.range.month',
  90: 'calendar.agenda.range.quarter',
}

/** Tashkent-local day key, so "today" means the same thing here as it does on the server and in the
 * feed (DESIGN.md §5: this product decides in Asia/Tashkent, always). */
function dayKey(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tashkent',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso))
}

function groupByDay(items: AgendaItem[]): { key: string; date: Date; items: AgendaItem[] }[] {
  const sorted = [...items].sort(
    (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
  )
  const groups: { key: string; date: Date; items: AgendaItem[] }[] = []
  for (const item of sorted) {
    const key = dayKey(item.startsAt)
    let group = groups.find((g) => g.key === key)
    if (!group) {
      group = { key, date: new Date(item.startsAt), items: [] }
      groups.push(group)
    }
    group.items.push(item)
  }
  return groups
}

export function AgendaPanel(): React.JSX.Element {
  const t = useT()
  const locale = useLocale()
  const online = useOnline()
  const [days, setDays] = React.useState<Range>(30)
  const query = useAgendaQuery(days)

  const todayKey = dayKey(new Date().toISOString())
  const tomorrowKey = dayKey(new Date(Date.now() + 86_400_000).toISOString())

  const rangeControl = (
    <SegmentedControl
      label={t('calendar.agenda.range.label')}
      value={String(days)}
      onValueChange={(next) => setDays(Number(next) as Range)}
      options={RANGES.map((r) => ({ value: String(r), label: t(RANGE_LABEL_KEY[r]) }))}
    />
  )

  function body(): React.JSX.Element {
    if (!online && query.data === undefined) {
      return (
        <StateView
          kind="offline"
          titleKey="calendar.offline.title"
          bodyKey="calendar.offline.body"
          action={{ labelKey: 'calendar.actions.retry', onAction: () => void query.refetch() }}
        />
      )
    }
    if (query.isPending) return <StateView kind="loading" titleKey="calendar.agenda.loading.title" />
    if (query.isError) {
      const err = query.error
      const code = err instanceof ApiError ? err.code : null
      if (code === 'forbidden') {
        return (
          <StateView
            kind="forbidden"
            titleKey="calendar.forbidden.title"
            bodyKey="calendar.forbidden.body"
          />
        )
      }
      const requestId = err instanceof ApiError && err.requestId ? err.requestId : null
      return (
        <StateView
          kind="error"
          titleKey="calendar.agenda.error.title"
          bodyKey="calendar.agenda.error.body"
          action={{ labelKey: 'calendar.actions.retry', onAction: () => void query.refetch() }}
          {...(requestId ? { requestId } : {})}
        />
      )
    }

    const items = query.data.items
    if (items.length === 0) {
      return (
        <StateView
          kind="empty"
          titleKey="calendar.agenda.empty.title"
          bodyKey="calendar.agenda.empty.body"
          action={{ labelKey: 'calendar.agenda.empty.action', onAction: () => navigate('/events') }}
        />
      )
    }

    return (
      <div className="flex flex-col gap-8">
        {groupByDay(items).map((group) => {
          const label =
            group.key === todayKey
              ? t('calendar.agenda.today')
              : group.key === tomorrowKey
                ? t('calendar.agenda.tomorrow')
                : formatDate(group.date, locale)
          return (
            <section key={group.key} className="flex flex-col gap-3">
              <Reveal onView>
                <h3 className="text-eyebrow uppercase tracking-(--text-eyebrow--letter-spacing) text-muted-foreground">
                  {label}
                </h3>
              </Reveal>
              <Stagger as="ul" animateKey={`${group.key}-${days}`} className="flex flex-col gap-2">
                {group.items.map((item) => (
                  <StaggerItem as="li" key={`${item.kind}-${item.id}`}>
                    <HoverLift>
                      <button
                        type="button"
                        onClick={() => navigate(item.deepLink)}
                        className="flex w-full items-start gap-3 rounded-md border border-border bg-surface-2 p-3 text-left transition-colors hover:bg-surface-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                      >
                        <span
                          aria-hidden="true"
                          className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-sm bg-surface-3 text-muted-foreground"
                        >
                          {item.kind === 'event' ? (
                            <CalendarDays className="size-4" />
                          ) : (
                            <KanbanSquare className="size-4" />
                          )}
                        </span>
                        <span className="flex min-w-0 flex-1 flex-col gap-1">
                          <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                            <span className="text-body font-medium text-foreground">
                              {item.title}
                            </span>
                            <span className="text-caption text-muted-foreground">
                              {t(
                                item.kind === 'event'
                                  ? 'calendar.agenda.kind.event'
                                  : 'calendar.agenda.kind.card',
                              )}
                            </span>
                          </span>
                          <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-muted-foreground">
                            <span>{formatTime(new Date(item.startsAt), locale)}</span>
                            <span className="inline-flex items-center gap-1">
                              <MapPin aria-hidden="true" className="size-3" />
                              {item.place || t('calendar.agenda.noPlace')}
                            </span>
                          </span>
                        </span>
                      </button>
                    </HoverLift>
                  </StaggerItem>
                ))}
              </Stagger>
            </section>
          )
        })}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <h2 className="text-h3 text-foreground">{t('calendar.agenda.title')}</h2>
          <p className="text-body text-muted-foreground">{t('calendar.agenda.description')}</p>
        </div>
        {rangeControl}
      </div>
      {body()}
    </div>
  )
}

export default AgendaPanel
