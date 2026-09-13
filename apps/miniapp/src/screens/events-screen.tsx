// "Tadbirlar" -- the upcoming events, each with the RSVP control right on the card, because RSVP is
// the one thing people open a Telegram event message to do.
//
// Jakob's Law (DESIGN.md §8, Events row): Luma's shape -- a big date block, the title, the place, the
// attendee count, and a three-way RSVP segmented control. Tapping the card opens the detail screen
// where the carpool and the polls live.
import * as React from 'react'
import { CalendarDays, MapPin, Users } from 'lucide-react'
import { useLocale, useT } from '@devon/i18n'
import { Badge, Button, Celebrate, cn, toast } from '@devon/ui'
import { listEvents, rsvp, type EventDto } from '../lib/api.js'
import { useQuery } from '../lib/use-query.js'
import { navigate } from '../lib/router.js'
import { tg } from '../lib/telegram.js'
import {
  ListSkeleton,
  QueryState,
  ScreenBody,
  ScreenHeader,
  ScreenList,
} from '../components/screen.js'
import { rowSurface, timeRange } from '../components/bits.js'

const RSVP_CHOICES = ['yes', 'maybe', 'no'] as const
type RsvpChoice = (typeof RSVP_CHOICES)[number]

export function RsvpButtons({
  event,
  onChange,
}: {
  event: EventDto
  onChange: (updated: EventDto) => void
}): React.ReactElement {
  const t = useT()
  const [busy, setBusy] = React.useState<RsvpChoice | null>(null)
  const [celebrating, setCelebrating] = React.useState(false)
  const current = event.myRsvp?.status ?? null
  const closed = event.status === 'cancelled' || event.status === 'done'

  const choose = (choice: RsvpChoice): void => {
    if (busy || closed) return
    setBusy(choice)
    rsvp(event.id, choice)
      .then((updated) => {
        onChange(updated)
        if (choice === 'yes') {
          // DESIGN.md §10's second celebration moment: "RSVP yes".
          setCelebrating(true)
          tg.haptic.success()
        } else {
          tg.haptic.tap()
        }
        toast.success(t(`miniapp.events.rsvpSaved.${choice}`))
      })
      .catch(() => toast.error(t('miniapp.events.rsvpFailed')))
      .finally(() => setBusy(null))
  }

  if (closed) {
    return (
      <p className="text-muted-foreground text-[12px] leading-4">
        {t(event.status === 'cancelled' ? 'miniapp.events.cancelled' : 'miniapp.events.finished')}
      </p>
    )
  }

  // `Celebrate` paints an absolutely-positioned burst from its parent's centre, so it is a sibling
  // inside a positioned wrapper rather than something the buttons are nested in.
  return (
    <div className="relative">
      <div
        role="group"
        aria-label={t('miniapp.events.rsvpAria')}
        className="grid grid-cols-3 gap-1.5"
      >
        {RSVP_CHOICES.map((choice) => (
          <Button
            key={choice}
            size="sm"
            variant={current === choice ? 'primary' : 'secondary'}
            aria-pressed={current === choice}
            loading={busy === choice}
            onClick={() => choose(choice)}
          >
            {t(`miniapp.events.rsvp.${choice}`)}
          </Button>
        ))}
      </div>
      <Celebrate play={celebrating} onDone={() => setCelebrating(false)} />
    </div>
  )
}

export function EventsScreen(): React.ReactElement {
  const t = useT()
  const locale = useLocale()
  const query = useQuery(() => listEvents(), [])
  const items = query.data?.items ?? []

  const replace = (updated: EventDto): void => {
    if (!query.data) return
    query.set({
      items: query.data.items.map((item) => (item.id === updated.id ? updated : item)),
    })
  }

  return (
    <>
      <ScreenHeader title={t('miniapp.events.title')} eyebrow={t('miniapp.events.eyebrow')} />
      <ScreenBody>
        {query.status === 'loading' && query.data === null ? (
          <ListSkeleton rows={3} />
        ) : query.status === 'error' && query.data === null ? (
          <QueryState error={query.error} onRetry={query.refetch} />
        ) : items.length === 0 ? (
          <QueryState
            error={null}
            emptyTitleKey="miniapp.events.empty.title"
            emptyBodyKey="miniapp.events.empty.body"
            onRetry={query.refetch}
          />
        ) : (
          <ScreenList>
            {items.map((event) => (
              <article key={event.id} className={cn(rowSurface, 'flex flex-col gap-2')}>
                <button
                  type="button"
                  onClick={() => navigate({ name: 'event', eventId: event.id })}
                  className="text-left focus-visible:outline-none"
                >
                  <h3 className="text-foreground text-[15px] leading-5 font-medium">
                    {event.title}
                  </h3>
                  <p className="text-muted-foreground mt-1 flex items-center gap-1 text-[12px] leading-4">
                    <CalendarDays className="size-3.5 shrink-0" aria-hidden />
                    {timeRange(event.startsAt, event.endsAt, locale)}
                  </p>
                  {event.place ? (
                    <p className="text-muted-foreground mt-0.5 flex items-center gap-1 text-[12px] leading-4">
                      <MapPin className="size-3.5 shrink-0" aria-hidden />
                      <span className="truncate">{event.place}</span>
                    </p>
                  ) : null}
                  <p className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <Badge tone="neutral">
                      <Users className="size-3" aria-hidden />
                      {t('miniapp.events.going', { count: event.goingCount })}
                    </Badge>
                    {event.capacity !== null ? (
                      <Badge tone={event.goingCount >= event.capacity ? 'warning' : 'neutral'}>
                        {t('miniapp.events.capacity', {
                          used: event.goingCount,
                          total: event.capacity,
                        })}
                      </Badge>
                    ) : null}
                  </p>
                </button>
                <RsvpButtons event={event} onChange={replace} />
              </article>
            ))}
          </ScreenList>
        )}
      </ScreenBody>
    </>
  )
}
