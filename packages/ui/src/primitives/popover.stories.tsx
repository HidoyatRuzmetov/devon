import type { Meta, StoryObj } from '@storybook/react-vite'
import { Popover, PopoverContent, PopoverTrigger } from './popover.js'
import { Badge } from './badge.js'

const meta: Meta<typeof Popover> = { title: 'Primitives/Popover' }
export default meta
type Story = StoryObj<typeof Popover>

/** The DemoChip popover (spec.md §4.4). */
export const DemoChip: Story = {
  render: () => (
    <Popover>
      <PopoverTrigger asChild>
        <Badge tone="attention" className="h-6 cursor-pointer">
          Demo maʼlumotlar
        </Badge>
      </PopoverTrigger>
      <PopoverContent className="max-w-70 text-small">
        Namoyish rejimi. Bu tizimdagi barcha maʼlumotlar sinov uchun yaratilgan.
      </PopoverContent>
    </Popover>
  ),
}
