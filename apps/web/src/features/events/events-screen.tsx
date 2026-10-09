// `/events` (TECH-SPEC §3.4/§5: "Calendar view (month/list)"). List and calendar are two lenses on
// the same query -- no separate fetch per view. Create/detail are query-string driven (`?new=1`,
// `?event=<id>`) rather than nested routes, matching `router.tsx`'s "exact-path only, no :params yet"
// tradeoff (MODULE-GUIDE.md "Web features") -- both are shareable/bookmarkable links this way too.
import * as React from 'react'
import { useT, useLocale, formatMonthYear, type Locale } from '@devon/i18n'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
  PageHeader,
  Reveal,
  Stagger,
  StaggerItem,
  StateView,
  toast,
} from '@devon/ui'
import { CalendarDays, Download, List, MoreVertical, Plus } from 'lucide-react'
import { ApiError } from '../../lib/api-client.js'
import { navigate, useSearchParams } from '../../lib/router.js'
import { useOnline } from '../../lib/use-online.js'
import { CalendarMonth } from './components/calendar-month.js'
import { EventCard } from './components/event-card.js'
import { EventDetailDialog } from './components/event-detail-dialog.js'
import { EventFormDialog } from './components/event-form-dialog.js'
import { pickGroupIllustrationKeys } from './illustrations/index.js'
import { downloadIcs } from './lib/ics-download.js'
import { eventFormValuesToCreateInput } from './lib/event-form-mapping.js'
import { fetchMyIcs } from './api.js'
import { useCreateEventMutation, useEventsQuery } from './hooks.js'
import type { EventDto } from './schemas.js'

/** Luma-style month grouping for the list view: events fall into a sticky-headed month bucket,
 * chronologically, each bucket's cards staggering in as their own group (UI-OVERHAUL.md's "month
 * grouping with stagger"). `formatMonthYear` (not raw `Intl.DateTimeFormat`) -- verified live
 * against a real reduced-ICU embedded browser that renders `uz-Latn` month names as the bare numeric
 * skeleton fallback ("2026 M09") with no error to catch. */
