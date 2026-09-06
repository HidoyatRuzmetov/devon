import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { Me, Readyz } from '../../src/lib/api-schemas.js'

// `vi.mock` factories are hoisted above every other statement in this file (Vitest docs); the mock
// functions they close over must be created through `vi.hoisted()` or a bare `const` above them
// would still be in its temporal dead zone when the factory runs.
const { useMeQuery, useReadyzQuery, useInstanceQuery } = vi.hoisted(() => ({
  useMeQuery: vi.fn(),
  useReadyzQuery: vi.fn(),
  useInstanceQuery: vi.fn(),
}))

vi.mock('../../src/lib/session.js', () => ({ useMeQuery, useReadyzQuery, useInstanceQuery }))

const { AdminRoute } = await import('../../src/routes/admin.js')

function meResult(data: Me | null, overrides: Partial<Record<string, unknown>> = {}) {
  return { data, isPending: false, isError: false, refetch: vi.fn(), ...overrides }
}

const superAdminUser: Me = {
  user: {
    id: 'u1',
    login: 'admin',
    givenName: 'Aziz',
    familyName: 'Karimov',
    patronymic: null,
    title: null,
    avatarKey: null,
    locale: 'uz-Latn',
    timezone: 'Asia/Tashkent',
    role: 'super_admin',
    mustChangePassword: false,
  },
  memberships: [],
  membershipCount: 0,
  activeDepartmentId: null,
  actingForUserId: null,
  instance: { isDemo: false, maintenance: false },
  csrfToken: 'csrf',
}

const memberUser: Me = { ...superAdminUser, user: { ...superAdminUser.user, role: 'member' } }

afterEach(() => {
  useMeQuery.mockReset()
  useReadyzQuery.mockReset()
  window.history.replaceState(null, '', '/admin')
})

// AC-11: a session that is not super_admin sees the no-permission state -- mechanised here at the
// component level (the server denial itself is `apps/api`'s job, out of this item's TOUCHES).
describe('AdminRoute permission-driven visibility (AC-11, design.md §6.4)', () => {
  it('renders the NoPermission state for a member', () => {
    useMeQuery.mockReturnValue(meResult(memberUser))
    useReadyzQuery.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    })
    render(<AdminRoute />)
    expect(screen.getByText('Bu sahifa sizga ochiq emas')).toBeInTheDocument()
    expect(screen.queryByText('Tizim holati')).not.toBeInTheDocument()
  })

  it('renders the health card for super_admin, reflecting /readyz', () => {
    useMeQuery.mockReturnValue(meResult(superAdminUser))
    const readyz: Readyz = { db: true, valkey: false, migrations: true }
    useReadyzQuery.mockReturnValue({
      data: readyz,
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    })
    render(<AdminRoute />)
    expect(screen.getByText('Tizim holati')).toBeInTheDocument()
    expect(screen.getAllByText('Ishlamoqda').length).toBeGreaterThan(0) // API + db
    expect(screen.getByText('Ishlamayapti')).toBeInTheDocument() // valkey/queue is down
  })

  it('shows a loading state while the session is still resolving', () => {
    useMeQuery.mockReturnValue({
      data: undefined,
      isPending: true,
      isError: false,
      refetch: vi.fn(),
    })
    useReadyzQuery.mockReturnValue({
      data: undefined,
      isPending: true,
      isError: false,
      refetch: vi.fn(),
    })
    render(<AdminRoute />)
    expect(screen.getByRole('status')).toBeInTheDocument()
  })
})
