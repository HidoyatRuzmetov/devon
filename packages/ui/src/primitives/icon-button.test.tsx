import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Menu } from 'lucide-react'
import { IconButton } from './icon-button.js'

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
})
