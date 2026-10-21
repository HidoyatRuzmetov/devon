import * as React from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setLocale } from '@devon/i18n'
import { TooltipProvider } from '@devon/ui'
import {
  UnitTree,
  type TreeActions,
  type TreeNode,
} from '../../src/features/structure/unit-tree.js'

const unit: TreeNode = {
  id: 'unit-a',
  path: 'unit-a',
  parentUnitId: null,
  name: 'Research',
  colour: null,
  sort: 0,
  version: 1,
  expectedPeople: 6,
  children: [],
}
function setup(isHead = true) {
  const actions: TreeActions = {
    isHead,
    canEditStructure: isHead,
    canSelfAssign: false,
    currentUserId: 'member-a',
    rolesByUnit: new Map(),
    membersById: new Map(),
    memberCountByUnit: new Map([[unit.id, 2]]),
    onExpectedPeopleChange: vi.fn(),
    onRename: vi.fn(),
    onColourChange: vi.fn(),
    onAddChild: vi.fn(),
    onDelete: vi.fn(),
    onReorderSiblings: vi.fn(),
    onReparent: vi.fn(),
    onSelfAssign: vi.fn(),
    onOpenAssign: vi.fn(),
    onUnassign: vi.fn(),
  }
  render(
    <TooltipProvider>
      <UnitTree roots={[unit]} actions={actions} />
    </TooltipProvider>,
  )
  return {
    actions,
    mobile: within(screen.getByTestId('mobile-unit-staffing')),
    user: userEvent.setup(),
  }
}
beforeEach(() => setLocale('en'))

describe('unit staffing on compact screens', () => {
  it('lets a head save the mobile staffing target by pressing Enter', async () => {
    const { actions, mobile, user } = setup()
    const input = mobile.getByRole('spinbutton', { name: 'Expected people' })
    expect(input).toHaveValue(6)
    await user.clear(input)
    await user.type(input, '8{Enter}')
    expect(actions.onExpectedPeopleChange).toHaveBeenCalledExactlyOnceWith(unit.id, 8)
  })

  it('rejects invalid counts and supports removing an expected target', async () => {
    const { actions, mobile, user } = setup()
    const input = mobile.getByRole('spinbutton', { name: 'Expected people' })
    await user.clear(input)
    await user.type(input, '-1{Enter}')
    expect(actions.onExpectedPeopleChange).not.toHaveBeenCalled()
    await user.clear(input)
    await user.tab()
    expect(actions.onExpectedPeopleChange).toHaveBeenCalledExactlyOnceWith(unit.id, null)
  })

  it('shows members the actual and expected count without giving edit controls', () => {
    const { mobile } = setup(false)
    expect(mobile.queryByRole('spinbutton')).not.toBeInTheDocument()
    expect(mobile.getByText('6')).toBeInTheDocument()
    expect(mobile.getByText(/2/)).toBeInTheDocument()
  })
})
