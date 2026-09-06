import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { OfflineBanner } from './offline-banner.js'

describe('OfflineBanner', () => {
  it('carries its own retry action when the route has cached content (design.md §8.6)', async () => {
    const onRetry = vi.fn()
    const { container } = render(<OfflineBanner hasCachedContent onRetry={onRetry} />)
    expect(container.querySelectorAll('[data-primary]')).toHaveLength(1)
    await userEvent.click(screen.getByRole('button'))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('renders status text only, with no button, when there is nothing cached to show (the single-action rule)', () => {
    const { container } = render(<OfflineBanner hasCachedContent={false} onRetry={() => {}} />)
    expect(container.querySelectorAll('[data-primary]')).toHaveLength(0)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toBeInTheDocument()
  })
})
