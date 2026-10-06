import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { setLocale } from '@devon/i18n'
import { ChecklistRow } from '../../src/features/work/components/checklist-row.js'

describe('checklist rows', () => {
  it('associates each text label with its own checkbox and edits without toggling completion', async () => {
    setLocale('en')
    const firstToggle = vi.fn()
    const secondToggle = vi.fn()
    const save = vi.fn().mockResolvedValue(undefined)
    render(
      <>
        <ChecklistRow
          item={{ id: 'first', text: 'First item', doneAt: null }}
          canEdit
          onToggle={firstToggle}
          onSave={save}
          onDelete={vi.fn()}
        />
        <ChecklistRow
          item={{ id: 'second', text: 'Second item', doneAt: null }}
          canEdit
          onToggle={secondToggle}
          onSave={save}
          onDelete={vi.fn()}
        />
      </>,
    )
    fireEvent.click(screen.getByText('Second item'))
    expect(secondToggle).toHaveBeenCalledWith(true)
    expect(firstToggle).not.toHaveBeenCalled()
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit checklist item' })[1]!)
    fireEvent.change(screen.getByRole('textbox', { name: 'Edit checklist item' }), {
      target: { value: 'Revised item' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save item' }))
    await waitFor(() => expect(save).toHaveBeenCalledWith('Revised item'))
    expect(secondToggle).toHaveBeenCalledTimes(1)
    expect(firstToggle).not.toHaveBeenCalled()
  })
  it('shows no editing actions for a read-only card', () => {
    setLocale('en')
    render(
      <ChecklistRow
        item={{ id: 'readonly', text: 'Read only', doneAt: null }}
        canEdit={false}
        onToggle={vi.fn()}
        onSave={vi.fn()}
        onDelete={vi.fn()}
      />,
    )
    expect(screen.getByRole('checkbox')).toBeDisabled()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
