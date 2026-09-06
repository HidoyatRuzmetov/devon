// Turns `EventFormDialog`'s string-shaped form state into the typed request body `api.ts` expects
// -- kept out of the dialog itself so both the create and edit call sites (`events-screen.tsx`,
// `event-detail-dialog.tsx`) share one conversion instead of drifting apart.
import type { EventFormValues } from '../components/event-form-dialog.js'
import type { CreateEventInput, UpdateEventInput } from '../api.js'

function reminderOffsets(values: EventFormValues): number[] {
  const offsets: number[] = []
  if (values.reminderDayBefore) offsets.push(1440)
  if (values.reminderHourBefore) offsets.push(60)
  return offsets
}

export function eventFormValuesToCreateInput(values: EventFormValues): CreateEventInput {
  return {
    title: values.title.trim(),
    description: values.description.trim() || undefined,
    category: values.category,
    startsAt: new Date(values.startsAt).toISOString(),
    endsAt: new Date(values.endsAt).toISOString(),
    place: values.place.trim() || undefined,
    placeUrl: values.placeUrl.trim() || undefined,
    capacity: values.capacity.trim() ? Number(values.capacity) : undefined,
    waitlistEnabled: values.waitlistEnabled,
    rsvpDeadline: values.rsvpDeadline ? new Date(values.rsvpDeadline).toISOString() : undefined,
    costNote: values.costNote.trim() || undefined,
    reminderOffsetsMinutes: reminderOffsets(values),
  }
}

/** Every optional field is sent, `null` where the form is blank -- an edit is a full re-submission of
 * the form, so a field the organiser cleared must clear it on the server too, not silently keep the
 * previous value the way omitting it would (see `UpdateEventInput`'s tri-state contract in `api.ts`). */
export function eventFormValuesToUpdateInput(values: EventFormValues): UpdateEventInput {
  return {
    title: values.title.trim(),
    description: values.description.trim() || null,
    category: values.category,
    startsAt: new Date(values.startsAt).toISOString(),
    endsAt: new Date(values.endsAt).toISOString(),
    place: values.place.trim() || null,
    placeUrl: values.placeUrl.trim() || null,
    capacity: values.capacity.trim() ? Number(values.capacity) : null,
    waitlistEnabled: values.waitlistEnabled,
    rsvpDeadline: values.rsvpDeadline ? new Date(values.rsvpDeadline).toISOString() : null,
    costNote: values.costNote.trim() || null,
    reminderOffsetsMinutes: reminderOffsets(values),
  }
}
