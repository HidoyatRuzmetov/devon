import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Menu } from 'lucide-react'
import { IconButton } from './icon-button.js'
import userEvent from '@testing-library/user-event'
import { TooltipProvider } from './tooltip.js'

describe('IconButton', () => {
  it('requires and exposes an accessible name', () => {
    render(
      <IconButton aria-label="Menyuni ochish">
        <Menu aria-hidden="true" />
      </IconButton>,
    )
    expect(screen.getByRole('button', { name: 'Menyuni ochish' })).toBeInTheDocument()
  })

  it('renders the 44px touch-target size variant', () => {
    render(
      <IconButton aria-label="Qidirish" size="touch">
        <Menu aria-hidden="true" />
      </IconButton>,
    )
    expect(screen.getByRole('button')).toHaveClass('size-11')
  })

  it('shows contextual help through keyboard focus while preserving its accessible name', async () => {
    render(
      <TooltipProvider delayDuration={0}>
        <IconButton aria-label="Edit milestone: Review" tooltip="Edit milestone">
          <Menu aria-hidden="true" />
        </IconButton>
      </TooltipProvider>,
    )
    await userEvent.tab()
    expect(screen.getByRole('button', { name: 'Edit milestone: Review' })).toHaveFocus()
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Edit milestone')
  })
})
