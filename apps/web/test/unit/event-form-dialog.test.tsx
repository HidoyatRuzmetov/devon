import * as React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setLocale } from '@devon/i18n'
import { EventFormDialog } from '../../src/features/events/components/event-form-dialog.js'
import type { EventDto } from '../../src/features/events/schemas.js'

// Application AI is excluded from this local journey. Its unavailable boundary is real: the
// assistant remains hidden and never executes, while the ordinary creation wizard still works.
vi.mock('../../src/features/ai/use-ai.js', () => ({
  useAiSettingsQuery: () => ({ data: undefined }),
  useRunAiFeatureMutation: () => ({ data: undefined, isPending: false, isError: false }),
}))

function show(onSubmit = vi.fn().mockResolvedValue(undefined)) {
  const onOpenChange = vi.fn()
  render(
    <EventFormDialog
      open
      event={null}
      submitting={false}
      onSubmit={onSubmit}
      onOpenChange={onOpenChange}
    />,
  )
  return { onSubmit, onOpenChange, user: userEvent.setup() }
}

async function reachSchedule(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByRole('textbox', { name: 'Event title' }), 'Local team meeting')
  await user.click(screen.getByRole('button', { name: 'Next' }))
  fireEvent.change(screen.getByLabelText('Starts at'), {
    target: { value: '2026-11-12T09:00' },
  })
  fireEvent.change(screen.getByLabelText('Ends at'), {
    target: { value: '2026-11-12T10:00' },
  })
}

beforeEach(() => setLocale('en'))

describe('event creation wizard', () => {
  it('preserves unsaved edits through the same event refetch and resets when a different event opens', async () => {
    const event: EventDto = {
      id: 'event-a',
      title: 'Saved title',
      description: null,
      category: 'other',
      illustrationKey: 'other',
      startsAt: '2026-11-12T04:00:00Z',
      endsAt: '2026-11-12T05:00:00Z',
      timezone: 'Asia/Tashkent',
      place: null,
      placeUrl: null,
      capacity: null,
      waitlistEnabled: true,
      rsvpDeadline: null,
      costNote: null,
      reminderOffsetsMinutes: [],
      organizer: { id: 'head', givenName: 'Local', familyName: 'Head' },
      status: 'open',
      updatedSummary: null,
      cancelledAt: null,
      cancelledReason: null,
      goingCount: 0,
      maybeCount: 0,
      waitlistCount: 0,
      myRsvp: null,
      canManage: true,
      createdAt: '2026-10-08T00:00:00Z',
      updatedAt: '2026-10-08T00:00:00Z',
      version: 1,
    }
    const props = {
      open: true,
      onOpenChange: vi.fn(),
      onSubmit: vi.fn().mockResolvedValue(undefined),
      submitting: false,
    }
    const { rerender } = render(<EventFormDialog {...props} event={event} />)
    const user = userEvent.setup()
    await user.clear(screen.getByRole('textbox', { name: 'Event title' }))
    await user.type(screen.getByRole('textbox', { name: 'Event title' }), 'My unfinished edit')
    rerender(<EventFormDialog {...props} event={{ ...event, goingCount: 2 }} />)
    expect(screen.getByRole('textbox', { name: 'Event title' })).toHaveValue('My unfinished edit')
    rerender(
      <EventFormDialog
        {...props}
        event={{ ...event, id: 'event-b', title: 'Different saved title' }}
      />,
    )
    expect(screen.getByRole('textbox', { name: 'Event title' })).toHaveValue(
      'Different saved title',
    )
  })
  it('requires a separate Publish activation after the second Next click', async () => {
    const { user, onSubmit, onOpenChange } = show()
    await reachSchedule(user)
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByLabelText('Capacity')).toBeVisible()
    expect(onSubmit).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Create event' }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce())
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ title: 'Local team meeting' }))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it('does not publish when Enter advances the schedule step', async () => {
    const { user, onSubmit } = show()
    await reachSchedule(user)
    await user.click(screen.getByLabelText('Place'))
    await user.keyboard('{Enter}')
    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Capacity')).toBeVisible()
  })

  it('keeps invalid dates on the schedule step before reaching Publish', async () => {
    const { user, onSubmit } = show()
    await reachSchedule(user)
    fireEvent.change(screen.getByLabelText('Ends at'), {
      target: { value: '2026-11-12T08:59' },
    })
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByText('The end time must be after the start time')).toBeVisible()
    expect(screen.getByLabelText('Starts at')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Create event' })).toBeNull()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('suppresses repeated submission while the first operation is pending and retains errors', async () => {
    let reject!: (error: Error) => void
    const onSubmit = vi.fn(
      () => new Promise<void>((_resolve, rejectPromise) => (reject = rejectPromise)),
    )
    const { user, onOpenChange } = show(onSubmit)
    await reachSchedule(user)
    await user.click(screen.getByRole('button', { name: 'Next' }))
    const submit = screen.getByRole('button', { name: 'Create event' })
    await user.dblClick(submit)
    expect(onSubmit).toHaveBeenCalledOnce()
    await act(async () => reject(new Error('Local injected failure')))
    expect(screen.getByText("Couldn't load events")).toBeVisible()
    expect(screen.getByLabelText('Capacity')).toBeVisible()
    expect(onOpenChange).not.toHaveBeenCalled()
  })
})
