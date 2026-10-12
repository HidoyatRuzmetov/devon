import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { setLocale } from '@devon/i18n'
import type { EventDto } from '../../src/features/events/schemas.js'

vi.mock('../../src/lib/session.js', () => ({
  useSession: () => ({ user: { id: 'head', givenName: 'Local', familyName: 'Head' } }),
  useDepartment: () => ({ departmentId: 'local-department' }),
}))
vi.mock('../../src/features/structure/api.js', () => ({
  fetchMembers: vi.fn().mockResolvedValue([]),
}))
vi.mock('../../src/features/people/api.js', () => ({
  fetchIndicators: vi.fn().mockResolvedValue({ people: [], capacityCards: 8 }),
}))
vi.mock('../../src/features/work/api.js', () => ({
  fetchBoard: vi.fn().mockResolvedValue({ columns: [], unassigned: [] }),
}))
vi.mock('../../src/features/work/hooks-plus.js', () => ({
  useGoalsQuery: () => ({ data: [], isPending: false }),
}))
vi.mock('../../src/features/ai/use-ai.js', () => ({
  useBriefingQuery: () => ({ data: { briefing: null, canRefresh: false }, isPending: false }),
  useRefreshBriefingMutation: () => ({ isPending: false }),
}))
vi.mock('../../src/features/analytics/use-analytics.js', () => ({
  // A historical summary correctly has no events after today. Home must use the events endpoint.
  useSummaryQuery: () => ({
    data: { projectProgress: [], eventsParticipation: [] },
    isPending: false,
    isError: false,
  }),
  usePersonalOverviewQuery: () => ({ data: { givenOverdueCount: 0 }, isPending: false }),
}))
vi.mock('../../src/features/events/api.js', () => ({ fetchEvents: vi.fn() }))

import { fetchEvents } from '../../src/features/events/api.js'
import { HeadDashboard } from '../../src/features/home/head-dashboard.js'

const now = new Date('2026-10-12T09:00:00Z')
const clients: QueryClient[] = []

function event(title: string, startsAt: string, patch: Partial<EventDto> = {}): EventDto {
  return {
    id: title,
    title,
    description: null,
    category: 'other',
    illustrationKey: 'other',
    startsAt,
    endsAt: new Date(Date.parse(startsAt) + 3_600_000).toISOString(),
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
    goingCount: 3,
    maybeCount: 0,
    waitlistCount: 0,
    myRsvp: null,
    canManage: true,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    version: 1,
    ...patch,
  }
}

function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  clients.push(client)
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <HeadDashboard />
      </QueryClientProvider>,
    ),
  }
}

function eventsTile() {
  const heading = screen.getByRole('heading', { name: 'Coming up' })
  return within(heading.parentElement!.parentElement!)
}

beforeEach(() => {
  setLocale('en')
  localStorage.clear()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(now)
  vi.mocked(fetchEvents).mockReset()
})

afterEach(() => {
  for (const client of clients.splice(0)) client.clear()
  vi.useRealTimers()
})

it('shows future events from the real events query even when the historical summary is empty', async () => {
  vi.mocked(fetchEvents).mockResolvedValue({
    items: [
      event('Later review', '2026-10-19T06:00:00Z', { goingCount: 7, status: 'full' }),
      event('Pilot review', '2026-10-15T05:00:00Z', { goingCount: 4 }),
      event('Previous review', '2026-10-11T05:00:00Z'),
      event('Beyond next week', '2026-10-20T05:00:00Z'),
      event('Cancelled review', '2026-10-14T05:00:00Z', { status: 'cancelled' }),
      event('Unpublished draft', '2026-10-13T05:00:00Z', { status: 'draft' }),
    ],
  })
  const view = show()
  await screen.findByText('Pilot review', { exact: true })
  const tile = eventsTile()
  expect(tile.getAllByRole('listitem').map((row) => row.textContent)).toEqual([
    'Pilot review4',
    'Later review7',
  ])
  expect(tile.queryByText('Nothing scheduled in the next seven days.')).not.toBeInTheDocument()
  expect(fetchEvents).toHaveBeenCalledExactlyOnceWith({
    from: now,
    to: new Date('2026-10-19T09:00:00Z'),
  })
  // Ordinary dashboard rerenders must keep one range/cache key, not launch a new millisecond query.
  fireEvent.click(screen.getByRole('button', { name: 'Layout' }))
  expect(fetchEvents).toHaveBeenCalledOnce()
  view.unmount()
})

it('keeps the event tile pending instead of claiming that nothing is scheduled', async () => {
  let finish!: (value: { items: EventDto[] }) => void
  vi.mocked(fetchEvents).mockReturnValue(new Promise((resolve) => (finish = resolve)))
  show()
  await screen.findByRole('heading', { name: 'Coming up' })
  expect(eventsTile().getByText('Loading', { exact: true })).toBeInTheDocument()
  expect(
    eventsTile().queryByText('Nothing scheduled in the next seven days.'),
  ).not.toBeInTheDocument()
  await act(async () => finish({ items: [] }))
  await waitFor(() =>
    expect(eventsTile().getByText('Nothing scheduled in the next seven days.')).toBeInTheDocument(),
  )
})

it('offers a real events retry without hiding the other dashboard tiles', async () => {
  vi.mocked(fetchEvents)
    .mockRejectedValueOnce(new Error('Local future-event read refusal'))
    .mockResolvedValue({ items: [event('Retried pilot review', '2026-10-15T05:00:00Z')] })
  show()
  await screen.findByText('Could not load the data', { exact: true })
  expect(screen.getByRole('heading', { name: 'Projects' })).toBeInTheDocument()
  expect(
    eventsTile().queryByText('Nothing scheduled in the next seven days.'),
  ).not.toBeInTheDocument()
  fireEvent.click(eventsTile().getByRole('button', { name: 'Try again' }))
  await screen.findByText('Retried pilot review', { exact: true })
  expect(fetchEvents).toHaveBeenCalledTimes(2)
})
