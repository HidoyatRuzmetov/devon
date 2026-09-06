import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ShortcutOverlay } from './shortcut-overlay.js'

const SHORTCUTS = [
  { keys: ['Ctrl', 'K'], description: 'Qidirish va amallarni ochish' },
  { keys: ['/'], description: 'Qidiruvga fokus qilish' },
  { keys: ['?'], description: 'Ushbu roʻyxatni ochish' },
  { keys: ['g', 'h'], description: 'Bosh sahifaga oʻtish' },
  { keys: ['Esc'], description: 'Yopish' },
]

describe('ShortcutOverlay', () => {
  it('lists at most five shortcuts, each with a description and its keys (spec.md §10.1)', () => {
    render(
      <ShortcutOverlay
        title="Klaviatura yorliqlari"
        open
        onOpenChange={() => {}}
        shortcuts={SHORTCUTS}
      />,
    )
    expect(screen.getByRole('dialog', { name: 'Klaviatura yorliqlari' })).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(5)
    expect(screen.getByText('Yopish')).toBeInTheDocument()
  })

  it('renders nothing when closed', () => {
    render(
      <ShortcutOverlay
        title="Klaviatura yorliqlari"
        open={false}
        onOpenChange={() => {}}
        shortcuts={SHORTCUTS}
      />,
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
