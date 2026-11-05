import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setLocale } from '@devon/i18n'
import { TooltipProvider } from '@devon/ui'
import { ChecklistDiscussion } from '../../src/features/work/components/checklist-discussion.js'

const fixture = vi.hoisted(() => ({
  comments: [] as Array<{
    id: string
    cardId: string
    authorUserId: string
    body: { format: 'markdown'; text: string }
    mentions: string[]
    createdAt: string
    editedAt: string | null
    canEdit: boolean
    canDelete: boolean
  }>,
  mutate: vi.fn(),
  mutateAsync: vi.fn(),
}))
vi.mock('../../src/features/work/checklist-comments.js', () => ({
  useChecklistComments: () => ({ data: fixture.comments, isPending: false, isError: false }),
  useChecklistCommentChange: () => ({
    mutate: fixture.mutate,
    mutateAsync: fixture.mutateAsync,
    isPending: false,
  }),
}))
vi.mock('../../src/features/work/hooks.js', () => ({
  useMembers: () => [
    { userId: 'viewer', givenName: 'Current', familyName: 'Member', avatarKey: null },
  ],
}))
vi.mock('../../src/lib/session.js', () => ({
  useSession: () => ({ user: { id: 'viewer' } }),
  useDepartment: () => ({ department: { role: 'head' } }),
}))

describe('checklist discussion', () => {
  beforeEach(() => {
    setLocale('en')
    fixture.comments = []
    fixture.mutate.mockReset()
    fixture.mutateAsync.mockReset().mockResolvedValue(undefined)
    window.location.hash = ''
  })

  it('preserves an unsent reply through collapse and sends it once with Ctrl+Enter', async () => {
    const props = {
      cardId: 'card',
      itemId: 'step',
      itemText: 'Reconcile figures',
      onClose: vi.fn(),
    }
    const view = render(<ChecklistDiscussion {...props} open />, { wrapper: TooltipProvider })
    fireEvent.change(screen.getByRole('textbox', { name: 'Add a comment' }), {
      target: { value: 'Numbers are checked.' },
    })
    view.rerender(<ChecklistDiscussion {...props} open={false} />)
    await waitFor(() => expect(screen.queryByRole('textbox')).not.toBeInTheDocument())
    view.rerender(<ChecklistDiscussion {...props} open />)
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Add a comment' })).toHaveValue(
        'Numbers are checked.',
      ),
    )
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', ctrlKey: true })
    await waitFor(() =>
      expect(fixture.mutateAsync).toHaveBeenCalledWith({
        kind: 'add',
        text: 'Numbers are checked.',
      }),
    )
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue(''))
    expect(fixture.mutateAsync).toHaveBeenCalledTimes(1)
  })

  it('keeps text after a failed send and keeps Enter available for a newline', async () => {
    fixture.mutateAsync.mockRejectedValueOnce(new Error('offline'))
    render(
      <ChecklistDiscussion
        cardId="card"
        itemId="step"
        itemText="Reconcile figures"
        open
        onClose={vi.fn()}
      />,
      { wrapper: TooltipProvider },
    )
    const input = screen.getByRole('textbox', { name: 'Add a comment' })
    fireEvent.change(input, { target: { value: 'Keep this draft' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(fixture.mutateAsync).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Send comment' }))
    await waitFor(() => expect(fixture.mutateAsync).toHaveBeenCalledTimes(1))
    expect(input).toHaveValue('Keep this draft')
  })

  it('uses server permissions even when the viewer is both author and head', () => {
    fixture.comments = [
      {
        id: 'comment',
        cardId: 'card',
        authorUserId: 'viewer',
        body: { format: 'markdown', text: 'A protected comment' },
        mentions: [],
        createdAt: '2026-11-05T09:00:00Z',
        editedAt: null,
        canEdit: false,
        canDelete: false,
      },
    ]
    const close = vi.fn()
    const parentEscape = vi.fn()
    render(
      <ChecklistDiscussion
        cardId="card"
        itemId="step"
        itemText="Reconcile figures"
        open
        onClose={close}
      />,
      { wrapper: TooltipProvider },
    )
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
    document.body.addEventListener('keydown', parentEscape)
    try {
      fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' })
      expect(close).toHaveBeenCalledOnce()
      expect(parentEscape).not.toHaveBeenCalled()
    } finally {
      document.body.removeEventListener('keydown', parentEscape)
    }
  })
})
