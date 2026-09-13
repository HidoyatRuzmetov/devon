// One event: RSVP, carpool seats and polls -- the three things a person does from their phone on the
// way to a departmental event, and exactly the three the bot's message links to.
import * as React from 'react'
import { Car, CalendarDays, MapPin } from 'lucide-react'
import { useLocale, useT } from '@devon/i18n'
import { Badge, Button, Progress, cn, toast } from '@devon/ui'
import {
  claimCarpoolSeat,
  listCarpools,
  listEvents,
  listPolls,
  releaseCarpoolSeat,
  voteOnPoll,
  type EventDto,
  type Poll,
} from '../lib/api.js'
import { useQuery } from '../lib/use-query.js'
import { useSession } from '../lib/session.js'
import { tg } from '../lib/telegram.js'
import {
  ListSkeleton,
  QueryState,
  ScreenBody,
  ScreenHeader,
  ScreenList,
} from '../components/screen.js'
import { SectionLabel, personName, rowSurface, timeRange } from '../components/bits.js'
import { RsvpButtons } from './events-screen.js'

function PollCard({
  eventId,
  poll,
  onChange,
}: {
  eventId: string
  poll: Poll
  onChange: (updated: Poll) => void
}): React.ReactElement {
  const t = useT()
  const [busy, setBusy] = React.useState<string | null>(null)
  const closed = poll.status === 'closed'

  const vote = (optionId: string): void => {
    if (busy || closed) return
    setBusy(optionId)
    voteOnPoll(eventId, poll.id, [optionId])
      .then((updated) => {
        onChange(updated)
        tg.haptic.success()
        toast.success(t('miniapp.polls.voted'))
      })
      .catch(() => toast.error(t('miniapp.polls.voteFailed')))
      .finally(() => setBusy(null))
  }

  return (
    <section className="border-border bg-card shadow-1 flex flex-col gap-2 rounded-md border p-3">
      <div className="flex items-start gap-2">
        <h3 className="flex-1 text-[14px] leading-5 font-medium">{poll.question}</h3>
        {closed ? <Badge tone="neutral">{t('miniapp.polls.closed')}</Badge> : null}
      </div>
      {poll.anonymous ? (
        <p className="text-muted-foreground text-[12px] leading-4">
          {t('miniapp.polls.anonymous')}
        </p>
      ) : null}
      <ul className="flex flex-col gap-2">
        {poll.options.map((option) => {
          const share = poll.totalVotes > 0 ? (option.votes / poll.totalVotes) * 100 : 0
          return (
            <li key={option.id} className="flex flex-col gap-1">
              <button
                type="button"
                disabled={closed || busy !== null}
                onClick={() => vote(option.id)}
                className={cn(
                  'flex items-center gap-2 rounded-sm px-2 py-2 text-left',
                  'transition-colors duration-(--dur-micro)',
                  'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
                  option.votedByMe ? 'bg-accent text-accent-foreground' : 'hover:bg-muted',
                  closed ? 'cursor-default' : '',
                )}
                aria-pressed={option.votedByMe}
              >
                <span className="min-w-0 flex-1 text-[13px] leading-5">{option.label}</span>
                <span className="text-muted-foreground shrink-0 text-[12px] tabular-nums">
                  {option.votes}
                </span>
              </button>
              <Progress
                value={share}
                label={t('miniapp.polls.shareAria', { option: option.label })}
                className="h-1"
              />
            </li>
          )
        })}
      </ul>
      <p className="text-muted-foreground text-[12px] leading-4">
        {t('miniapp.polls.total', { count: poll.totalVotes })}
      </p>
    </section>
  )
}

