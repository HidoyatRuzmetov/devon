import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CommandPalette } from './command-palette.js'

const GROUPS = [
  {
    heading: 'Oʻtish',
    items: [{ id: 'home', label: 'Bosh sahifaga oʻtish', onSelect: vi.fn() }],
  },
]

describe('CommandPalette', () => {
  it('renders the input, groups and footer hint when open (dialog variant)', () => {
    render(
      <CommandPalette
        open
        onOpenChange={() => {}}
        title="Qidirish va amallar"
        placeholder="Qidiring yoki amalni tanlang"
        emptyMessage="Hech narsa topilmadi"
        emptyActionLabel="Qidiruvni tozalash"
        onEmptyAction={() => {}}
        hint="↑↓ tanlash · ↵ ochish · Esc yopish"
        groups={GROUPS}
      />,
    )
    expect(screen.getByPlaceholderText('Qidiring yoki amalni tanlang')).toBeInTheDocument()
    expect(screen.getByText('Bosh sahifaga oʻtish')).toBeInTheDocument()
    expect(screen.getByText('↑↓ tanlash · ↵ ochish · Esc yopish')).toBeInTheDocument()
  })

  it('calls the item onSelect when chosen', async () => {
    const onSelect = vi.fn()
    render(
      <CommandPalette
        open
        onOpenChange={() => {}}
        title="Qidirish va amallar"
        placeholder="Qidiring"
        emptyMessage="Hech narsa topilmadi"
        emptyActionLabel="Qidiruvni tozalash"
        onEmptyAction={() => {}}
        hint="hint"
        groups={[{ heading: 'Oʻtish', items: [{ id: 'home', label: 'Bosh sahifa', onSelect }] }]}
      />,
    )
    await userEvent.click(screen.getByText('Bosh sahifa'))
    expect(onSelect).toHaveBeenCalledOnce()
  })

  it('shows the empty state with its one action when nothing matches', async () => {
    const onEmptyAction = vi.fn()
    render(
      <CommandPalette
        open
        onOpenChange={() => {}}
        title="Qidirish va amallar"
        placeholder="Qidiring"
        emptyMessage="Hech narsa topilmadi"
        emptyActionLabel="Qidiruvni tozalash"
        onEmptyAction={onEmptyAction}
        hint="hint"
        groups={GROUPS}
      />,
    )
    await userEvent.type(screen.getByPlaceholderText('Qidiring'), 'zzzznomatch')
    expect(await screen.findByText('Hech narsa topilmadi')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Qidiruvni tozalash' }))
    expect(onEmptyAction).toHaveBeenCalledOnce()
  })

  it('shows three skeleton rows instead of a spinner while loading', () => {
    // Radix's DialogPrimitive.Portal renders into `document.body`, not into RTL's `container` --
    // `baseElement` (defaults to `document.body`) is where the actual dialog content lives.
    const { baseElement } = render(
      <CommandPalette
        open
        onOpenChange={() => {}}
        title="Qidirish va amallar"
        placeholder="Qidiring"
        emptyMessage="Hech narsa topilmadi"
        emptyActionLabel="Qidiruvni tozalash"
        onEmptyAction={() => {}}
        hint="hint"
        groups={[]}
        loading
      />,
    )
    expect(baseElement.querySelectorAll('[role="presentation"]')).toHaveLength(3)
  })

  it('renders nothing when closed', () => {
    render(
      <CommandPalette
        open={false}
        onOpenChange={() => {}}
        title="Qidirish va amallar"
        placeholder="Qidiring"
        emptyMessage="Hech narsa topilmadi"
        emptyActionLabel="Qidiruvni tozalash"
        onEmptyAction={() => {}}
        hint="hint"
        groups={GROUPS}
      />,
    )
    expect(screen.queryByPlaceholderText('Qidiring')).not.toBeInTheDocument()
  })
})
