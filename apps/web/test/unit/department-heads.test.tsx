import { TooltipProvider } from '@devon/ui'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { setLocale } from '@devon/i18n'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import DepartmentDetailScreen from '../../src/features/departments/department-detail-screen.js'
import type { Member } from '../../src/features/departments/api.js'
import { ApiError } from '../../src/lib/api-client.js'

const state = vi.hoisted(() => ({
  members: [] as Member[],
  viewer: 'a',
  role: 'head',
  tab: 'members',
  change: vi.fn(),
  save: vi.fn(),
  leave: vi.fn(),
}))
vi.mock('../../src/lib/session.js', () => ({
  useMeQuery: () => ({
    data: {
      user: { id: state.viewer, role: 'member' },
      csrfToken: 'example-csrf',
    },
  }),
  useDepartment: () => ({
    departmentId: 'dept',
    memberships: [{ departmentId: 'dept', role: state.role }],
  }),
}))
vi.mock('../../src/lib/router.js', () => ({
  useSearchParams: () => new URLSearchParams(`id=dept&tab=${state.tab}`),
  navigate: vi.fn(),
}))
vi.mock('../../src/features/departments/api.js', () => ({
  fetchDepartment: async () => ({
    id: 'dept',
    name: 'Department',
    myRole: state.role,
    settings: {
      allowSelfAssign: true,
      allowStructureEdit: true,
      whoCanConnectTelegramGroup: 'everyone',
      features: {},
    },
  }),
  fetchMembers: async () => ({
    members: state.members.map((member) => ({ ...member })),
  }),
  fetchJoinRequests: async () => ({ requests: [] }),
  setMemberRole: (...args: unknown[]) => state.change(...args),
  patchDepartmentSettings: (...args: unknown[]) => state.save(...args),
  leaveDepartment: (...args: unknown[]) => state.leave(...args),
  transferHeadship: vi.fn(),
  removeMember: vi.fn(),
  resetMemberPassword: vi.fn(),
  decideJoinRequest: vi.fn(),
  fetchInvite: vi.fn(),
  putFeatures: vi.fn(),
  requestDepartmentDeletion: vi.fn(),
  rotateJoinKey: vi.fn(),
  rotateJoinPassword: vi.fn(),
  setJoinApproval: vi.fn(),
  setJoinPassword: vi.fn(),
}))

const person = (userId: string, givenName: string, role: 'head' | 'member'): Member => ({
  userId,
  givenName,
  familyName: 'Test',
  patronymic: null,
  title: null,
  avatarKey: null,
  role,
  status: 'active',
  accountStatus: 'active',
  version: 7,
  joinedAt: '2026-01-01T00:00:00.000Z',
})
function show() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <DepartmentDetailScreen />
      </TooltipProvider>
    </QueryClientProvider>,
  )
}
beforeEach(() => {
  state.members = [
    person('a', 'Anvar', 'head'),
    person('b', 'Nodira', 'head'),
    person('c', 'Aziza', 'member'),
  ]
  state.viewer = 'a'
  state.role = 'head'
  state.tab = 'members'
  vi.clearAllMocks()
  state.change.mockImplementation(async (_id: string, member: Member, role: 'head' | 'member') => {
    state.members = state.members.map((row) =>
      row.userId === member.userId ? { ...row, role, version: row.version + 1 } : row,
    )
  })
  state.save.mockResolvedValue(undefined)
  setLocale('en')
})

describe('department leadership controls', () => {
  it('shows every head and allows a co-head to leave or step down', async () => {
    show()
    await waitFor(() => expect(screen.getByText('Department heads (2)')).toBeVisible())
    expect(screen.getByText('Anvar Test, Nodira Test')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Leave department' })).toBeEnabled()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Actions for Anvar Test' }))
    expect(screen.getByRole('menuitem', { name: 'Step down as head' })).toBeEnabled()
  })
  it('disables departure of the last active head and explains how to appoint a replacement', async () => {
    state.members[1]!.accountStatus = 'locked'
    show()
    await waitFor(() => expect(screen.getByText('Department heads (1)')).toBeVisible())
    expect(screen.getByRole('button', { name: 'Leave department' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Step down as head' })).not.toBeInTheDocument()
    expect(screen.getByText(/At least one active head must remain/)).toBeVisible()
  })
  it('appoints an additional head with the selected membership version and keeps both current heads', async () => {
    const user = userEvent.setup()
    show()
    await user.click(await screen.findByRole('button', { name: 'Actions for Aziza Test' }))
    await user.click(screen.getByRole('menuitem', { name: 'Appoint as head' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText(/You and the other heads will keep your roles/)).toBeVisible()
    await user.click(within(dialog).getByRole('button', { name: 'Appoint as head' }))
    await waitFor(() =>
      expect(state.change).toHaveBeenCalledWith(
        'dept',
        expect.objectContaining({ userId: 'c', version: 7 }),
        'head',
        'example-csrf',
      ),
    )
    expect(await screen.findByText('Department heads (3)')).toBeVisible()
  })
  it('offers removal of a co-head role but never a password reset or transfer to an existing head', async () => {
    const user = userEvent.setup()
    show()
    await user.click(await screen.findByRole('button', { name: 'Actions for Nodira Test' }))
    expect(screen.getByRole('menuitem', { name: 'Remove head role' })).toBeVisible()
    expect(screen.queryByRole('menuitem', { name: 'Transfer headship' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /Reset password/ })).not.toBeInTheDocument()
  })
  it('does not offer appointment for pending members', async () => {
    const user = userEvent.setup()
    state.members[2]!.status = 'pending_approval'
    show()
    await user.click(await screen.findByRole('button', { name: 'Actions for Aziza Test' }))
    expect(screen.queryByRole('menuitem', { name: 'Appoint as head' })).not.toBeInTheDocument()
  })
  it('shows a stale-membership conflict instead of claiming the role was changed', async () => {
    const user = userEvent.setup()
    state.change.mockRejectedValue(new ApiError(409, 'conflict', null))
    show()
    await user.click(await screen.findByRole('button', { name: 'Actions for Aziza Test' }))
    await user.click(screen.getByRole('menuitem', { name: 'Appoint as head' }))
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Appoint as head',
      }),
    )
    expect(
      await screen.findByText('Membership has changed. Review the refreshed list and try again.'),
    ).toBeVisible()
    expect(screen.getByText('Department heads (2)')).toBeVisible()
  })
  it('keeps management actions unavailable to an ordinary member', async () => {
    state.viewer = 'c'
    state.role = 'member'
    show()
    await waitFor(() => expect(screen.getByText('Department heads (2)')).toBeVisible())
    expect(screen.queryByRole('button', { name: /Actions for/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Invite' })).not.toBeInTheDocument()
  })
  it('saves only the edited setting so another head’s unrelated settings survive', async () => {
    state.tab = 'general'
    show()
    const toggle = await screen.findByRole('switch', {
      name: 'Members can assign themselves to units',
    })
    fireEvent.click(toggle)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(state.save).toHaveBeenCalledWith('dept', { allowSelfAssign: false }, 'example-csrf'),
    )
  })
})
