import * as React from 'react'
import { useT, useLocale, formatDate, formatTime } from '@devon/i18n'
import {
  Avatar,
  Badge,
  Button,
  Celebrate,
  Dialog,
  DialogContent,
  Field,
  IconButton,
  Input,
  Skeleton,
  StateView,
  Textarea,
  initialsFromName,
  toast,
  useCelebrate,
} from '@devon/ui'
import { Pencil, Trash2 } from 'lucide-react'
import { ApiError } from '../../../lib/api-client.js'
import { avatarUrl } from '../../../lib/avatar.js'
import { useSession } from '../../../lib/session.js'
import {
  useCarpoolsQuery,
  useClaimCarpoolSeatMutation,
  useCreateCarpoolMutation,
  useDeleteCarpoolMutation,
  useReleaseCarpoolSeatMutation,
  useUpdateCarpoolMutation,
} from '../hooks.js'
import { toLocalInputValue } from '../lib/event-form-mapping.js'
import type { CarpoolDto } from '../schemas.js'
import { useEventUndo } from './event-undo.js'

const CONFLICT_MESSAGES: Record<string, string> = {
  driver_already_offering: 'events.carpool.alreadyDriver',
  driver_cannot_be_passenger: 'events.carpool.alreadyDriver',
  passenger_already_booked: 'events.carpool.alreadyPassenger',
  carpool_capacity_below_claimed: 'events.carpool.capacityBelowClaimed',
  carpool_has_passengers: 'events.carpool.deleteNeedsEmpty',
  carpool_claim_exceeds_capacity: 'events.carpool.seatUnavailable',
  carpool_claim_capacity_unavailable: 'events.carpool.seatUnavailable',
  carpool_cancelled: 'events.carpool.cancelled',
  event_not_open: 'events.carpool.eventClosed',
}

function carpoolErrorKey(error: unknown): string {
  if (error instanceof ApiError) {
    const reason = error.errors.find((item) => item.path === 'carpool')?.code
    if (reason && CONFLICT_MESSAGES[reason]) return CONFLICT_MESSAGES[reason]
  }
  return 'events.carpool.saveFailed'
}

type RideDraft = { seats: string; departurePlace: string; departureAt: string; note: string }
const EMPTY_DRAFT: RideDraft = { seats: '3', departurePlace: '', departureAt: '', note: '' }

