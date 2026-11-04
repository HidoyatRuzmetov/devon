import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setLocale } from '@devon/i18n'
import type { Card } from '../../src/features/work/api.js'
import MineScreen from '../../src/features/work/components/mine-screen.js'
import { isCardCompleted } from '../../src/features/work/lib/format.js'

const mocks = vi.hoisted(() => ({ cards: [] as Card[], mutate: vi.fn(), open: vi.fn() }))
vi.mock('../../src/features/work/hooks.js', () => ({
  useCardsQuery: () => ({ data: mocks.cards }),
  usePatchCardMutation: () => ({ mutate: mocks.mutate, isPending: false }),
}))
vi.mock('../../src/lib/router.js', () => ({ useSearchParams: () => new URLSearchParams() }))
vi.mock('../../src/lib/realtime/index.js', () => ({ useCardSignals: () => [] }))
vi.mock('../../src/features/work/components/work-shell.js', () => ({
  WorkShell: ({ children }: { children: ReactNode }) => children,
}))
vi.mock('../../src/features/work/components/focus-list.js', () => ({ FocusList: () => null }))
vi.mock('../../src/features/work/components/card-peek-dialog.js', () => ({
  CardPeekDialog: () => null,
  openCardPeek: mocks.open,
}))

function card(overrides: Partial<Card> = {}): Card {
  return {
    id: 'card',
    kind: 'task',
    title: 'Preserved task',
    description: null,
    assigneeUserId: 'me',
    giverUserId: 'me',
    projectId: null,
    projectScope: 'none',
    status: 'done',
    workStage: 'todo',
    priority: 'none',
    risk: 'none',
    startAt: null,
    dueAt: null,
    doneAt: null,
    archivedAt: '2026-10-21T00:00:00Z',
    orderKey: 'a',
    labels: [],
    watchers: [],
    links: [],
    checklistTotal: 0,
    checklistDone: 0,
    commentCount: 0,
    createdByUserId: 'me',
    createdAt: '2026-10-20T00:00:00Z',
    updatedAt: '2026-10-21T00:00:00Z',
    version: 1,
    canEdit: true,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  setLocale('en')
  mocks.cards = []
})

describe('completed task presentation after archive retirement', () => {
  it('preserves completed tasks and lets their owner reopen them explicitly', async () => {
    mocks.cards = [card({ doneAt: '2026-10-20T12:00:00Z' })]
    render(<MineScreen />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Completed (1)' }))
    expect(screen.getByText('Preserved task')).toHaveClass('line-through')
    expect(screen.queryByText('Archived')).not.toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: 'Preserved task' }))
    expect(mocks.mutate).toHaveBeenCalledWith({ id: 'card', patch: { status: 'active' } })
  })
  it('permits completing active work and respects read-only permissions', async () => {
    mocks.cards = [card({ status: 'active', title: 'Active task', archivedAt: null })]
    const user = userEvent.setup()
    const { rerender } = render(<MineScreen />)
    await user.click(screen.getByRole('checkbox', { name: 'Active task' }))
    expect(mocks.mutate).toHaveBeenCalledWith({ id: 'card', patch: { status: 'done' } })
    mocks.cards = [card({ status: 'active', title: 'Read only', canEdit: false })]
    rerender(<MineScreen />)
    expect(screen.getByRole('checkbox', { name: 'Read only' })).toBeDisabled()
  })
  it('uses current status, not historical completion timestamps, when a task was reopened', () => {
    expect(isCardCompleted({ status: 'active', doneAt: '2026-10-20T12:00:00Z' })).toBe(false)
    expect(isCardCompleted({ status: 'done' })).toBe(true)
  })
})
