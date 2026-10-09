import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Checkbox } from './checkbox.js'

describe('Checkbox visual state', () => {
  it('keeps the visible check synchronized when uncontrolled', async () => {
    const change = vi.fn()
    render(<Checkbox defaultChecked onCheckedChange={change} aria-label="Selected item" />)
    const checkbox = screen.getByRole('checkbox', { name: 'Selected item' })
    expect(checkbox).toBeChecked()
    expect(checkbox.querySelector('path')).toHaveStyle({ opacity: '1' })
    await userEvent.click(checkbox)
    expect(checkbox).not.toBeChecked()
    await waitFor(() => expect(checkbox.querySelector('path')).toHaveStyle({ opacity: '0' }))
    expect(change).toHaveBeenCalledWith(false)
  })

  it('does not execute while disabled', async () => {
    const change = vi.fn()
    render(<Checkbox disabled checked={false} onCheckedChange={change} aria-label="Unavailable" />)
    await userEvent.click(screen.getByRole('checkbox', { name: 'Unavailable' }))
    expect(change).not.toHaveBeenCalled()
  })
})
