import * as React from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { ShortcutOverlay } from './shortcut-overlay.js'
import { Button } from '../primitives/button.js'

const SHORTCUTS = [
  { keys: ['Ctrl', 'K'], description: 'Qidirish va amallarni ochish' },
  { keys: ['/'], description: 'Qidiruvga fokus qilish' },
  { keys: ['?'], description: 'Ushbu roʻyxatni ochish' },
  { keys: ['g', 'h'], description: 'Bosh sahifaga oʻtish' },
  { keys: ['Esc'], description: 'Yopish' },
]

const meta: Meta<typeof ShortcutOverlay> = { title: 'Shell/ShortcutOverlay' }
export default meta
type Story = StoryObj<typeof ShortcutOverlay>

export const Default: Story = {
  render: () => {
    const [open, setOpen] = React.useState(true)
    return (
      <>
        <Button onClick={() => setOpen(true)}>Klaviatura yorliqlarini ochish</Button>
        <ShortcutOverlay
          title="Klaviatura yorliqlari"
          open={open}
          onOpenChange={setOpen}
          shortcuts={SHORTCUTS}
        />
      </>
    )
  },
}
