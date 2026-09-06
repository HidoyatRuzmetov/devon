import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DemoChip } from './demo-chip.js'

describe('DemoChip', () => {
  it('is a focusable button that opens an explanatory popover, not a silent badge', async () => {
    render(<DemoChip label="Demo" popoverText="Namoyish rejimi." />)
    const chip = screen.getByRole('button', { name: 'Demo' })
    await userEvent.click(chip)
    expect(await screen.findByText('Namoyish rejimi.')).toBeInTheDocument()
  })
})
