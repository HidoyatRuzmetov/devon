// The event detail overlay -- opened via `?event=<id>` from `events-screen.tsx`. A `Dialog` rather
// than the mobile-only fixed-width `Sheet` (MODULE-GUIDE.md's own reasoning for `calendar-month.tsx`
// skipping FullCalendar applies here too: this needs to be wide and tall on desktop, which `Sheet`'s
// 300px drawer was never built for). Ties every sub-feature's panel together behind one tab strip.
import * as React from 'react'
import { useT, useLocale, formatDate, formatTime } from '@devon/i18n'
import { Badge, Button, Dialog, DialogContent, Skeleton, StateView, toast } from '@devon/ui'
import { ExternalLink, Pencil, Ban, Download } from 'lucide-react'
import { ApiError } from '../../../lib/api-client.js'
import { fetchEventIcs } from '../api.js'
import { useEventQuery, useUpdateEventMutation } from '../hooks.js'
import { downloadIcs } from '../lib/ics-download.js'
import { eventFormValuesToUpdateInput } from '../lib/event-form-mapping.js'
import type { EventDto, EventStatus } from '../schemas.js'
import { EventIllustration } from '../illustrations/index.js'
import { CancelDialog } from './cancel-dialog.js'
import { CarpoolPanel } from './carpool-panel.js'
import { CommentsPanel } from './comments-panel.js'
import { EventFormDialog } from './event-form-dialog.js'
import { FeedbackPanel } from './feedback-panel.js'
import { ItemsPanel } from './items-panel.js'
import { PhotosPanel } from './photos-panel.js'
import { PollsPanel } from './polls-panel.js'
import { RsvpPanel } from './rsvp-panel.js'
import { Tabs, type TabItem } from './tabs.js'

const STATUS_TONE: Record<EventStatus, 'neutral' | 'success' | 'warning' | 'destructive' | 'info'> =
  {
    draft: 'neutral',
    open: 'success',
    full: 'warning',
    cancelled: 'destructive',
    done: 'neutral',
  }

function DiffSummary({ event }: { event: EventDto }) {
  const t = useT()
  if (!event.updatedSummary || event.updatedSummary.length === 0) return null
  return (
    <div className="flex flex-col gap-1 rounded-md border border-border bg-muted p-3">
      <p className="text-caption font-medium text-foreground">{t('events.diff.title')}</p>
      <ul className="flex flex-col gap-0.5 text-caption text-muted-foreground">
        {event.updatedSummary.map((change, index) => (
          <li key={index}>
            {t(`events.diff.field.${change.field}`)}: {change.before ?? '—'} → {change.after ?? '—'}
          </li>
        ))}
      </ul>
    </div>
  )
}