function groupByMonth(events: EventDto[], locale: Locale): { label: string; items: EventDto[] }[] {
  const sorted = [...events].sort(
    (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
  )
  const groups: { key: string; label: string; items: EventDto[] }[] = []
  for (const event of sorted) {
    const d = new Date(event.startsAt)
    const key = `${d.getFullYear()}-${d.getMonth()}`
    let group = groups.find((g) => g.key === key)
    if (!group) {
      group = { key, label: formatMonthYear(d, locale), items: [] }
      groups.push(group)
    }
    group.items.push(event)
  }
  return groups
}

type View = 'list' | 'calendar'

export default function EventsScreen() {
  const t = useT()
  const locale = useLocale()
  const online = useOnline()
  const params = useSearchParams()
  const [view, setView] = React.useState<View>('list')
  const [month, setMonth] = React.useState(() => new Date())
  const [downloadingMine, setDownloadingMine] = React.useState(false)
  const createdEventId = React.useRef<string | null>(null)

  const eventsQuery = useEventsQuery()
  const createMutation = useCreateEventMutation()

  const openEventId = params.get('event')
  const creating = params.get('new') === '1'

  const closeOverlay = () => navigate('/events')

  const handleDownloadMine = async () => {
    setDownloadingMine(true)
    try {
      const ics = await fetchMyIcs()
      downloadIcs(ics.filename, ics.content)
    } catch {
      toast(t('eventsControls.exportFailed'))
    } finally {
      setDownloadingMine(false)
    }
  }

  if (!online && eventsQuery.data === undefined) {
    return (
      <StateView
        kind="offline"
        titleKey="events.offline.title"
        bodyKey="events.offline.body"
        action={{ labelKey: 'events.actions.retry', onAction: () => eventsQuery.refetch() }}
      />
    )
  }

  if (eventsQuery.isPending) {
    return <StateView kind="loading" titleKey="events.loading.title" />
  }

  if (eventsQuery.isError) {
    const err = eventsQuery.error
    const code = err instanceof ApiError ? err.code : null
    if (code === 'forbidden') {
      return (
        <StateView
          kind="forbidden"
          titleKey="events.forbidden.title"
          bodyKey="events.forbidden.body"
        />
      )
    }
    const requestId = err instanceof ApiError && err.requestId ? err.requestId : null
    return (
      <StateView
        kind="error"
        titleKey="events.error.title"
        bodyKey="events.error.body"
        action={{ labelKey: 'events.actions.retry', onAction: () => eventsQuery.refetch() }}
        {...(requestId ? { requestId } : {})}
      />
    )
  }

  const events = eventsQuery.data.items

  function renderEventsBody() {
    if (events.length === 0) {
      return (
        <StateView
          kind="empty"
          titleKey="events.empty.title"
          bodyKey="events.empty.body"
          action={{ labelKey: 'events.empty.action', onAction: () => navigate('/events?new=1') }}
        />
      )
    }
    if (view === 'list') {
      const groups = groupByMonth(events, locale)
      return (
        <div className="flex flex-col gap-8">
          {groups.map((group) => {
            // round2 SEV2: two events in the same month could draw the identical cover illustration
            // (same category -> same component, and occasionally the same look-variant hash besides)
            // -- computed once per group, from every id in it, so a month with <=8 events never
            // repeats a base illustration at all.
            const illustrationKeys = pickGroupIllustrationKeys(group.items.map((e) => e.id))
            return (
              <section key={group.label} className="flex flex-col gap-3">
                {/* round2 SEV2: month group heads did not reveal -- each one fades + rises in once,
                    the plainest entrance in the catalogue, on view rather than replaying every time
                    the list re-renders. */}
                <Reveal onView>
                  <h2 className="text-eyebrow uppercase tracking-(--text-eyebrow--letter-spacing) text-muted-foreground">
                    {group.label}
                  </h2>
                </Reveal>
                <Stagger
                  as="div"
                  animateKey={group.label}
                  className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
                >
                  {group.items.map((event) => (
                    <StaggerItem key={event.id}>
                      <EventCard
                        event={event}
                        onOpen={() => navigate(`/events?event=${event.id}`)}
                        illustrationKeyOverride={illustrationKeys.get(event.id)}
                      />
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
      <CalendarMonth
        month={month}
        onMonthChange={setMonth}
        events={events}
        onOpen={(eventId) => navigate(`/events?event=${eventId}`)}
      />
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={t('events.eyebrow')}
        title={t('events.title')}
        description={t('events.description')}
        actions={
          <>
            <div className="flex rounded-md border border-border p-0.5">
              <Button
                variant={view === 'list' ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setView('list')}
                aria-pressed={view === 'list'}
              >
                <List className="size-4" aria-hidden="true" />
                {t('events.view.list')}
              </Button>
              <Button
                variant={view === 'calendar' ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setView('calendar')}
                aria-pressed={view === 'calendar'}
              >
                <CalendarDays className="size-4" aria-hidden="true" />
                {t('events.view.calendar')}
              </Button>
            </div>
            {/* ui-blitz round3 #24: the header held four controls (view toggle x2, ".ics" export,
                "create") and wrapped to two rows well before mobile widths. The export -- a
                secondary, occasional action -- moves behind the same overflow-menu convention
                `event-detail-dialog.tsx` already uses for its own less-common action, leaving
                exactly the view toggle and the one primary "create" button in the row. */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton aria-label={t('events.actions.moreActions')} disabled={downloadingMine}>
                  <MoreVertical className="size-4" aria-hidden="true" />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={handleDownloadMine} disabled={downloadingMine}>
                  <Download className="size-3.5" aria-hidden="true" />
                  {t('events.ics.exportMine')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button size="sm" onClick={() => navigate('/events?new=1')}>
              <Plus className="size-4" aria-hidden="true" />
              {t('events.actions.create')}
            </Button>
          </>
        }
      />

      {renderEventsBody()}

      <EventFormDialog
        open={creating}
        onOpenChange={(open) => {
          if (!open) {
            const createdId = createdEventId.current
            createdEventId.current = null
            if (createdId) navigate(`/events?event=${createdId}`, { replace: true })
            else closeOverlay()
          }
        }}
        event={null}
        submitting={createMutation.isPending}
        onSubmit={async (values) => {
          const created = await createMutation.mutateAsync(eventFormValuesToCreateInput(values))
          createdEventId.current = created.id
        }}
      />

      {openEventId ? (
        <EventDetailDialog
          eventId={openEventId}
          open={true}
          onOpenChange={(open) => {
            if (!open) closeOverlay()
          }}
        />
      ) : null}
    </div>
  )
}
