// One event, in the list/calendar (DESIGN.md §3 domain component: "EventCard with RSVP/capacity
// meter"; UI-OVERHAUL.md "Events to Luma quality"). Purely presentational -- `events-screen.tsx`
// owns the click-to-open wiring. The big date block sitting on the cover, and a capacity meter
// instead of a plain fraction, are the two things that make this read as an invitation rather than a
// row in a table (Luma, Meetup).
import { useT, useLocale, formatTime, formatMonthShort, type Locale } from '@devon/i18n'
import { Badge, HoverLift, Progress } from '@devon/ui'
import { EventIllustration } from '../illustrations/index.js'
import type { EventDto } from '../schemas.js'

const STATUS_TONE: Record<
  EventDto['status'],
  'neutral' | 'success' | 'warning' | 'destructive' | 'info'
> = {
  // DESIGN.md §2.1: green stays strictly the meaning of success/done/approved -- an open event is
  // merely available to RSVP to, not an accomplishment, so it reads as `info` (blue), not `success`.
  draft: 'neutral',
  open: 'info',
  full: 'warning',
  cancelled: 'destructive',
  done: 'neutral',
}

/** The date block Luma and Google Calendar invites both use: month abbreviation over a big day
 * number. A `<time>` so the two lines still read as one date to assistive tech. `formatMonthShort`
 * (not raw `Intl.DateTimeFormat`) for the same reason `events-screen.tsx`'s month grouping does --
 * verified live against a real reduced-ICU embedded browser rendering `uz-Latn` short months as the
 * bare numeric fallback ("M08") instead of a word. */
function DateBlock({ date, locale }: { date: Date; locale: Locale }) {
  const month = formatMonthShort(date, locale)
  return (
    <time
      dateTime={date.toISOString()}
      className="flex w-14 shrink-0 flex-col items-center overflow-hidden rounded-sm border border-border bg-card shadow-1"
    >
      <span className="w-full bg-destructive py-0.5 text-center text-caption font-medium uppercase tracking-wide text-destructive-foreground">
        {month}
      </span>
      <span className="py-1 font-display text-h3 leading-none text-foreground">
        {date.getDate()}
      </span>
    </time>
  )
}

export function EventCard({ event, onOpen }: { event: EventDto; onOpen: () => void }) {
  const t = useT()
  const locale = useLocale()
  const starts = new Date(event.startsAt)
  const capacity = event.capacity
  const spotsPct =
    capacity !== null && capacity > 0
      ? Math.min(100, Math.round((event.goingCount / capacity) * 100))
      : null

  function renderAvailability() {
    if (event.status === 'cancelled') {
      return (
        <p className="text-small font-medium text-destructive">
          {t('events.card.cancelledBanner')}
        </p>
      )
    }
    if (spotsPct !== null && capacity !== null) {
      return (
        <div className="mt-1 flex flex-col gap-1">
          <Progress
            value={spotsPct}
            size="sm"
            tone={spotsPct >= 100 ? 'warning' : 'primary'}
            label={t('events.card.capacity', { going: event.goingCount, capacity })}
          />
          <p className="text-caption text-muted-foreground">
            {t('events.card.capacity', { going: event.goingCount, capacity })}
          </p>
        </div>
      )
    }
    return (
      <p className="text-small text-muted-foreground">
        {event.goingCount > 0
          ? t('events.card.going', { count: event.goingCount })
          : t('events.card.unlimitedCapacity')}
      </p>
    )
  }

  return (
    <HoverLift className="h-full">
      <button
        type="button"
        onClick={onOpen}
        className="group flex h-full w-full flex-col overflow-hidden rounded-md border border-border bg-card text-left shadow-1 transition-shadow duration-(--dur-standard) ease-out hover:shadow-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        <div className="relative aspect-video w-full overflow-hidden">
          <EventIllustration
            illustrationKey={event.illustrationKey}
            category={event.category}
            eventId={event.id}
            className="size-full object-cover"
          />
          {/* A soft top scrim, not the illustration's own colour: the date block and status pill
              need to stay readable regardless of which of the four look variants (illustrations/
              index.tsx) or which illustration this event landed on. */}
          <div
            aria-hidden="true"
            className="absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-foreground/40 to-transparent"
          />
          <div className="absolute left-3 top-3">
            <DateBlock date={starts} locale={locale} />
          </div>
          <div className="absolute right-3 top-3">
            <Badge tone={STATUS_TONE[event.status]}>{t(`events.status.${event.status}`)}</Badge>
          </div>
        </div>
        <div className="flex flex-1 flex-col gap-2 p-4">
          <h3 className="text-lead font-medium text-foreground">{event.title}</h3>
          <p className="text-small text-muted-foreground">
            {formatTime(starts, locale)}
            {event.place ? ` · ${event.place}` : ''}
          </p>
          {renderAvailability()}
          {event.myRsvp ? (
            <p className="mt-auto pt-1 text-caption text-muted-foreground">
              {t('events.rsvp.myStatus', {
                status: t(`events.rsvp.status.${event.myRsvp.status}`),
              })}
            </p>
          ) : null}
        </div>
      </button>
    </HoverLift>
  )
}
