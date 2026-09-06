import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Sheet, SheetContent, SheetTrigger } from './sheet.js'
import { IconButton } from './icon-button.js'
import { Menu } from 'lucide-react'

describe('Sheet', () => {
  it('opens the drawer with a (visually hidden) accessible title', async () => {
    const user = userEvent.setup()
    render(
      <Sheet direction="left">
        <SheetTrigger asChild>
          <IconButton aria-label="Menyuni ochish">
            <Menu aria-hidden="true" />
          </IconButton>
        </SheetTrigger>
        <SheetContent title="Yon panel" side="left">
          <p>Bosh sahifa</p>
        </SheetContent>
      </Sheet>,
    )
    await user.click(screen.getByRole('button', { name: 'Menyuni ochish' }))
    expect(await screen.findByText('Bosh sahifa')).toBeInTheDocument()
  })
})
