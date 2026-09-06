// `/events` (TECH-SPEC §3.4/§5: "Calendar view (month/list)"). List and calendar are two lenses on
// the same query -- no separate fetch per view. Create/detail are query-string driven (`?new=1`,
// `?event=<id>`) rather than nested routes, matching `router.tsx`'s "exact-path only, no :params yet"
// tradeoff (MODULE-GUIDE.md "Web features") -- both are shareable/bookmarkable links this way too.
import * as React from 'react'
import { useT } from '@devon/i18n'
import { Button, StateView } from '@devon/ui'
import { CalendarDays, List, Plus } from 'lucide-react'
import { ApiError } from '../../lib/api-client.js'
import { navigate, useSearchParams } from '../../lib/router.js'
import { useOnline } from '../../lib/use-online.js'
import { CalendarMonth } from './components/calendar-month.js'
import { EventCard } from './components/event-card.js'
import { EventDetailDialog } from './components/event-detail-dialog.js'
import { EventFormDialog } from './components/event-form-dialog.js'
import { downloadIcs } from './lib/ics-download.js'
import { eventFormValuesToCreateInput } from './lib/event-form-mapping.js'
import { fetchMyIcs } from './api.js'
import { useCreateEventMutation, useEventsQuery } from './hooks.js'

type View = 'list' | 'calendar'

export default function EventsScreen() {
  const t = useT()
  const online = useOnline()
  const params = useSearchParams()
  const [view, setView] = React.useState<View>('list')
  const [month, setMonth] = React.useState(() => new Date())
  const [downloadingMine, setDownloadingMine] = React.useState(false)

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
      return (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {events.map((event) => (
            <EventCard
              key={event.id}
              event={event}
              onOpen={() => navigate(`/events?event=${event.id}`)}
            />
          ))}
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-h2 text-foreground">{t('events.title')}</h1>
        <div className="flex flex-wrap items-center gap-2">
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
          <Button
            variant="secondary"
            size="sm"
            loading={downloadingMine}
            onClick={handleDownloadMine}
          >
            {t('events.ics.exportMine')}
          </Button>
          <Button size="sm" onClick={() => navigate('/events?new=1')}>
            <Plus className="size-4" aria-hidden="true" />
            {t('events.actions.create')}
          </Button>
        </div>
      </div>

      {renderEventsBody()}

      <EventFormDialog
        open={creating}
        onOpenChange={(open) => {
          if (!open) closeOverlay()
        }}
        event={null}
        submitting={createMutation.isPending}
        onSubmit={async (values) => {
          const created = await createMutation.mutateAsync(eventFormValuesToCreateInput(values))
          navigate(`/events?event=${created.id}`, { replace: true })
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
