// Carpooling (TECH-SPEC §3.4: "driver offers seats + departure point/time; colleagues claim;
// waitlist when full"). `carpool.canManage` already folds in "I'm the driver, or I'm the head" --
// this panel never re-derives that.
import * as React from 'react'
import { useT, useLocale, formatDate, formatTime } from '@devon/i18n'
import {
  Avatar,
  Badge,
  Button,
  Celebrate,
  Input,
  Skeleton,
  StateView,
  initialsFromName,
  toast,
  useCelebrate,
} from '@devon/ui'
import { useSession } from '../../../lib/session.js'
import {
  useCarpoolsQuery,
  useClaimCarpoolSeatMutation,
  useCreateCarpoolMutation,
  useReleaseCarpoolSeatMutation,
} from '../hooks.js'
import type { CarpoolDto } from '../schemas.js'
import { Field, Textarea } from './form-controls.js'

function CarpoolCard({ eventId, carpool }: { eventId: string; carpool: CarpoolDto }) {
  const t = useT()
  const locale = useLocale()
  const { user } = useSession()
  const claimMutation = useClaimCarpoolSeatMutation(eventId)
  const releaseMutation = useReleaseCarpoolSeatMutation(eventId)

  const isDriver = user?.id === carpool.driver.id
  const myShare = carpool.passengers.find((p) => p.userId === user?.id)
  const full = carpool.seatsClaimed >= carpool.seats
  const cancelled = carpool.status === 'cancelled'
  const celebrate = useCelebrate()

  const handleClaim = async () => {
    try {
      await claimMutation.mutateAsync({ carpoolId: carpool.id, seats: 1 })
      if (!full) celebrate.fire()
    } catch {
      toast(t('events.error.title'))
    }
  }

  const handleRelease = async () => {
    try {
      await releaseMutation.mutateAsync(carpool.id)
    } catch {
      toast(t('events.error.title'))
    }
  }

  return (
    <li className="flex flex-col gap-3 rounded-md border border-border p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Avatar
            alt={`${carpool.driver.givenName} ${carpool.driver.familyName}`}
            initials={initialsFromName(carpool.driver.givenName, carpool.driver.familyName)}
            hueSeed={carpool.driver.id}
            size="sm"
          />
          <span className="text-small font-medium text-foreground">
            {t('events.carpool.driver', {
              name: `${carpool.driver.givenName} ${carpool.driver.familyName}`,
            })}
          </span>
        </div>
        {cancelled ? (
          <Badge tone="destructive">{t('events.carpool.cancelled')}</Badge>
        ) : (
          <Badge tone={full ? 'warning' : 'success'}>
            {t('events.carpool.seatsTaken', {
              claimed: carpool.seatsClaimed,
              seats: carpool.seats,
            })}
          </Badge>
        )}
      </div>
      <div className="flex flex-col gap-1 text-small text-muted-foreground">
        {carpool.departurePlace ? <p>{carpool.departurePlace}</p> : null}
        {carpool.departureAt ? (
          <p>
            {formatDate(new Date(carpool.departureAt), locale)} ·{' '}
            {formatTime(new Date(carpool.departureAt), locale)}
          </p>
        ) : null}
        {carpool.note ? <p>{carpool.note}</p> : null}
      </div>
      {carpool.passengers.length > 0 ? (
        <div className="flex flex-col gap-1">
          <p className="text-caption font-medium text-muted-foreground">
            {t('events.carpool.passengers')}
          </p>
          <ul className="flex flex-wrap gap-2">
            {carpool.passengers.map((p) => (
              <li key={p.userId} className="flex items-center gap-1.5">
                <Avatar
                  alt={`${p.givenName} ${p.familyName}`}
                  initials={initialsFromName(p.givenName, p.familyName)}
                  hueSeed={p.userId}
                  size="sm"
                />
                <span className="text-caption text-foreground">
                  {p.givenName} {p.familyName}
                </span>
                {p.status === 'waitlist' ? (
                  <Badge tone="warning">{t('events.carpool.waitlisted')}</Badge>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {!cancelled ? renderActionArea() : null}
    </li>
  )

  function renderActionArea() {
    if (isDriver) {
      return (
        <p className="text-caption text-muted-foreground">
          {t('events.carpool.driverCannotClaim')}
        </p>
      )
    }
    if (myShare) {
      return (
        <div className="flex items-center justify-between">
          <Badge tone={myShare.status === 'waitlist' ? 'warning' : 'success'}>
            {t(
              myShare.status === 'waitlist'
                ? 'events.carpool.waitlisted'
                : 'events.carpool.confirmed',
            )}
          </Badge>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleRelease}
            loading={releaseMutation.isPending}
          >
            {t('events.carpool.release')}
          </Button>
        </div>
      )
    }
    return (
      <div className="flex justify-end">
        <Button
          size="sm"
          className="relative"
          onClick={handleClaim}
          loading={claimMutation.isPending}
        >
          {t('events.carpool.claim')}
          <Celebrate play={celebrate.play} onDone={celebrate.onDone} />
        </Button>
      </div>
    )
  }
}

export function CarpoolPanel({ eventId }: { eventId: string }) {
  const t = useT()
  const carpoolsQuery = useCarpoolsQuery(eventId, true)
  const createMutation = useCreateCarpoolMutation(eventId)
  const [showForm, setShowForm] = React.useState(false)
  const [seats, setSeats] = React.useState('3')
  const [departurePlace, setDeparturePlace] = React.useState('')
  const [departureAt, setDepartureAt] = React.useState('')
  const [note, setNote] = React.useState('')

  const handleOffer = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await createMutation.mutateAsync({
        seats: Number(seats) || 1,
        departurePlace: departurePlace.trim() || undefined,
        departureAt: departureAt ? new Date(departureAt).toISOString() : undefined,
        note: note.trim() || undefined,
      })
      setShowForm(false)
      setSeats('3')
      setDeparturePlace('')
      setDepartureAt('')
      setNote('')
    } catch {
      toast(t('events.error.title'))
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button variant="secondary" size="sm" onClick={() => setShowForm((v) => !v)}>
          {t('events.carpool.offer')}
        </Button>
      </div>

      {showForm ? (
        <form
          onSubmit={handleOffer}
          className="flex flex-col gap-3 rounded-md border border-border p-4"
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('events.carpool.seatsLabel')} htmlFor="carpool-seats">
              <Input
                id="carpool-seats"
                type="number"
                min={1}
                value={seats}
                onChange={(e) => setSeats(e.target.value)}
              />
            </Field>
            <Field label={t('events.carpool.departureAtLabel')} htmlFor="carpool-departure-at">
              <Input
                id="carpool-departure-at"
                type="datetime-local"
                value={departureAt}
                onChange={(e) => setDepartureAt(e.target.value)}
              />
            </Field>
          </div>
          <Field label={t('events.carpool.departurePlaceLabel')} htmlFor="carpool-departure-place">
            <Input
              id="carpool-departure-place"
              value={departurePlace}
              onChange={(e) => setDeparturePlace(e.target.value)}
            />
          </Field>
          <Field label={t('events.carpool.noteLabel')} htmlFor="carpool-note">
            <Textarea
              id="carpool-note"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
          <div className="flex justify-end">
            <Button type="submit" loading={createMutation.isPending}>
              {t('events.carpool.offer')}
            </Button>
          </div>
        </form>
      ) : null}

      {renderCarpoolsBody()}
    </div>
  )

  function renderCarpoolsBody() {
    if (carpoolsQuery.isPending) return <Skeleton className="h-32 w-full" />
    if (carpoolsQuery.isError) {
      return <StateView kind="error" titleKey="events.error.title" bodyKey="events.error.body" />
    }
    if (carpoolsQuery.data.items.length === 0) {
      return <p className="text-small text-muted-foreground">{t('events.carpool.empty')}</p>
    }
    return (
      <ul className="flex flex-col gap-3">
        {carpoolsQuery.data.items.map((carpool) => (
          <CarpoolCard key={carpool.id} eventId={eventId} carpool={carpool} />
        ))}
      </ul>
    )
  }
}
