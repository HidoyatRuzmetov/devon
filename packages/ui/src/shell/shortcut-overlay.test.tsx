import { describe, expect, it, vi } from 'vitest'
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
  it('keeps alternate key combinations with the same translated description distinct', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const shortcuts = [
      { keys: ['Ctrl', 'K'], description: 'Search or action', group: 'General' },
      { keys: ['/'], description: 'Search or action', group: 'General' },
    ]
    try {
      const view = render(
        <ShortcutOverlay title="Shortcuts" open onOpenChange={() => {}} shortcuts={shortcuts} />,
      )
      expect(screen.getAllByRole('listitem').map((row) => row.textContent)).toEqual([
        'Search or actionCtrlK',
        'Search or action/',
      ])
      view.rerender(
        <ShortcutOverlay
          title="Shortcuts"
          open
          onOpenChange={() => {}}
          shortcuts={[...shortcuts].reverse()}
        />,
      )
      expect(screen.getAllByRole('listitem').map((row) => row.textContent)).toEqual([
        'Search or action/',
        'Search or actionCtrlK',
      ])
      expect(errors.mock.calls.filter((call) => /same key/.test(String(call[0])))).toEqual([])
    } finally {
      errors.mockRestore()
    }
  })
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
