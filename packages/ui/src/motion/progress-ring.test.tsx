import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ProgressRing } from './progress-ring.js'

describe('ProgressRing reading', () => {
  it('shows zero percent instead of an unexplained empty ring', () => {
    render(
      <ProgressRing value={0} label="Project progress">
        {0}
      </ProgressRing>,
    )
    expect(screen.getByRole('progressbar', { name: 'Project progress' })).toHaveAttribute(
      'aria-valuenow',
      '0',
    )
    expect(screen.getByText('0', { exact: true })).toBeVisible()
  })

  it('still permits an intentionally unlabeled center', () => {
    const { container } = render(<ProgressRing value={50} label="Upload progress" />)
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50')
    expect(container.querySelector('span')).not.toBeInTheDocument()
  })
})
