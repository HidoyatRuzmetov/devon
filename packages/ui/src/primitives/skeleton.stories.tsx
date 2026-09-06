import type { Meta, StoryObj } from '@storybook/react-vite'
import { Skeleton } from './skeleton.js'

const meta: Meta<typeof Skeleton> = { title: 'Primitives/Skeleton', component: Skeleton }
export default meta
type Story = StoryObj<typeof Skeleton>

/** Matches the Home loading skeleton from spec.md §6.1: greeting bar, date bar, panel block. */
export const HomeLayout: Story = {
  render: () => (
    <div className="flex flex-col gap-10">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-9 w-70" />
        <Skeleton className="h-4 w-45" />
      </div>
      <Skeleton className="h-55 w-140" />
    </div>
  ),
}
