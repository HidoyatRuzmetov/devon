import type { Meta, StoryObj } from '@storybook/react-vite'
import { DemoChip } from './demo-chip.js'

const meta: Meta<typeof DemoChip> = {
  title: 'Shell/DemoChip',
  component: DemoChip,
  args: {
    label: 'Demo maʼlumotlar',
    popoverText: 'Namoyish rejimi. Bu tizimdagi barcha maʼlumotlar sinov uchun yaratilgan.',
  },
}
export default meta
type Story = StoryObj<typeof DemoChip>

export const Default: Story = {}
export const ShortLabelAt390: Story = { args: { label: 'Demo' } }
