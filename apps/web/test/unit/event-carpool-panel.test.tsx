import * as React from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setLocale } from '@devon/i18n'
import { ApiError } from '../../src/lib/api-client.js'
import type { CarpoolDto } from '../../src/features/events/schemas.js'
import { CarpoolPanel } from '../../src/features/events/components/carpool-panel.js'

const state = vi.hoisted(() => ({
  userId: 'driver-a',
  items: [] as unknown[],
  update: vi.fn(),
  remove: vi.fn(),
  claim: vi.fn(),
  release: vi.fn(),
  create: vi.fn(),
}))
vi.mock('../../src/lib/session.js', () => ({ useSession: () => ({ user: { id: state.userId } }) }))
vi.mock('../../src/features/events/hooks.js', () => ({
  useCarpoolsQuery: () => ({ data: { items: state.items }, isPending: false, isError: false }),
  useCreateCarpoolMutation: () => ({ mutateAsync: state.create, isPending: false }),
  useUpdateCarpoolMutation: () => ({ mutateAsync: state.update, isPending: false }),
  useDeleteCarpoolMutation: () => ({ mutateAsync: state.remove, isPending: false }),
  useClaimCarpoolSeatMutation: () => ({ mutateAsync: state.claim, isPending: false }),
  useReleaseCarpoolSeatMutation: () => ({ mutateAsync: state.release, isPending: false }),
}))
vi.mock('../../src/features/events/components/event-undo.js', () => ({
  useEventUndo: () => ({
    captureScope: () => () => true,
    clear: vi.fn(),
    show: vi.fn(),
    feedback: null,
  }),
}))

function ride(id: string, driverId: string, overrides: Partial<CarpoolDto> = {}): CarpoolDto {
  return {
    id,
    driver: { id: driverId, givenName: driverId, familyName: 'Driver' },
    seats: 3,
    seatsClaimed: 0,
    departurePlace: 'Main office',
    departureAt: null,
    note: 'Saved note',
    status: 'open',
    passengers: [],
    canManage: driverId === state.userId,
    ...overrides,
  }
}
beforeEach(() => {
  setLocale('en')
  vi.clearAllMocks()
  state.userId = 'driver-a'
  for (const fn of [state.update, state.remove, state.claim, state.release, state.create])
    fn.mockResolvedValue(undefined)
})

describe('carpool participation and management', () => {
  it('does not let a driver offer another ride or join another car', () => {
    state.items = [ride('a', 'driver-a'), ride('b', 'driver-b')]
    render(<CarpoolPanel eventId="event" />)
    expect(screen.queryByRole('button', { name: 'Offer a ride' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Claim a seat' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Edit ride' })).toBeVisible()
  })

  it.each(['confirmed', 'waitlist'] as const)(
    'keeps a %s passenger on only one ride while allowing release',
    (status) => {
      state.userId = 'passenger'
      state.items = [
        ride('a', 'driver-a', {
          passengers: [
            {
              userId: 'passenger',
              givenName: 'Local',
              familyName: 'Rider',
              seatsClaimed: 1,
              status,
            },
          ],
        }),
        ride('b', 'driver-b'),
      ]
      render(<CarpoolPanel eventId="event" />)
      expect(screen.queryByRole('button', { name: 'Offer a ride' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Claim a seat' })).toBeNull()
      expect(screen.getByRole('button', { name: 'Give up seat' })).toBeEnabled()
    },
  )

  it('edits an existing ride and explicitly clears optional saved fields', async () => {
    state.items = [ride('a', 'driver-a')]
    render(<CarpoolPanel eventId="event" />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Edit ride' }))
    const dialog = screen.getByRole('dialog', { name: 'Edit ride' })
    await user.clear(within(dialog).getByLabelText('Departure point'))
    await user.clear(within(dialog).getByLabelText('Note'))
    await user.clear(within(dialog).getByLabelText('Seats available'))
    await user.type(within(dialog).getByLabelText('Seats available'), '4')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(state.update).toHaveBeenCalledWith({
        carpoolId: 'a',
        input: { seats: 4, departurePlace: null, departureAt: null, note: null },
      }),
    )
  })

  it('explains why a ride with a waitlisted passenger cannot be deleted', async () => {
    state.items = [
      ride('a', 'driver-a', {
        passengers: [
          {
            userId: 'waiting',
            givenName: 'Local',
            familyName: 'Rider',
            seatsClaimed: 1,
            status: 'waitlist',
          },
        ],
      }),
    ]
    render(<CarpoolPanel eventId="event" />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Delete ride' }))
    const dialog = screen.getByRole('dialog', { name: 'Delete ride' })
    expect(
      within(dialog).getByText(/All passengers, including people on the waitlist/),
    ).toBeVisible()
    expect(within(dialog).getByRole('button', { name: 'Delete ride' })).toBeDisabled()
    expect(state.remove).not.toHaveBeenCalled()
  })

  it('retains the draft and explains a server-side occupied-ride race', async () => {
    state.update.mockRejectedValueOnce(
      new ApiError(409, 'conflict', null, [
        { path: 'carpool', code: 'carpool_capacity_below_claimed' },
      ]),
    )
    state.items = [ride('a', 'driver-a')]
    render(<CarpoolPanel eventId="event" />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Edit ride' }))
    const dialog = screen.getByRole('dialog', { name: 'Edit ride' })
    await user.type(within(dialog).getByLabelText('Note'), ' and a new detail')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(within(dialog).getByRole('alert')).toHaveTextContent(
        'The number of seats cannot be less than the seats already confirmed.',
      ),
    )
    expect(within(dialog).getByLabelText('Note')).toHaveValue('Saved note and a new detail')
  })
})
