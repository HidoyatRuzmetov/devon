import { describe, expect, it } from 'vitest'
import type { EventFormValues } from '../../src/features/events/components/event-form-dialog.js'
import { eventFormValuesToUpdateInput } from '../../src/features/events/lib/event-form-mapping.js'

const values: EventFormValues = {
  title: 'Synthetic updated title',
  description: '',
  category: 'other',
  startsAt: '2026-10-10T15:00',
  endsAt: '2026-10-10T16:00',
  rsvpDeadline: '2026-10-09T18:00',
  place: '',
  placeUrl: '',
  capacity: '',
  waitlistEnabled: true,
  costNote: '',
  reminderDayBefore: true,
  reminderHourBefore: true,
}
const saved = {
  startsAt: new Date('2026-10-10T15:00:09.123').toISOString(),
  endsAt: new Date('2026-10-10T16:00:44.567').toISOString(),
  rsvpDeadline: new Date('2026-10-09T18:00:22.345').toISOString(),
}

describe('editing event timestamps with minute-granularity controls', () => {
  it('preserves original seconds and milliseconds when the visible dates are unchanged', () => {
    expect(eventFormValuesToUpdateInput(values, saved)).toMatchObject(saved)
  })
  it('converts an actual time edit instead of restoring the old timestamp', () => {
    const updated = eventFormValuesToUpdateInput({ ...values, startsAt: '2026-10-10T15:05' }, saved)
    expect(updated.startsAt).toBe(new Date('2026-10-10T15:05').toISOString())
    expect(updated.endsAt).toBe(saved.endsAt)
  })
  it('continues to clear an optional deadline explicitly', () => {
    expect(
      eventFormValuesToUpdateInput({ ...values, rsvpDeadline: '' }, saved).rsvpDeadline,
    ).toBeNull()
  })
})