export function EventScreen({ eventId }: { eventId: string }): React.ReactElement {
  const t = useT()
  const locale = useLocale()
  const session = useSession()
  const events = useQuery(() => listEvents(), [])
  const carpools = useQuery(() => listCarpools(eventId), [eventId])
  const polls = useQuery(() => listPolls(eventId), [eventId])
  const [seatBusy, setSeatBusy] = React.useState<string | null>(null)

  const event: EventDto | undefined = events.data?.items.find((item) => item.id === eventId)

  const replaceEvent = (updated: EventDto): void => {
    if (!events.data) return
    events.set({
      items: events.data.items.map((item) => (item.id === updated.id ? updated : item)),
    })
  }

  const toggleSeat = (carpoolId: string, claimed: boolean): void => {
    setSeatBusy(carpoolId)
    const action = claimed
      ? releaseCarpoolSeat(eventId, carpoolId)
      : claimCarpoolSeat(eventId, carpoolId, 1)
    action
      .then(() => {
        tg.haptic.success()
        toast.success(t(claimed ? 'miniapp.carpool.released' : 'miniapp.carpool.claimed'))
        carpools.refetch()
      })
      .catch(() => toast.error(t('miniapp.carpool.failed')))
      .finally(() => setSeatBusy(null))
  }

  return (
    <>
      <ScreenHeader
        title={event?.title ?? t('miniapp.events.one')}
        eyebrow={t('miniapp.events.eyebrow')}
        onBack="history"
      />
      <ScreenBody>
        {events.status === 'loading' && events.data === null ? (
          <ListSkeleton rows={3} />
        ) : !event ? (
          <QueryState
            error={events.error}
            emptyTitleKey="miniapp.events.missing.title"
            emptyBodyKey="miniapp.events.missing.body"
            onRetry={events.refetch}
          />
        ) : (
          <>
            <section className="border-border bg-card shadow-1 mb-3 flex flex-col gap-2 rounded-md border p-3">
              <p className="text-muted-foreground flex items-center gap-1 text-[12px] leading-4">
                <CalendarDays className="size-3.5 shrink-0" aria-hidden />
                {timeRange(event.startsAt, event.endsAt, locale)}
              </p>
              {event.place ? (
                <p className="text-muted-foreground flex items-center gap-1 text-[12px] leading-4">
                  <MapPin className="size-3.5 shrink-0" aria-hidden />
                  {event.place}
                </p>
              ) : null}
              {event.description ? (
                <p className="text-foreground text-[13px] leading-5 whitespace-pre-wrap">
                  {event.description}
                </p>
              ) : null}
              <p className="text-muted-foreground text-[12px] leading-4">
                {t('miniapp.events.organizer', { name: personName(event.organizer) })}
              </p>
              <RsvpButtons event={event} onChange={replaceEvent} />
            </section>

            <SectionLabel>{t('miniapp.carpool.title')}</SectionLabel>
            {carpools.status === 'loading' && carpools.data === null ? (
              <ListSkeleton rows={1} />
            ) : (carpools.data?.items.length ?? 0) === 0 ? (
              <p className="text-muted-foreground mb-2 text-[13px] leading-5">
                {t('miniapp.carpool.empty')}
              </p>
            ) : (
              <ScreenList className="mb-2">
                {(carpools.data?.items ?? []).map((carpool) => {
                  const mine = carpool.passengers.some(
                    (passenger) => passenger.userId === session.user.id,
                  )
                  const remaining = Math.max(0, carpool.seats - carpool.seatsClaimed)
                  return (
                    <div key={carpool.id} className={cn(rowSurface, 'flex flex-col gap-2')}>
                      <div className="flex items-start gap-2">
                        <Car className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
                        <div className="min-w-0 flex-1">
                          <p className="text-[14px] leading-5 font-medium">
                            {personName(carpool.driver)}
                          </p>
                          <p className="text-muted-foreground text-[12px] leading-4">
                            {[
                              carpool.departurePlace,
                              carpool.departureAt
                                ? timeRange(carpool.departureAt, carpool.departureAt, locale)
                                : null,
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </p>
                        </div>
                        <Badge tone={remaining > 0 ? 'neutral' : 'warning'}>
                          {t('miniapp.carpool.seats', {
                            free: remaining,
                            total: carpool.seats,
                          })}
                        </Badge>
                      </div>
                      {carpool.status === 'open' && !carpool.canManage ? (
                        <Button
                          size="sm"
                          variant={mine ? 'secondary' : 'primary'}
                          loading={seatBusy === carpool.id}
                          disabled={!mine && remaining === 0}
                          onClick={() => toggleSeat(carpool.id, mine)}
                        >
                          {t(mine ? 'miniapp.carpool.release' : 'miniapp.carpool.claim')}
                        </Button>
                      ) : null}
                    </div>
                  )
                })}
              </ScreenList>
            )}

            <SectionLabel>{t('miniapp.polls.title')}</SectionLabel>
            {polls.status === 'loading' && polls.data === null ? (
              <ListSkeleton rows={1} />
            ) : (polls.data?.items.length ?? 0) === 0 ? (
              <p className="text-muted-foreground text-[13px] leading-5">
                {t('miniapp.polls.empty')}
              </p>
            ) : (
              <ScreenList>
                {(polls.data?.items ?? []).map((poll) => (
                  <PollCard
                    key={poll.id}
                    eventId={eventId}
                    poll={poll}
                    onChange={(updated) => {
                      if (!polls.data) return
                      polls.set({
                        items: polls.data.items.map((item) =>
                          item.id === updated.id ? updated : item,
                        ),
                      })
                    }}
                  />
                ))}
              </ScreenList>
            )}
          </>
        )}
      </ScreenBody>
    </>
  )
}
