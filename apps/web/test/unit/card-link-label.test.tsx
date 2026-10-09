import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CardLinkLabel } from '../../src/features/work/components/card-link-label.js'

describe('legacy card link rendering', () => {
  it.each([
    'javascript:alert(1)',
    'ftp://example.org/x',
    'https://viewer:ExamplePass@example.org/x',
    '/relative',
  ])('keeps %s readable without an active href', (url) => {
    render(<CardLinkLabel url={url} title="Legacy report" />)
    expect(screen.getByText('Legacy report')).toBeVisible()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
  it('opens a plain web link with its expected accessible title and noreferrer', () => {
    render(<CardLinkLabel url="https://example.org/report" title="Report" />)
    const link = screen.getByRole('link', { name: 'Report' })
    expect(link).toHaveAttribute('href', 'https://example.org/report')
    expect(link).toHaveAttribute('rel', 'noreferrer')
  })
})
