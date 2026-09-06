import { describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { useFontsLoaded } from './use-fonts-loaded.js'

function Probe() {
  const loaded = useFontsLoaded()
  return <span data-testid="probe">{String(loaded)}</span>
}

describe('useFontsLoaded', () => {
  it('flips to true once document.fonts.ready resolves and every family checks out', async () => {
    render(<Probe />)
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('true'))
  })

  it('stays false when a required family never resolves', async () => {
    const original = document.fonts
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { ready: Promise.resolve(), check: () => false },
    })
    render(<Probe />)
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('false'))
    Object.defineProperty(document, 'fonts', { configurable: true, value: original })
  })
})
