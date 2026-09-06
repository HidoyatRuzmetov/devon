import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { Separator } from './separator.js'

describe('Separator', () => {
  it('renders as a decorative (non-semantic) divider by default', () => {
    const { container } = render(<Separator />)
    expect(container.querySelector('[data-orientation="horizontal"]')).toBeInTheDocument()
  })

  it('renders vertically when asked', () => {
    const { container } = render(<Separator orientation="vertical" />)
    expect(container.querySelector('[data-orientation="vertical"]')).toBeInTheDocument()
  })
})