function EventHeader({
  event,
  onEdit,
  onCancel,
  onExportIcs,
  exporting,
}: {
  event: EventDto
  onEdit: () => void
  onCancel: () => void
  onExportIcs: () => void
  exporting: boolean
}) {
  const t = useT()
  const locale = useLocale()
  const starts = new Date(event.startsAt)
  const ends = new Date(event.endsAt)
  const sameDay = starts.toDateString() === ends.toDateString()

  return (
    <div className="flex flex-col gap-4">
      <EventIllustration
        illustrationKey={event.illustrationKey}
        category={event.category}
        className="h-36 w-full rounded-md object-cover"
      />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-h3 text-foreground">{event.title}</h2>
            <Badge tone={STATUS_TONE[event.status]}>{t(`events.status.${event.status}`)}</Badge>
          </div>
          <p className="text-small text-muted-foreground">
            {t('events.card.organizer', {
              name: `${event.organizer.givenName} ${event.organizer.familyName}`,
            })}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={onExportIcs} loading={exporting}>
            <Download className="size-3.5" aria-hidden="true" />
            {t('events.ics.exportEvent')}
          </Button>
          {event.canManage && event.status !== 'cancelled' && event.status !== 'done' ? (
            <>
              <Button variant="secondary" size="sm" onClick={onEdit}>
                <Pencil className="size-3.5" aria-hidden="true" />
                {t('events.actions.edit')}
              </Button>
              <Button variant="destructive" size="sm" onClick={onCancel}>
                <Ban className="size-3.5" aria-hidden="true" />
                {t('events.actions.cancelEvent')}
              </Button>
            </>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 text-small text-foreground sm:grid-cols-2">
        <p>
          {sameDay
            ? `${formatDate(starts, locale)} · ${formatTime(starts, locale)}–${formatTime(ends, locale)}`
            : `${formatDate(starts, locale)} ${formatTime(starts, locale)} — ${formatDate(ends, locale)} ${formatTime(ends, locale)}`}
        </p>
        {event.place ? (
          <p className="flex items-center gap-1">
            {event.place}
            {event.placeUrl ? (
              <a
                href={event.placeUrl}
                target="_blank"
                rel="noreferrer"
                className="text-primary hover:underline"
              >
                <ExternalLink className="size-3.5" aria-hidden="true" />
              </a>
            ) : null}
          </p>
        ) : null}
        <p className="text-muted-foreground">
          {event.capacity === null
            ? t('events.card.unlimitedCapacity')
            : t('events.card.capacity', { going: event.goingCount, capacity: event.capacity })}
        </p>
        {event.rsvpDeadline && event.status !== 'cancelled' && event.status !== 'done' ? (
          <p className="text-muted-foreground">
            {t('events.card.deadline', { date: formatDate(new Date(event.rsvpDeadline), locale) })}
          </p>
        ) : null}
        {event.costNote ? <p className="text-muted-foreground">{event.costNote}</p> : null}
      </div>

      {event.status === 'cancelled' ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3">
          <p className="text-small font-medium text-destructive">
            {t('events.card.cancelledBanner')}
          </p>
          {event.cancelledReason ? (
            <p className="text-caption text-destructive">
              {t('events.card.cancelledReason', { reason: event.cancelledReason })}
            </p>
          ) : null}
        </div>
      ) : null}

      {event.description ? (
        <p className="whitespace-pre-wrap text-body text-foreground">{event.description}</p>
      ) : null}

      <DiffSummary event={event} />
    </div>
  )
}

export function EventDetailDialog({
  eventId,
  open,
  onOpenChange,
}: {
  eventId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const t = useT()
  const eventQuery = useEventQuery(eventId)
  const updateMutation = useUpdateEventMutation(eventId)
  const [tab, setTab] = React.useState('rsvp')
  const [editing, setEditing] = React.useState(false)
  const [cancelling, setCancelling] = React.useState(false)
  const [exporting, setExporting] = React.useState(false)

  const handleExportIcs = async () => {
    setExporting(true)
    try {
      const ics = await fetchEventIcs(eventId)
      downloadIcs(ics.filename, ics.content)
    } catch {
      toast(t('events.error.title'))
    } finally {
      setExporting(false)
    }
  }

  const tabs: TabItem[] = [
    { id: 'rsvp', label: t('events.tabs.rsvp') },
    { id: 'carpool', label: t('events.tabs.carpool') },
    { id: 'items', label: t('events.tabs.items') },
    { id: 'polls', label: t('events.tabs.polls') },
    { id: 'comments', label: t('events.tabs.comments') },
    { id: 'photos', label: t('events.tabs.photos') },
    { id: 'feedback', label: t('events.tabs.feedback') },
  ]

  function renderDialogBody() {
    if (eventQuery.isPending) {
      return (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-36 w-full" />
          <Skeleton className="h-6 w-60" />
          <Skeleton className="h-24 w-full" />
        </div>
      )
    }
    if (eventQuery.isError) {
      const code = eventQuery.error instanceof ApiError ? eventQuery.error.code : null
      if (code === 'not_found') {
        return <StateView kind="empty" titleKey="events.error.title" bodyKey="events.error.body" />
      }
      if (code === 'forbidden') {
        return (
          <StateView
            kind="forbidden"
            titleKey="events.forbidden.title"
            bodyKey="events.forbidden.body"
          />
        )
      }
      return (
        <StateView
          kind="error"
          titleKey="events.error.title"
          bodyKey="events.error.body"
          action={{ labelKey: 'events.actions.retry', onAction: () => eventQuery.refetch() }}
        />
      )
    }
    const event = eventQuery.data
    return (
      <div className="mt-2 flex flex-col gap-5">
        <EventHeader
          event={event}
          onEdit={() => setEditing(true)}
          onCancel={() => setCancelling(true)}
          onExportIcs={handleExportIcs}
          exporting={exporting}
        />
        <Tabs items={tabs} value={tab} onChange={setTab} />
        <div>
          {tab === 'rsvp' ? <RsvpPanel event={event} eventId={eventId} /> : null}
          {tab === 'carpool' ? <CarpoolPanel eventId={eventId} /> : null}
          {tab === 'items' ? <ItemsPanel eventId={eventId} /> : null}
          {tab === 'polls' ? <PollsPanel eventId={eventId} /> : null}
          {tab === 'comments' ? <CommentsPanel eventId={eventId} /> : null}
          {tab === 'photos' ? <PhotosPanel eventId={eventId} /> : null}
          {tab === 'feedback' ? <FeedbackPanel eventId={eventId} /> : null}
        </div>
      </div>
    )
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          title={eventQuery.data?.title ?? t('events.title')}
          titleHidden
          className="max-w-180 max-h-[88vh] overflow-y-auto"
        >
          {renderDialogBody()}
        </DialogContent>
      </Dialog>

      {eventQuery.data ? (
        <EventFormDialog
          open={editing}
          onOpenChange={setEditing}
          event={eventQuery.data}
          submitting={updateMutation.isPending}
          onSubmit={async (values) => {
            await updateMutation.mutateAsync(eventFormValuesToUpdateInput(values))
          }}
        />
      ) : null}

      <CancelDialog
        open={cancelling}
        onOpenChange={setCancelling}
        eventId={eventId}
        onCancelled={() => setCancelling(false)}
      />
    </>
  )
}
