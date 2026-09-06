import type { Meta, StoryObj } from '@storybook/react-vite'
import { Menu, Search, Globe } from 'lucide-react'
import { IconButton } from './icon-button.js'

const meta: Meta<typeof IconButton> = {
  title: 'Primitives/IconButton',
  component: IconButton,
}
export default meta
type Story = StoryObj<typeof IconButton>

export const Sizes: Story = {
  render: () => (
    <div className="flex items-center gap-3">
      <IconButton aria-label="Menyuni ochish" size="md">
        <Menu aria-hidden="true" />
      </IconButton>
      <IconButton aria-label="Qidirish" size="touch">
        <Search aria-hidden="true" />
      </IconButton>
      <IconButton aria-label="Interfeys tili" size="touch" disabled>
        <Globe aria-hidden="true" />
      </IconButton>
    </div>
  ),
}
