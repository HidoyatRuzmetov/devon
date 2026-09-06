import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { Skeleton } from './skeleton.js'

describe('Skeleton', () => {
  it('renders as a presentation-only, aria-hidden block at the caller-given size', () => {
    const { container } = render(<Skeleton className="h-9 w-70" />)
    const el = container.firstElementChild as HTMLElement
    expect(el).toHaveAttribute('aria-hidden', 'true')
    expect(el.className).toContain('h-9')
  })
})
