import type { ReactNode } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setLocale } from '@devon/i18n'
import type { Card } from '../../src/features/work/api.js'
import MineScreen from '../../src/features/work/components/mine-screen.js'
import { CardTile } from '../../src/features/work/components/card-tile.js'
import { ArchivedCardBadge } from '../../src/features/work/components/archived-card-badge.js'
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
    title: 'Unfinished archive',
    description: null,
    assigneeUserId: 'me',
    giverUserId: 'me',
    projectId: null,
    projectScope: 'none',
    status: 'archived',
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

describe('archived card presentation', () => {
  it('keeps completed and unfinished archives distinct and never restores one through a checkbox', async () => {
    mocks.cards = [
      card(),
      card({ id: 'finished', title: 'Completed archive', doneAt: '2026-10-20T12:00:00Z' }),
      card({ id: 'done', title: 'Completed task', status: 'done', doneAt: '2026-10-20T12:00:00Z' }),
    ]
    const user = userEvent.setup()
    render(<MineScreen />)
    await user.click(screen.getByRole('button', { name: 'Completed & archived (3)' }))

    expect(screen.getByText('Unfinished archive')).not.toHaveClass('line-through')
    expect(screen.getByText('Completed archive')).toHaveClass('line-through')
    expect(screen.getByText('Completed task')).toHaveClass('line-through')
    expect(screen.getByLabelText('Archived · Not completed')).toHaveTextContent('Archived')
    expect(screen.getByLabelText('Archived · Completed')).toHaveTextContent('Archived')
    const unfinished = screen.getByRole('checkbox', { name: 'Unfinished archive' })
    const finished = screen.getByRole('checkbox', { name: 'Completed archive' })
    expect(unfinished).toBeDisabled()
    expect(unfinished).not.toBeChecked()
    expect(finished).toBeDisabled()
    expect(finished).toBeChecked()
    await user.click(unfinished)
    await user.click(finished)
    expect(mocks.mutate).not.toHaveBeenCalled()

    // Archived details remain reachable, including the existing explicit Restore action.
    await user.click(screen.getByText('Unfinished archive'))
    expect(mocks.open).toHaveBeenCalledWith('card')
    await user.click(screen.getByRole('checkbox', { name: 'Completed task' }))
    expect(mocks.mutate).toHaveBeenCalledWith({ id: 'done', patch: { status: 'active' } })
  })

  it('still permits completing active work and respects read-only permissions', async () => {
    mocks.cards = [card({ status: 'active', title: 'Active task', archivedAt: null })]
    const user = userEvent.setup()
    const { rerender } = render(<MineScreen />)
    await user.click(screen.getByRole('checkbox', { name: 'Active task' }))
    expect(mocks.mutate).toHaveBeenCalledWith({ id: 'card', patch: { status: 'done' } })
    mocks.cards = [card({ status: 'active', title: 'Read only', canEdit: false })]
    rerender(<MineScreen />)
    expect(screen.getByRole('checkbox', { name: 'Read only' })).toBeDisabled()
  })

  it.each([null, '2026-10-20T12:00:00Z'])(
    'shows the same archive cue on board tiles with doneAt=%s',
    async (doneAt) => {
      const current = card({ doneAt, canEdit: false })
      const onOpen = vi.fn()
      render(
        <CardTile
          card={current}
          columnUserId="me"
          members={[]}
          labels={[]}
          onOpen={onOpen}
          onDropped={vi.fn()}
          onMoveTo={vi.fn()}
        />,
      )
      const cue = screen.getByLabelText(
        doneAt ? 'Archived · Completed' : 'Archived · Not completed',
      )
      expect(cue.querySelector('svg.lucide-archive')).not.toBeNull()
      expect(within(cue).getByText('Archived')).toBeVisible()
      expect(screen.getByText(current.title).classList.contains('line-through')).toBe(
        Boolean(doneAt),
      )
      await userEvent.click(screen.getByRole('button', { name: current.title }))
      expect(onOpen).toHaveBeenCalledWith(current.id)
    },
  )

  it('does not invent completion from an old reference DTO that omits doneAt', () => {
    render(<ArchivedCardBadge card={{ status: 'archived' }} />)
    expect(screen.getByLabelText('Archived')).toBeVisible()
    expect(screen.queryByLabelText('Archived · Not completed')).not.toBeInTheDocument()
    expect(isCardCompleted({ status: 'archived' })).toBe(false)
    expect(isCardCompleted({ status: 'active', doneAt: '2026-10-20T12:00:00Z' })).toBe(false)
  })
})
