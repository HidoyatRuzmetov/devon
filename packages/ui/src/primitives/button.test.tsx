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

  it('prevents another activation while loading even when the caller passes disabled=false', async () => {
    const onClick = vi.fn()
    render(
      <Button loading disabled={false} onClick={onClick}>
        Saqlash
      </Button>,
    )
    const button = screen.getByRole('button', { name: 'Saqlash' })
    expect(button).toBeDisabled()
    await userEvent.click(button)
    expect(onClick).not.toHaveBeenCalled()
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

  // Regression for a twMerge classGroup collision: `cn()` used to keep only the last `text-*`
  // class it saw, so a size class written after the variant's colour class (size="lg" -> text-lead,
  // size="sm" -> text-small) silently deleted `text-primary-foreground` / `text-destructive-foreground`,
  // rendering the label near-black on a coloured button at every size except the accidental survivor
  // `md`. See packages/ui/src/lib/cn.ts.
  it.each(['sm', 'md', 'lg'] as const)(
    'keeps the primary label colour class at size %s',
    (size) => {
      render(
        <Button variant="primary" size={size}>
          Kirish
        </Button>,
      )
      const button = screen.getByRole('button', { name: 'Kirish' })
      expect(button.className.split(/\s+/)).toContain('text-primary-foreground')
    },
  )

  it.each(['sm', 'md', 'lg'] as const)(
    'keeps the destructive label colour class at size %s',
    (size) => {
      render(
        <Button variant="destructive" size={size}>
          Bekor qilish
        </Button>,
      )
      const button = screen.getByRole('button', { name: 'Bekor qilish' })
      expect(button.className.split(/\s+/)).toContain('text-destructive-foreground')
    },
  )
})
