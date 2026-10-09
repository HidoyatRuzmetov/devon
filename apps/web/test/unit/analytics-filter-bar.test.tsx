import * as React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import { setLocale } from '@devon/i18n'
import { FilterBar } from '../../src/features/analytics/filter-bar.js'

const { save } = vi.hoisted(() => ({ save: vi.fn() }))
vi.mock('../../src/features/analytics/use-analytics.js', () => ({
  useSavedFiltersQuery: () => ({ data: [] }),
  useCreateSavedFilterMutation: () => ({ mutate: save, isPending: false }),
  useDeleteSavedFilterMutation: () => ({ mutate: vi.fn(), isPending: false }),
}))
vi.mock('../../src/features/work/components/filter-clause-chips.js', () => ({
  FilterClauseChips: () => null,
}))
beforeEach(() => {
  setLocale('en')
  save.mockClear()
})

it('saves the applied chart filter rather than an unapplied advanced-editor draft', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  render(
    <FilterBar
      value={{ filter: 'status:active', since: '2026-10-01', until: '2026-10-08' }}
      onChange={onChange}
    />,
  )
  await user.click(screen.getByRole('button', { name: 'Advanced' }))
  await user.clear(screen.getByRole('textbox', { name: 'assignee:@me status:active due:<today' }))
  await user.type(
    screen.getByRole('textbox', { name: 'assignee:@me status:active due:<today' }),
    'status:done',
  )
  await user.click(screen.getByRole('button', { name: 'Save filter' }))
  expect(screen.getByRole('textbox', { name: 'Filter name' })).toHaveValue('status:active')
  await user.click(screen.getByRole('button', { name: 'Save' }))
  expect(save).toHaveBeenCalledWith(
    { name: 'status:active', query: 'status:active', sinceDays: 7 },
    expect.objectContaining({ onSuccess: expect.any(Function) }),
  )
  expect(onChange).not.toHaveBeenCalled()
})
