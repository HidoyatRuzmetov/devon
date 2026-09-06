// The "Are you going?" form plus the attendee list (TECH-SPEC §3.4: "change or cancel any time
// before the deadline"). One panel because the two are the same mental unit for a viewer: "who's
// coming, and where do I stand".
import * as React from 'react'
import { useT } from '@devon/i18n'
import { Avatar, Button, Skeleton, StateView, cn, initialsFromName, toast } from '@devon/ui'
import type { EventDto, RsvpDto, RsvpStatus } from '../schemas.js'
import { useRsvpMutation, useRsvpsQuery } from '../hooks.js'
import { Field, Textarea } from './form-controls.js'

const STATUS_ORDER: RsvpStatus[] = ['yes', 'maybe', 'waitlist']

function AttendeeRow({ rsvp }: { rsvp: RsvpDto }) {
  const t = useT()
  return (
    <li className="flex items-center gap-3 py-2">
      <Avatar
        alt={`${rsvp.givenName} ${rsvp.familyName}`}
        initials={initialsFromName(rsvp.givenName, rsvp.familyName)}
        hueSeed={rsvp.userId}
        size="sm"
      />
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-small font-medium text-foreground">
          {rsvp.givenName} {rsvp.familyName}
        </span>
        {rsvp.guests > 0 ? (
          <span className="text-caption text-muted-foreground">
            {t('events.attendees.guestsSuffix', { count: rsvp.guests })}
          </span>
        ) : null}
      </div>
    </li>
  )
}

export function RsvpPanel({ event, eventId }: { event: EventDto; eventId: string }) {
  const t = useT()
  const rsvpQuery = useRsvpsQuery(eventId, true)
  const mutation = useRsvpMutation(eventId)

  const [status, setStatus] = React.useState<RsvpStatus>(event.myRsvp?.status ?? 'yes')
  const [guests, setGuests] = React.useState(event.myRsvp?.guests ?? 0)
  const [note, setNote] = React.useState(event.myRsvp?.note ?? '')

  React.useEffect(() => {
    setStatus(event.myRsvp?.status ?? 'yes')
    setGuests(event.myRsvp?.guests ?? 0)
    setNote(event.myRsvp?.note ?? '')
  }, [event.myRsvp])

  const deadlinePassed = event.rsvpDeadline !== null && new Date(event.rsvpDeadline) < new Date()
  const eventClosed = event.status === 'cancelled' || event.status === 'done'
  const canChangeToGoing = !deadlinePassed && !eventClosed

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const updated = await mutation.mutateAsync({
        status,
        guests: status === 'yes' ? guests : 0,
        note: note.trim() ? note.trim() : undefined,
      })
      toast(
        t(
          updated.myRsvp?.status === 'waitlist'
            ? 'events.rsvp.waitlistedToast'
            : 'events.rsvp.confirmedToast',
        ),
      )
    } catch {
      toast(t('events.error.title'))
    }
  }

  const attendeesByStatus = React.useMemo(() => {
    const map = new Map<RsvpStatus, RsvpDto[]>()
    for (const rsvp of rsvpQuery.data?.items ?? []) {
      const list = map.get(rsvp.status) ?? []
      list.push(rsvp)
      map.set(rsvp.status, list)
    }
    return map
  }, [rsvpQuery.data])

  const totalAttendees = rsvpQuery.data?.items.filter((r) => r.status !== 'no').length ?? 0

  let attendeesBody: React.ReactNode
  if (rsvpQuery.isPending) {
    attendeesBody = (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    )
  } else if (rsvpQuery.isError) {
    attendeesBody = (
      <StateView kind="error" titleKey="events.error.title" bodyKey="events.error.body" />
    )
  } else if (totalAttendees === 0) {
    attendeesBody = (
      <p className="text-small text-muted-foreground">{t('events.attendees.empty')}</p>
    )
  } else {
    attendeesBody = (
      <ul className="divide-y divide-border">
        {STATUS_ORDER.flatMap((s) => attendeesByStatus.get(s) ?? []).map((rsvp) => (
          <AttendeeRow key={rsvp.userId} rsvp={rsvp} />
        ))}
      </ul>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {!eventClosed ? (
        <form
          onSubmit={handleSubmit}
          className="flex flex-col gap-4 rounded-md border border-border p-4"
        >
          <p className="text-small font-medium text-foreground">{t('events.rsvp.title')}</p>
          <div className="flex flex-wrap gap-2">
            {(['yes', 'maybe', 'no'] as const).map((s) => (
              <button
                key={s}
                type="button"
                disabled={s !== 'no' && !canChangeToGoing}
                onClick={() => setStatus(s)}
                className={cn(
                  'rounded-full border px-4 py-2 text-small font-medium transition-colors',
                  'duration-(--dur-micro) ease-out disabled:cursor-not-allowed disabled:opacity-40',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                  status === s
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-card text-foreground hover:bg-accent',
                )}
              >
                {t(`events.rsvp.status.${s}`)}
              </button>
            ))}
          </div>
          {deadlinePassed ? (
            <p className="text-caption text-warning-foreground">
              {t('events.rsvp.deadlinePassed')}
            </p>
          ) : null}
          {status === 'yes' ? (
            <Field label={t('events.rsvp.guestsLabel')} htmlFor="rsvp-guests">
              <div className="flex items-center gap-3">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setGuests((g) => Math.max(0, g - 1))}
                  aria-label="-"
                >
                  −
                </Button>
                <span className="w-6 text-center text-body text-foreground">{guests}</span>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setGuests((g) => Math.min(9, g + 1))}
                  aria-label="+"
                >
                  +
                </Button>
              </div>
            </Field>
          ) : null}
          <Field label={t('events.rsvp.noteLabel')} htmlFor="rsvp-note">
            <Textarea
              id="rsvp-note"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t('events.rsvp.notePlaceholder')}
              maxLength={500}
            />
          </Field>
          <div className="flex justify-end">
            <Button type="submit" loading={mutation.isPending}>
              {t(event.myRsvp ? 'events.rsvp.update' : 'events.rsvp.submit')}
            </Button>
          </div>
        </form>
      ) : null}

      <div>
        <p className="mb-2 text-small font-medium text-foreground">
          {totalAttendees > 0
            ? t('events.attendees.titleCount', { count: totalAttendees })
            : t('events.attendees.title')}
        </p>
        {attendeesBody}
      </div>
    </div>
  )
}
