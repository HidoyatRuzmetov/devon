import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Button } from './button.js'

describe('Button', () => {
  it('renders its label and responds to a click', async () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Saqlash</Button>)
    const button = screen.getByRole('button', { name: 'Saqlash' })
    await userEvent.click(button)
    expect(onClick).toHaveBeenCalledOnce()
  })

  it.each(['primary', 'secondary', 'ghost', 'destructive'] as const)(
    'renders the %s variant without throwing',
    (variant) => {
      render(<Button variant={variant}>Yuborish</Button>)
      expect(screen.getByRole('button', { name: 'Yuborish' })).toBeInTheDocument()
    },
  )

  it('disables itself and shows a busy state while loading, keeping the label for screen readers', () => {
    render(<Button loading>Yuklanmoqda</Button>)
    const button = screen.getByRole('button')
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
    expect(button).toHaveTextContent('Yuklanmoqda')
  })

  it('renders the child element in place of a <button> when asChild is set', () => {
    render(
      <Button asChild>
        <a href="/home">Bosh sahifa</a>
      </Button>,
    )
    const link = screen.getByRole('link', { name: 'Bosh sahifa' })
    expect(link).toHaveAttribute('href', '/home')
  })
})
