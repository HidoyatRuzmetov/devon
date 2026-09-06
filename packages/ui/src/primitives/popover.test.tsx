import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Popover, PopoverContent, PopoverTrigger } from './popover.js'
import { Button } from './button.js'

describe('Popover', () => {
  it('opens its content on trigger click and closes on Escape', async () => {
    render(
      <Popover>
        <PopoverTrigger asChild>
          <Button>Demo maʼlumotlar</Button>
        </PopoverTrigger>
        <PopoverContent>Namoyish rejimi.</PopoverContent>
      </Popover>,
    )
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Demo maʼlumotlar' }))
    expect(await screen.findByText('Namoyish rejimi.')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByText('Namoyish rejimi.')).not.toBeInTheDocument()
  })
})
