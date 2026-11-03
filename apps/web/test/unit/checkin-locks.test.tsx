import { TooltipProvider } from '@devon/ui'
import * as React from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import type { CheckinBoard } from '@devon/contracts'
import { setLocale } from '@devon/i18n'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import CheckinScreen from '../../src/features/analytics/checkin-screen.js'
import { cycleLockState, memberLock } from '../../src/features/analytics/checkin-locks.js'

const mocks = vi.hoisted(() => ({
  mutate: vi.fn(),
  search: new URLSearchParams(),
  userId: 'head',
  data: {} as CheckinBoard,
}))
vi.mock('../../src/features/analytics/checkins-api.js', () => ({
  useCheckinCandidates: () => ({ data: [], isPending: false, isError: false }),
  useCheckins: () => ({ data: mocks.data }),
  useCheckinChange: () => ({ mutate: mocks.mutate, isPending: false }),
}))
vi.mock('../../src/features/work/components/card-peek-dialog.js', () => ({
  CardPeekDialog: () => null,
}))
vi.mock('../../src/lib/session.js', () => ({
  useDepartment: () => ({ departmentId: 'department', department: { role: 'head' } }),
  useSession: () => ({ user: { id: mocks.userId } }),
}))
vi.mock('../../src/lib/router.js', () => ({
  useSearchParams: () => mocks.search,
  navigate: vi.fn(),
}))
vi.mock('../../src/lib/use-viewport-bounded-height.js', () => ({
  useViewportBoundedHeight: () => [null, 640],
}))

beforeEach(() => {
  setLocale('en')
  localStorage.clear()
  sessionStorage.clear()
  mocks.userId = 'head'
  mocks.search = new URLSearchParams('member=alice')
  mocks.mutate.mockReset().mockImplementation((_change, options) => options?.onSuccess?.())
  mocks.data = {
    currentCycleId: 'cycle',
    selectedCycleId: 'cycle',
    units: [],
    entries: [],
    progress: [],
    memberLocks: [],
    layouts: [],
    cycles: [
      {
        id: 'cycle',
        startsOn: '2099-11-02',
        endsOn: '2099-11-13',
        checkinLockedAt: null,
        checkoutLockedAt: null,
      },
    ],
    members: ['alice', 'bob'].map((id) => ({
      userId: id,
      givenName: id === 'alice' ? 'Alice' : 'Bob',
      familyName: 'Member',
      avatarKey: null,
      unitId: null,
      unitName: null,
      unitColour: null,
    })),
  }
})

describe('individual check-in locks and confirmation', () => {
  it('uses only the selected person’s lock, with automatic cycle locks as a fallback', () => {
    const cycle = mocks.data.cycles[0]!
    mocks.data.memberLocks = [
      {
        cycleId: cycle.id,
        memberUserId: 'alice',
        checkinLockedAt: 'locked',
        checkoutLockedAt: 'closed',
      },
    ]
    expect(memberLock(mocks.data, cycle, 'alice').checkoutLockedAt).toBe('closed')
    expect(memberLock(mocks.data, cycle, 'bob').checkinLockedAt).toBeNull()
    expect(cycleLockState(mocks.data, cycle)).toBe('draft')
    cycle.checkinLockedAt = 'deadline'
    expect(memberLock(mocks.data, cycle, 'bob').checkinLockedAt).toBe('deadline')
    expect(cycleLockState(mocks.data, cycle)).toBe('agreed')
  })

  it('prompts on every lock by default and sends the selected member', () => {
    render(
      <TooltipProvider>
        <CheckinScreen />
      </TooltipProvider>,
    )
    for (let i = 0; i < 2; i++) {
      fireEvent.click(screen.getByRole('button', { name: 'Agree check-in' }))
      expect(mocks.mutate).toHaveBeenCalledTimes(i)
      const dialog = screen.getByRole('dialog')
      expect(within(dialog).getByText(/Are you sure.*Alice Member/)).toBeTruthy()
      fireEvent.click(within(dialog).getByRole('button', { name: 'Agree check-in' }))
    }
    expect(mocks.mutate).toHaveBeenLastCalledWith(
      { kind: 'lock', cycleId: 'cycle', memberUserId: 'alice', phase: 'checkin' },
      expect.anything(),
    )
  })

  it('remembers an explicit opt-out after success, without sharing it with another account or checkout', () => {
    const view = render(
      <TooltipProvider>
        <CheckinScreen />
      </TooltipProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Agree check-in' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Don’t show again' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Agree check-in' }))
    mocks.search = new URLSearchParams('member=bob')
    view.rerender(
      <TooltipProvider>
        <CheckinScreen />
      </TooltipProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Agree check-in' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(mocks.mutate).toHaveBeenLastCalledWith(
      expect.objectContaining({ memberUserId: 'bob' }),
      expect.anything(),
    )
    mocks.userId = 'another-head'
    view.rerender(
      <TooltipProvider>
        <CheckinScreen />
      </TooltipProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Agree check-in' }))
    expect(screen.getByRole('dialog')).toBeTruthy()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }))
    mocks.userId = 'head'
    mocks.data.cycles[0]!.endsOn = '2020-01-01'
    mocks.data.memberLocks = [
      { cycleId: 'cycle', memberUserId: 'bob', checkinLockedAt: 'locked', checkoutLockedAt: null },
    ]
    view.rerender(
      <TooltipProvider>
        <CheckinScreen />
      </TooltipProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Lock checkout' }))
    expect(within(screen.getByRole('dialog')).getByText(/Are you sure.*Bob Member/)).toBeTruthy()
  })

  it('does not remember the checkbox on cancellation or a failed save', () => {
    mocks.mutate.mockImplementation(() => {})
    render(
      <TooltipProvider>
        <CheckinScreen />
      </TooltipProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Agree check-in' }))
    let dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Don’t show again' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(localStorage.length).toBe(0)
    fireEvent.click(screen.getByRole('button', { name: 'Agree check-in' }))
    dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Don’t show again' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Agree check-in' }))
    expect(localStorage.length).toBe(0)
    expect(screen.getByRole('dialog')).toBeTruthy()
  })
})
