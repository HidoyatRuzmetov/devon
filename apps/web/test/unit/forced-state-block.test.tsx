import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { StateKind } from '@devon/ui'
import { ForcedStateBlock } from '../../src/shell/forced-state-block.js'

const KINDS: readonly StateKind[] = ['empty', 'loading', 'error', 'forbidden', 'offline']

// AC-7's disproof, mechanised: "a state with zero or more than one primary action" fails the
// criterion. Every one of the five forceable kinds must render exactly one.
describe('ForcedStateBlock (design.md §8, AC-7)', () => {
  it.each(KINDS)('renders exactly one primary action for kind=%s', (kind) => {
    const { container } = render(<ForcedStateBlock kind={kind} />)
    expect(container.querySelectorAll('[data-primary]')).toHaveLength(1)
    // Every kind's action button is a real <button> (role="button" implicitly); "error" and
    // "loading" additionally carry their own live-region role (design.md §8.2/§8.3).
    expect(screen.getByRole('button')).toBeTruthy()
    if (kind === 'error') expect(screen.getByRole('alert')).toBeTruthy()
    if (kind === 'loading') expect(screen.getByRole('status')).toBeTruthy()
  })

  it('never renders a blank screen for any forceable kind', () => {
    for (const kind of KINDS) {
      const { container, unmount } = render(<ForcedStateBlock kind={kind} />)
      expect(container.textContent?.trim().length).toBeGreaterThan(0)
      unmount()
    }
  })
})
