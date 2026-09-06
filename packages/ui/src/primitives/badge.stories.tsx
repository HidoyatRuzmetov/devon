import type { Meta, StoryObj } from '@storybook/react-vite'
import { CircleCheck, CircleX } from 'lucide-react'
import { Badge } from './badge.js'

const meta: Meta<typeof Badge> = { title: 'Primitives/Badge', component: Badge }
export default meta
type Story = StoryObj<typeof Badge>

export const Tones: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Badge tone="neutral">Kutilmoqda</Badge>
      <Badge tone="attention">Eʼtibor kerak</Badge>
      <Badge tone="success">
        <CircleCheck className="size-3.5" aria-hidden="true" /> Ishlamoqda
      </Badge>
      <Badge tone="warning">Muddati yaqin</Badge>
      <Badge tone="destructive">
        <CircleX className="size-3.5" aria-hidden="true" /> Ishlamayapti
      </Badge>
      <Badge tone="info">Rejalashtirilgan</Badge>
    </div>
  ),
}
