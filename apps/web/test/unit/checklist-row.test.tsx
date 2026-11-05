import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { setLocale } from '@devon/i18n'
import { ChecklistRow } from '../../src/features/work/components/checklist-row.js'
import { TooltipProvider } from '@devon/ui'
import userEvent from '@testing-library/user-event'

vi.mock('../../src/features/work/components/checklist-discussion.js', () => ({
  ChecklistDiscussion: ({ open, itemId }: { open: boolean; itemId: string }) =>
    open ? <div role="region" aria-label={`Thread ${itemId}`} /> : null,
}))

describe('checklist rows', () => {
  it('associates each text label with its own checkbox and edits without toggling completion', async () => {
    setLocale('en')
    const firstToggle = vi.fn()
    const secondToggle = vi.fn()
    const save = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(
      <>
        <ChecklistRow
          cardId="card"
          item={{ id: 'first', text: 'First item', doneAt: null }}
          canEdit
          onToggle={firstToggle}
          onSave={save}
          onDelete={vi.fn()}
        />
        <ChecklistRow
          cardId="card"
          item={{ id: 'second', text: 'Second item', doneAt: null }}
          canEdit
          onToggle={secondToggle}
          onSave={save}
          onDelete={vi.fn()}
        />
      </>,
      { wrapper: TooltipProvider },
    )
    fireEvent.click(screen.getByText('Second item'))
    expect(secondToggle).toHaveBeenCalledWith(true)
    expect(firstToggle).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Actions for Second item' }))
    await user.click(screen.getByRole('menuitem', { name: 'Edit checklist item' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Edit checklist item' }), {
      target: { value: 'Revised item' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save item' }))
    await waitFor(() => expect(save).toHaveBeenCalledWith('Revised item'))
    expect(secondToggle).toHaveBeenCalledTimes(1)
    expect(firstToggle).not.toHaveBeenCalled()
  })
  it('explains unavailable editing while leaving discussion available on a read-only card', async () => {
    setLocale('en')
    const user = userEvent.setup()
    const remove = vi.fn()
    render(
      <ChecklistRow
        cardId="card"
        item={{ id: 'readonly', text: 'Read only', doneAt: null }}
        canEdit={false}
        onToggle={vi.fn()}
        onSave={vi.fn()}
        onDelete={remove}
      />,
      { wrapper: TooltipProvider },
    )
    expect(screen.getByRole('checkbox')).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Actions for Read only' }))
    expect(screen.getByRole('menuitem', { name: 'Edit checklist item' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    const deleteItem = screen.getByRole('menuitem', { name: 'Delete' })
    expect(deleteItem).toHaveAttribute('aria-disabled', 'true')
    expect(deleteItem).toHaveAttribute('title')
    await user.click(deleteItem)
    expect(remove).not.toHaveBeenCalled()
    await user.click(screen.getByRole('menuitem', { name: 'Add a comment' }))
    expect(screen.getByRole('region', { name: 'Thread readonly' })).toBeInTheDocument()
  })
  it('protects agreed wording, deletion and check-in removal without locking comments', async () => {
    setLocale('en')
    const user = userEvent.setup()
    const toggleSelection = vi.fn()
    const remove = vi.fn()
    render(
      <ChecklistRow
        cardId="card"
        item={{
          id: 'agreed',
          text: 'Agreed result',
          doneAt: null,
          textLocked: true,
          deletionProtected: true,
          commentCount: 2,
        }}
        canEdit
        onToggle={vi.fn()}
        onSave={vi.fn()}
        onDelete={remove}
        checkin={{ selected: true, disabled: true, toggle: toggleSelection }}
      />,
      { wrapper: TooltipProvider },
    )
    await user.click(screen.getByRole('button', { name: 'Actions for Agreed result' }))
    expect(screen.getByRole('menuitem', { name: 'Edit checklist item' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    const selection = screen.getByRole('menuitem', { name: /Remove/ })
    expect(selection).toHaveAttribute('aria-disabled', 'true')
    await user.click(selection)
    expect(toggleSelection).not.toHaveBeenCalled()
    await user.click(screen.getByRole('menuitem', { name: 'Comments (2)' }))
    expect(screen.getByRole('region', { name: 'Thread agreed' })).toBeInTheDocument()
    expect(remove).not.toHaveBeenCalled()
  })
})
