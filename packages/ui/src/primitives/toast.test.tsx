import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Toaster, toastWithUndo } from './toast.js'

describe('Toaster / toastWithUndo', () => {
  it('renders the Toaster region and shows an undo toast with a working action', async () => {
    render(<Toaster />)
    const onUndo = vi.fn()
    toastWithUndo({ message: 'Nusxa olindi', undoLabel: 'Bekor qilish', onUndo })

    expect(await screen.findByText('Nusxa olindi')).toBeInTheDocument()
    const undo = await screen.findByRole('button', { name: 'Bekor qilish' })
    await userEvent.click(undo)
    expect(onUndo).toHaveBeenCalledOnce()
  })
})
