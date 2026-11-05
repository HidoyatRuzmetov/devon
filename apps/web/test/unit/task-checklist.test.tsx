import * as React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import { setLocale } from '@devon/i18n'
import { TooltipProvider } from '@devon/ui'
import type { Card, ChecklistItem } from '../../src/features/work/api.js'
import { TaskChecklist } from '../../src/features/work/components/task-checklist.js'

const state = vi.hoisted(() => ({ selected: false, change: vi.fn() }))
vi.mock('../../src/features/work/hooks.js', () => ({
  useCardQuery: () => ({ data: undefined, isPending: false, isError: false }),
  useAddChecklistItemMutation: () => ({ isPending: false, mutate: vi.fn() }),
  useDeleteChecklistItemMutation: () => ({ mutate: vi.fn() }),
  usePatchChecklistItemMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn() }),
}))
vi.mock('../../src/features/analytics/checkin-locks.js', () => ({ memberLock: () => undefined }))
vi.mock('../../src/features/analytics/checkins-api.js', () => ({
  useCheckins: () => ({
    data: {
      currentCycleId: 'cycle',
      cycles: [{ id: 'cycle' }],
      members: [{ userId: 'member' }],
      entries: state.selected
        ? [{ id: 'entry', cycleId: 'cycle', checklistItemId: 'item', memberUserId: 'member' }]
        : [],
    },
  }),
  useCheckinChange: () => ({ isPending: false, mutate: state.change }),
}))
vi.mock('../../src/features/work/components/checklist-discussion.js', () => ({
  ChecklistDiscussion: () => null,
}))

beforeEach(() => {
  state.selected = false
  state.change.mockClear()
  setLocale('en')
})

function showDoneTask() {
  const card = {
    id: 'card',
    status: 'done',
    doneAt: '2026-11-05T10:00:00Z',
    assigneeUserId: 'member',
    canEdit: true,
  } as Card
  const items = [
    { id: 'item', cardId: 'card', text: 'Pending item on a completed task', doneAt: null },
  ] as ChecklistItem[]
  return render(<TaskChecklist cardId="card" card={card} items={items} />, {
    wrapper: TooltipProvider,
  })
}

it('explains why pending items on completed tasks cannot become new deliverables', async () => {
  showDoneTask()
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: /Actions for/ }))
  const action = screen.getByRole('menuitem', { name: 'Add to check-in' })
  expect(action).toHaveAttribute('aria-disabled', 'true')
  expect(action).toHaveAttribute(
    'title',
    'This card is already done. Reopen it before adding a deliverable.',
  )
  await user.click(action)
  expect(state.change).not.toHaveBeenCalled()
})

it('keeps permitted removal available for an existing deliverable on a completed task', async () => {
  state.selected = true
  showDoneTask()
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: /Actions for/ }))
  const action = screen.getByRole('menuitem', { name: 'Remove from check-in' })
  expect(action).toHaveAttribute('aria-disabled', 'false')
  await user.click(action)
  expect(state.change).toHaveBeenCalledWith({ kind: 'remove', id: 'entry' })
})
