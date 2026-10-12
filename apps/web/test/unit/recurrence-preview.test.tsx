import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { cardDetailSchema, type CardDetail } from '../../src/features/work/api.js'

vi.mock('@devon/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useT: () => (key: string, values?: { date?: string }) =>
    values?.date ? `${key}: ${values.date}` : key,
  useLocale: () => 'en',
  formatDate: (date: Date) => date.toISOString().slice(0, 10),
}))
// Neighboring panels are not this regression's subject and would require unrelated API providers.
vi.mock('../../src/features/work/components/dependencies-panel.js', () => ({
  DependenciesPanel: () => null,
}))
vi.mock('../../src/features/work/components/reminders-panel.js', () => ({
  RemindersPanel: () => null,
}))
vi.mock('../../src/features/work/components/time-log-panel.js', () => ({
  TimeLogPanel: () => null,
}))

import { CardPlusSections } from '../../src/features/work/components/card-plus-sections.js'

const card: CardDetail = cardDetailSchema.parse({
  id: 'example-card',
  kind: 'task',
  title: 'Review the register',
  description: null,
  assigneeUserId: 'owner',
  giverUserId: null,
  projectId: null,
  projectScope: 'none',
  status: 'active',
  priority: 'none',
  risk: 'overdue',
  startAt: null,
  dueAt: '2026-10-06T04:00:00.000Z',
  doneAt: null,
  archivedAt: null,
  orderKey: 'a0',
  labels: [],
  watchers: [],
  links: [],
  checklistTotal: 0,
  checklistDone: 0,
  commentCount: 0,
  createdByUserId: 'owner',
  createdAt: '2026-10-01T04:00:00.000Z',
  updatedAt: '2026-10-09T09:41:32.000Z',
  version: 1,
  recurrence: { mode: 'after_done', freq: 'daily', interval: 1 },
  checklist: [],
  comments: [],
  activity: [],
})
function show(overrides: Partial<CardDetail> = {}) {
  const rendered = render(
    <CardPlusSections
      card={{ ...card, ...overrides }}
      canEdit
      members={[]}
      onOpenCard={vi.fn()}
      onEstimateChange={vi.fn()}
      onRecurrenceChange={vi.fn()}
    />,
  )
  const preview = rendered.container.querySelector(
    '#card-repeat-example-card [aria-live="polite"]',
  )!
  return { ...rendered, preview }
}

describe('recurrence explanation matches the selected task workflow', () => {
  it('does not promise an overdue fixed date for unfinished after-done work', () => {
    const { preview } = show()
    expect(preview).toHaveTextContent('work.recurrence.mode.afterDone')
    expect(preview).not.toHaveTextContent('2026-10-07')
  })
  it.each([
    { status: 'archived' as const, doneAt: null, archivedAt: '2026-10-09T09:41:32.000Z' },
    { status: 'done' as const, doneAt: '2026-10-09T09:41:32.000Z', archivedAt: null },
  ])('uses actual $status completion for the visible next date', (completion) => {
    const { preview } = show(completion)
    expect(preview).toHaveTextContent('work.recurrence.nextPreview: 2026-10-10')
  })
  it('keeps scheduled dates and switches the explanation when the user changes recurrence mode', () => {
    const { preview } = show({ recurrence: { ...card.recurrence!, mode: 'schedule' } })
    expect(preview).toHaveTextContent('work.recurrence.nextPreview: 2026-10-07')
    fireEvent.click(screen.getByRole('radio', { name: /work.recurrence.mode.afterDone/ }))
    expect(preview).toHaveTextContent('work.recurrence.mode.afterDone')
    expect(preview).not.toHaveTextContent('2026-10-07')
    fireEvent.click(screen.getByRole('radio', { name: /work.recurrence.mode.schedule/ }))
    expect(preview).toHaveTextContent('work.recurrence.nextPreview: 2026-10-07')
  })
})
