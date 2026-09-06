// One event, in the list/calendar (DESIGN.md §3 domain component: "EventCard with RSVP/capacity
// meter"). Purely presentational -- `events-screen.tsx` owns the click-to-open wiring.
import { useT, useLocale, formatDate, formatTime } from '@devon/i18n'
import { Badge } from '@devon/ui'
import { EventIllustration } from '../illustrations/index.js'
import type { EventDto } from '../schemas.js'

const STATUS_TONE: Record<
  EventDto['status'],
  'neutral' | 'success' | 'warning' | 'destructive' | 'info'
> = {
  draft: 'neutral',
  open: 'success',
  full: 'warning',
  cancelled: 'destructive',
  done: 'neutral',
}

export function EventCard({ event, onOpen }: { event: EventDto; onOpen: () => void }) {
  const t = useT()
  const locale = useLocale()
  const starts = new Date(event.startsAt)

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex flex-col overflow-hidden rounded-md border border-border bg-card text-left shadow-1 transition-shadow duration-(--dur-standard) ease-out hover:shadow-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      <EventIllustration
        illustrationKey={event.illustrationKey}
        category={event.category}
        className="h-28 w-full object-cover"
      />
      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-lead font-medium text-foreground">{event.title}</h3>
          <Badge tone={STATUS_TONE[event.status]}>{t(`events.status.${event.status}`)}</Badge>
        </div>
        <p className="text-small text-muted-foreground">
          {formatDate(starts, locale)} · {formatTime(starts, locale)}
          {event.place ? ` · ${event.place}` : ''}
        </p>
        {event.status === 'cancelled' ? (
          <p className="text-small font-medium text-destructive">
            {t('events.card.cancelledBanner')}
          </p>
        ) : (
          <p className="text-small text-muted-foreground">
            {event.capacity === null
              ? t('events.card.unlimitedCapacity')
              : t('events.card.capacity', { going: event.goingCount, capacity: event.capacity })}
          </p>
        )}
        {event.myRsvp ? (
          <p className="text-caption text-muted-foreground">
            {t('events.rsvp.myStatus', { status: t(`events.rsvp.status.${event.myRsvp.status}`) })}
          </p>
        ) : null}
      </div>
    </button>
  )
}
