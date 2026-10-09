import * as React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { setLocale } from '@devon/i18n'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { EventDto } from '../../src/features/events/schemas.js'
import { RsvpPanel } from '../../src/features/events/components/rsvp-panel.js'

vi.mock('../../src/features/events/hooks.js', () => ({
  useRsvpMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRsvpsQuery: () => ({ data: { items: [] }, isPending: false, isError: false }),
}))

describe('RSVP form draft', () => {
  it('retains a local note when attendee counts refetch, and adopts a genuinely changed saved answer', async () => {
    setLocale('en')
    const event: EventDto = {
      id: 'event-a',
      title: 'Local meeting',
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
      goingCount: 1,
      maybeCount: 0,
      waitlistCount: 0,
      myRsvp: { status: 'yes', guests: 0, note: 'Saved note' },
      canManage: false,
      createdAt: '2026-10-08T00:00:00Z',
      updatedAt: '2026-10-08T00:00:00Z',
      version: 1,
    }
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } })
    queryClient.setQueryData(['me'], null)
    const { rerender } = render(<RsvpPanel event={event} eventId={event.id} />, {
      wrapper: ({ children }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      ),
    })
    const user = userEvent.setup()
    await user.clear(screen.getByRole('textbox', { name: 'Note (optional)' }))
    await user.type(screen.getByRole('textbox', { name: 'Note (optional)' }), 'My unfinished note')
    rerender(
      <RsvpPanel
        event={{ ...event, goingCount: 2, myRsvp: { ...event.myRsvp! } }}
        eventId={event.id}
      />,
    )
    expect(screen.getByRole('textbox', { name: 'Note (optional)' })).toHaveValue(
      'My unfinished note',
    )
    rerender(
      <RsvpPanel
        event={{
          ...event,
          myRsvp: { status: 'maybe', guests: 0, note: 'Changed from another session' },
        }}
        eventId={event.id}
      />,
    )
    expect(screen.getByRole('textbox', { name: 'Note (optional)' })).toHaveValue(
      'Changed from another session',
    )
  })
})
