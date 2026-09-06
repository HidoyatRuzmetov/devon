import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Input } from './input.js'

describe('Input', () => {
  it('accepts typed text via its label', async () => {
    render(
      <>
        <label htmlFor="login">Login yoki e-pochta</label>
        <Input id="login" />
      </>,
    )
    const input = screen.getByLabelText('Login yoki e-pochta')
    await userEvent.type(input, 'aziz.b')
    expect(input).toHaveValue('aziz.b')
  })

  it('marks itself invalid for assistive tech when the invalid prop is set', () => {
    render(<Input aria-label="Parol" invalid />)
    expect(screen.getByLabelText('Parol')).toHaveAttribute('aria-invalid', 'true')
  })
})
