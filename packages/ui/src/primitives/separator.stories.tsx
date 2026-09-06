import type { Meta, StoryObj } from '@storybook/react-vite'
import { Separator } from './separator.js'

const meta: Meta<typeof Separator> = { title: 'Primitives/Separator', component: Separator }
export default meta
type Story = StoryObj<typeof Separator>

export const Horizontal: Story = {
  render: () => (
    <div className="w-64">
      <p>Yuqori</p>
      <Separator className="my-3" />
      <p>Quyi</p>
    </div>
  ),
}

export const Vertical: Story = {
  render: () => (
    <div className="flex h-8 items-center gap-3">
      <span>Chap</span>
      <Separator orientation="vertical" />
      <span>Oʻng</span>
    </div>
  ),
}
