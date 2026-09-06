import * as React from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { Home, ShieldCheck, Globe, Palette, Keyboard, LogOut } from 'lucide-react'
import { CommandPalette } from './command-palette.js'
import { Button } from '../primitives/button.js'

const GROUPS = [
  {
    heading: 'Oʻtish',
    items: [
      { id: 'home', label: 'Bosh sahifaga oʻtish', icon: Home, onSelect: () => {} },
      { id: 'admin', label: 'Boshqaruvga oʻtish', icon: ShieldCheck, onSelect: () => {} },
    ],
  },
  {
    heading: 'Sozlamalar',
    items: [
      { id: 'locale', label: 'Interfeys tilini oʻzgartirish', icon: Globe, onSelect: () => {} },
      { id: 'theme', label: 'Mavzuni oʻzgartirish', icon: Palette, onSelect: () => {} },
      { id: 'shortcuts', label: 'Klaviatura yorliqlari', icon: Keyboard, onSelect: () => {} },
    ],
  },
  {
    heading: 'Hisob',
    items: [{ id: 'signout', label: 'Tizimdan chiqish', icon: LogOut, onSelect: () => {} }],
  },
]

const meta: Meta<typeof CommandPalette> = {
  title: 'Shell/CommandPalette',
  args: {
    title: 'Qidirish va amallar',
    placeholder: 'Qidiring yoki amalni tanlang',
    emptyMessage: 'Hech narsa topilmadi',
    emptyActionLabel: 'Qidiruvni tozalash',
    onEmptyAction: () => {},
    hint: '↑↓ tanlash · ↵ ochish · Esc yopish',
    groups: GROUPS,
  },
}
export default meta
type Story = StoryObj<typeof CommandPalette>

function Harness(props: Partial<React.ComponentProps<typeof CommandPalette>>) {
  const [open, setOpen] = React.useState(true)
  return (
    <>
      <Button onClick={() => setOpen(true)}>Qidirish yoki amal</Button>
      <CommandPalette
        title="Qidirish va amallar"
        placeholder="Qidiring yoki amalni tanlang"
        emptyMessage="Hech narsa topilmadi"
        emptyActionLabel="Qidiruvni tozalash"
        onEmptyAction={() => {}}
        hint="↑↓ tanlash · ↵ ochish · Esc yopish"
        groups={GROUPS}
        {...props}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  )
}

export const Dialog1440: Story = { render: () => <Harness variant="dialog" /> }
export const Sheet390: Story = { render: () => <Harness variant="sheet" /> }
export const Loading: Story = { render: () => <Harness variant="dialog" loading groups={[]} /> }
export const Empty: Story = { render: () => <Harness variant="dialog" groups={[]} /> }
