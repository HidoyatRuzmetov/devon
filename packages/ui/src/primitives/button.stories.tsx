import type { Meta, StoryObj } from '@storybook/react-vite'
import { Button } from './button.js'

const meta: Meta<typeof Button> = {
  title: 'Primitives/Button',
  component: Button,
  args: { children: 'Saqlash' },
}
export default meta
type Story = StoryObj<typeof Button>

export const Variants: Story = {
  render: (args) => (
    <div className="flex flex-wrap items-center gap-3">
      <Button {...args} variant="primary">
        Saqlash
      </Button>
      <Button {...args} variant="secondary">
        Bekor qilish
      </Button>
      <Button {...args} variant="ghost">
        Yopish
      </Button>
      <Button {...args} variant="destructive">
        Oʻchirish
      </Button>
    </div>
  ),
}

export const Sizes: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button size="sm">Kichik</Button>
      <Button size="md">Oʻrtacha</Button>
      <Button size="lg">Katta</Button>
    </div>
  ),
}

export const Loading: Story = {
  args: { loading: true, children: 'Yuborilmoqda' },
}

export const Disabled: Story = {
  args: { disabled: true, children: 'Mavjud emas' },
}
