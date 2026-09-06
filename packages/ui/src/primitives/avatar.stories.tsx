import type { Meta, StoryObj } from '@storybook/react-vite'
import { Avatar } from './avatar.js'

const meta: Meta<typeof Avatar> = { title: 'Primitives/Avatar', component: Avatar }
export default meta
type Story = StoryObj<typeof Avatar>

export const Sizes: Story = {
  render: () => (
    <div className="flex items-center gap-3">
      <Avatar alt="Aziz Yusupov" initials="AY" hueSeed="dept-1" size="sm" />
      <Avatar alt="Aziz Yusupov" initials="AY" hueSeed="dept-2" size="md" />
      <Avatar alt="Aziz Yusupov" initials="AY" hueSeed="dept-3" size="lg" />
    </div>
  ),
}

export const UnitHues: Story = {
  render: () => (
    <div className="flex items-center gap-2">
      {Array.from({ length: 8 }, (_, i) => (
        <Avatar key={i} alt={`Boʻlim ${i + 1}`} initials={String(i + 1)} hueSeed={`unit-${i}`} />
      ))}
    </div>
  ),
}
