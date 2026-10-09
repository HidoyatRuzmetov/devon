import * as React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import { setLocale } from '@devon/i18n'
import AnalyticsScreen from '../../src/features/analytics/analytics-screen.js'

const fixture = vi.hoisted(() => ({
  role: 'super_admin',
  departmentId: null as string | null,
  navigate: vi.fn(),
  summary: vi.fn(),
  pins: vi.fn(),
}))
vi.mock('../../src/lib/session.js', () => ({
  useMeQuery: () => ({
    isPending: false,
    data: {
      user: { role: fixture.role },
      activeDepartmentId: fixture.departmentId,
      memberships: [],
    },
  }),
}))
vi.mock('../../src/lib/router.js', () => ({
  useSearchParams: () => new URLSearchParams(),
  navigate: fixture.navigate,
}))
// This boundary test owns department selection, not the separately tested filter editor.
vi.mock('../../src/features/analytics/filter-bar.js', () => ({ FilterBar: () => null }))
vi.mock('../../src/features/analytics/use-analytics.js', () => ({
  useSummaryQuery: (...args: unknown[]) => {
    fixture.summary(...args)
    return { isError: false, isPending: true }
  },
  usePinnedChartsQuery: (...args: unknown[]) => {
    fixture.pins(...args)
    return { data: [] }
  },
  usePinChartMutation: () => ({ isPending: false }),
  useUnpinChartMutation: () => ({ isPending: false }),
}))
beforeEach(() => {
  setLocale('en')
  vi.clearAllMocks()
  fixture.role = 'super_admin'
  fixture.departmentId = null
})
it('guides an admin to actual global analytics without requesting an empty department', async () => {
  render(<AnalyticsScreen />)
  expect(fixture.summary).toHaveBeenCalledWith(expect.anything(), false)
  expect(fixture.pins).toHaveBeenCalledWith(false)
  await userEvent.setup().click(screen.getByRole('button', { name: 'Open system analytics' }))
  expect(fixture.navigate).toHaveBeenCalledExactlyOnceWith('/admin/analytics')
})
it('guides a user without membership home and retains a real admin department lens', () => {
  fixture.role = 'member'
  const view = render(<AnalyticsScreen />)
  expect(
    screen.getByText('Join or create a department to see its work analytics.'),
  ).toBeInTheDocument()
  view.unmount()
  fixture.role = 'super_admin'
  fixture.departmentId = 'local-lens-department'
  render(<AnalyticsScreen />)
  expect(fixture.summary).toHaveBeenLastCalledWith(expect.anything(), true)
  expect(fixture.pins).toHaveBeenLastCalledWith(true)
  expect(screen.queryByText('Choose what to analyse')).not.toBeInTheDocument()
})
