import type { Meta, StoryObj } from '@storybook/react-vite'
import { Menu } from 'lucide-react'
import { Sheet, SheetContent, SheetTrigger } from './sheet.js'
import { IconButton } from './icon-button.js'

const meta: Meta<typeof Sheet> = { title: 'Primitives/Sheet' }
export default meta
type Story = StoryObj<typeof Sheet>

/** The 390px sidebar drawer (spec.md §3.4). */
export const LeftDrawer: Story = {
  render: () => (
    <Sheet direction="left">
      <SheetTrigger asChild>
        <IconButton aria-label="Menyuni ochish">
          <Menu aria-hidden="true" />
        </IconButton>
      </SheetTrigger>
      <SheetContent title="Yon panel" side="left" className="p-4">
        <nav className="flex flex-col gap-1">
          <button type="button" className="rounded-sm px-3 py-2 text-left hover:bg-accent">
            Bosh sahifa
          </button>
        </nav>
      </SheetContent>
    </Sheet>
  ),
}
