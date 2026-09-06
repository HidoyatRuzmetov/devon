import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Badge } from './badge.js'

describe('Badge', () => {
  it.each(['neutral', 'attention', 'success', 'warning', 'destructive', 'info'] as const)(
    'renders the %s tone',
    (tone) => {
      render(<Badge tone={tone}>Ishlamoqda</Badge>)
      expect(screen.getByText('Ishlamoqda')).toBeInTheDocument()
    },
  )
})
