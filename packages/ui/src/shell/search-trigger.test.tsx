import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SearchTrigger } from './search-trigger.js'

describe('SearchTrigger', () => {
  it('reads as a labelled field with the shortcut printed inside it (AC-8: discovered by reading)', () => {
    render(<SearchTrigger label="Qidirish yoki amal" onClick={() => {}} />)
    const trigger = screen.getByRole('button', { name: /Qidirish yoki amal/ })
    expect(trigger).toHaveTextContent('K')
  })

  it('calls onClick when activated', async () => {
    const onClick = vi.fn()
    render(<SearchTrigger label="Qidirish yoki amal" onClick={onClick} />)
    await userEvent.click(screen.getByRole('button'))
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('collapses to an icon-only 44px control with the same accessible name when compact', () => {
    render(<SearchTrigger label="Qidirish yoki amal" onClick={() => {}} compact />)
    expect(screen.getByRole('button', { name: 'Qidirish yoki amal' })).toHaveClass('size-11')
  })
})
