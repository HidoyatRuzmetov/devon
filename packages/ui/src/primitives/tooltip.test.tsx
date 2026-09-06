import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './tooltip.js'
import { Button } from './button.js'

describe('Tooltip', () => {
  it('renders a trigger and mounts the (open) content in the DOM', () => {
    render(
      <TooltipProvider>
        <Tooltip open>
          <TooltipTrigger asChild>
            <Button>Nusxa olish</Button>
          </TooltipTrigger>
          <TooltipContent>Nusxa olindi</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    )
    expect(screen.getByRole('button', { name: 'Nusxa olish' })).toBeInTheDocument()
    expect(screen.getAllByText('Nusxa olindi').length).toBeGreaterThan(0)
  })
})
