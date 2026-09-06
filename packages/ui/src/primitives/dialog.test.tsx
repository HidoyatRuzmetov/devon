import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Dialog, DialogContent, DialogTrigger } from './dialog.js'
import { Button } from './button.js'

describe('Dialog', () => {
  it('opens with a labelled title and traps focus; Escape closes it', async () => {
    const user = userEvent.setup()
    render(
      <Dialog>
        <DialogTrigger asChild>
          <Button>Ochish</Button>
        </DialogTrigger>
        <DialogContent title="Klaviatura yorliqlari">
          <p>Tarkib</p>
        </DialogContent>
      </Dialog>,
    )
    await user.click(screen.getByRole('button', { name: 'Ochish' }))
    expect(await screen.findByRole('dialog', { name: 'Klaviatura yorliqlari' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