function CarpoolForm({
  initial,
  pending,
  onSave,
  onCancel,
}: {
  initial?: CarpoolDto | undefined
  pending: boolean
  onSave: (draft: RideDraft) => Promise<void>
  onCancel: () => void
}) {
  const t = useT()
  const [draft, setDraft] = React.useState<RideDraft>(() =>
    initial
      ? {
          seats: String(initial.seats),
          departurePlace: initial.departurePlace ?? '',
          departureAt: toLocalInputValue(initial.departureAt),
          note: initial.note ?? '',
        }
      : EMPTY_DRAFT,
  )
  const [error, setError] = React.useState<string | null>(null)
  const inFlight = React.useRef(false)
  const id = React.useId()
  const set = (field: keyof RideDraft, value: string) =>
    setDraft((old) => ({ ...old, [field]: value }))
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={async (event) => {
        event.preventDefault()
        if (pending || inFlight.current) return
        inFlight.current = true
        setError(null)
        try {
          await onSave(draft)
        } catch (failure) {
          setError(carpoolErrorKey(failure))
        } finally {
          inFlight.current = false
        }
      }}
    >
      <fieldset disabled={pending} className="flex min-w-0 flex-col gap-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t('events.carpool.seatsLabel')} htmlFor={`${id}-seats`}>
            <Input
              id={`${id}-seats`}
              type="number"
              min={Math.max(1, initial?.seatsClaimed ?? 0)}
              max={20}
              step={1}
              required
              value={draft.seats}
              onChange={(e) => set('seats', e.target.value)}
            />
          </Field>
          <Field label={t('events.carpool.departureAtLabel')} htmlFor={`${id}-departure-at`}>
            <Input
              id={`${id}-departure-at`}
              type="datetime-local"
              value={draft.departureAt}
              onChange={(e) => set('departureAt', e.target.value)}
            />
          </Field>
        </div>
        <Field label={t('events.carpool.departurePlaceLabel')} htmlFor={`${id}-departure-place`}>
          <Input
            id={`${id}-departure-place`}
            maxLength={300}
            value={draft.departurePlace}
            onChange={(e) => set('departurePlace', e.target.value)}
          />
        </Field>
        <Field label={t('events.carpool.noteLabel')} htmlFor={`${id}-note`}>
          <Textarea
            id={`${id}-note`}
            rows={2}
            maxLength={500}
            value={draft.note}
            onChange={(e) => set('note', e.target.value)}
          />
        </Field>
      </fieldset>
      {error ? (
        <p role="alert" className="text-small text-destructive">
          {t(error)}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" disabled={pending} onClick={onCancel}>
          {t('events.actions.close')}
        </Button>
        <Button type="submit" loading={pending}>
          {t(initial ? 'events.actions.save' : 'events.carpool.offer')}
        </Button>
      </div>
    </form>
  )
}

function CarpoolCard({
  eventId,
  carpool,
  participationBlocked,
  eventClosed,
}: {
  eventId: string
  carpool: CarpoolDto
  participationBlocked: string | null
  eventClosed: boolean
}) {
  const t = useT()
  const locale = useLocale()
  const { user } = useSession()
  const claim = useClaimCarpoolSeatMutation(eventId)
  const release = useReleaseCarpoolSeatMutation(eventId)
  const update = useUpdateCarpoolMutation(eventId)
  const remove = useDeleteCarpoolMutation(eventId)
  const undo = useEventUndo()
  const [editing, setEditing] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)
  const [deleteError, setDeleteError] = React.useState<string | null>(null)
  const isDriver = user?.id === carpool.driver.id
  const myShare = carpool.passengers.find((p) => p.userId === user?.id)
  const full = carpool.seatsClaimed >= carpool.seats
  const cancelled = carpool.status === 'cancelled'
  const busy = claim.isPending || release.isPending || update.isPending || remove.isPending
  const celebrate = useCelebrate()
  const hasPassengers = carpool.passengers.length > 0

  async function handleClaim() {
    const isCurrent = undo.captureScope()
    undo.clear()
    try {
      await claim.mutateAsync({ carpoolId: carpool.id, seats: 1 })
      if (isCurrent() && !full) celebrate.fire()
    } catch (error) {
      if (isCurrent()) toast(t(carpoolErrorKey(error)))
    }
  }
  async function handleRelease() {
    const heldSeats = myShare?.seatsClaimed ?? 1
    const isCurrent = undo.captureScope()
    undo.clear()
    try {
      await release.mutateAsync(carpool.id)
      // A closed event cannot accept a new claim, so do not offer a knowingly unusable Undo.
      if (eventClosed) {
        if (isCurrent()) toast(t('events.carpool.releasedToast'))
        return
      }
      undo.show({
        message: t('events.carpool.releasedToast'),
        successMessage: t('events.carpool.reclaimedToast'),
        isCurrent,
        action: () => claim.mutateAsync({ carpoolId: carpool.id, seats: heldSeats }),
      })
    } catch (error) {
      if (isCurrent()) toast(t(carpoolErrorKey(error)))
    }
  }

  return (
    <li
      className="flex min-w-0 flex-col gap-3 rounded-md border border-border p-4 wrap-anywhere"
      data-carpool-id={carpool.id}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-[1_1_10rem] items-center gap-2">
          <Avatar
            src={avatarUrl(carpool.driver.avatarKey, 64)}
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
        <div className="flex items-center gap-2">
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
          {carpool.canManage && !cancelled ? (
            <>
              {!eventClosed ? (
                <IconButton
                  aria-label={t('events.carpool.edit')}
                  onClick={() => setEditing(true)}
                  disabled={busy}
                >
                  <Pencil className="size-4" aria-hidden="true" />
                </IconButton>
              ) : null}
              <IconButton
                aria-label={t('events.carpool.delete')}
                onClick={() => {
                  setDeleting(true)
                  setDeleteError(null)
                }}
                disabled={busy}
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </IconButton>
            </>
          ) : null}
        </div>
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
      {hasPassengers ? (
        <div className="flex flex-col gap-1">
          <p className="text-caption font-medium text-muted-foreground">
            {t('events.carpool.passengers')}
          </p>
          <ul className="flex flex-wrap gap-2">
            {carpool.passengers.map((person) => (
              <li key={person.userId} className="flex items-center gap-1.5">
                <Avatar
                  src={avatarUrl(person.avatarKey, 64)}
                  alt={`${person.givenName} ${person.familyName}`}
                  initials={initialsFromName(person.givenName, person.familyName)}
                  hueSeed={person.userId}
                  size="sm"
                />
                <span className="text-caption text-foreground">
                  {person.givenName} {person.familyName}
                </span>
                {person.status === 'waitlist' ? (
                  <Badge tone="warning">{t('events.carpool.waitlisted')}</Badge>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {!cancelled ? (
        myShare ? (
          <div className="flex items-center justify-between gap-2">
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
              loading={release.isPending}
              disabled={busy && !release.isPending}
            >
              {t('events.carpool.release')}
            </Button>
          </div>
        ) : isDriver ? (
          <p className="text-caption text-muted-foreground">{t('events.carpool.youDrive')}</p>
        ) : participationBlocked || eventClosed ? null : (
          <div className="flex justify-end">
            <Button
              size="sm"
              className="relative"
              onClick={handleClaim}
              loading={claim.isPending}
              disabled={busy && !claim.isPending}
            >
              {t(full ? 'events.carpool.joinWaitlist' : 'events.carpool.claim')}
              <Celebrate play={celebrate.play} onDone={celebrate.onDone} />
            </Button>
          </div>
        )
      ) : null}
      {undo.feedback}
      <Dialog
        open={editing}
        onOpenChange={(open) => {
          if (!update.isPending) setEditing(open)
        }}
      >
        <DialogContent title={t('events.carpool.edit')} className="max-w-120">
          {editing ? (
            <div className="mt-4">
              <CarpoolForm
                initial={carpool}
                pending={update.isPending}
                onCancel={() => setEditing(false)}
                onSave={async (draft) => {
                  await update.mutateAsync({
                    carpoolId: carpool.id,
                    input: {
                      seats: Number(draft.seats),
                      departurePlace: draft.departurePlace.trim() || null,
                      departureAt: draft.departureAt
                        ? draft.departureAt === toLocalInputValue(carpool.departureAt)
                          ? carpool.departureAt
                          : new Date(draft.departureAt).toISOString()
                        : null,
                      note: draft.note.trim() || null,
                    },
                  })
                  setEditing(false)
                  toast(t('events.carpool.saved'))
                }}
              />
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
      <Dialog
        open={deleting}
        onOpenChange={(open) => {
          if (!remove.isPending) setDeleting(open)
        }}
      >
        <DialogContent title={t('events.carpool.delete')} className="max-w-110">
          <div className="mt-4 flex flex-col gap-4">
            <p className="text-small text-muted-foreground">
              {t(
                hasPassengers ? 'events.carpool.deleteNeedsEmpty' : 'events.carpool.deleteConfirm',
              )}
            </p>
            {deleteError ? (
              <p role="alert" className="text-small text-destructive">
                {t(deleteError)}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                disabled={remove.isPending}
                onClick={() => setDeleting(false)}
              >
                {t('events.actions.close')}
              </Button>
              <Button
                type="button"
                variant="destructive"
                loading={remove.isPending}
                disabled={hasPassengers}
                onClick={async () => {
                  try {
                    await remove.mutateAsync(carpool.id)
                    setDeleting(false)
                    toast(t('events.carpool.deleted'))
                  } catch (error) {
                    setDeleteError(carpoolErrorKey(error))
                  }
                }}
              >
                {t('events.carpool.delete')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </li>
  )
}

export function CarpoolPanel({
  eventId,
  eventClosed = false,
}: {
  eventId: string
  eventClosed?: boolean | undefined
}) {
  const t = useT()
  const { user } = useSession()
  const query = useCarpoolsQuery(eventId, true)
  const create = useCreateCarpoolMutation(eventId)
  const [showForm, setShowForm] = React.useState(false)
  const active = query.data?.items.filter((ride) => ride.status !== 'cancelled') ?? []
  const myRide = active.find((ride) => ride.driver.id === user?.id)
  const mySeat = active.find((ride) => ride.passengers.some((person) => person.userId === user?.id))
  const blocked = myRide
    ? 'events.carpool.alreadyDriver'
    : mySeat
      ? 'events.carpool.alreadyPassenger'
      : null
  return (
    <div className="flex flex-col gap-4">
      {eventClosed ? (
        <p className="text-small text-muted-foreground">{t('events.carpool.eventClosed')}</p>
      ) : blocked ? (
        <p className="text-small text-muted-foreground">{t(blocked)}</p>
      ) : !query.isPending && !query.isError ? (
        <div className="flex justify-end">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setShowForm((open) => !open)}
          >
            {t('events.carpool.offer')}
          </Button>
        </div>
      ) : null}
      {showForm && !blocked && !eventClosed ? (
        <div className="rounded-md border border-border p-4">
          <CarpoolForm
            pending={create.isPending}
            onCancel={() => setShowForm(false)}
            onSave={async (draft) => {
              await create.mutateAsync({
                seats: Number(draft.seats),
                departurePlace: draft.departurePlace.trim() || undefined,
                departureAt: draft.departureAt
                  ? new Date(draft.departureAt).toISOString()
                  : undefined,
                note: draft.note.trim() || undefined,
              })
              setShowForm(false)
            }}
          />
        </div>
      ) : null}
      {query.isPending ? (
        <Skeleton className="h-32 w-full" />
      ) : query.isError ? (
        <StateView
          kind="error"
          titleKey="events.error.title"
          bodyKey="events.error.body"
          action={{ labelKey: 'events.actions.retry', onAction: () => void query.refetch() }}
        />
      ) : query.data.items.length === 0 ? (
        <p className="text-small text-muted-foreground">{t('events.carpool.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {query.data.items.map((ride) => (
            <CarpoolCard
              key={ride.id}
              eventId={eventId}
              carpool={ride}
              participationBlocked={blocked}
              eventClosed={eventClosed}
            />
          ))}
        </ul>
      )}
    </div>
  )
}
