import type { Meta, StoryObj } from '@storybook/react-vite'
import { SearchTrigger } from './search-trigger.js'

const meta: Meta<typeof SearchTrigger> = {
  title: 'Shell/SearchTrigger',
  component: SearchTrigger,
  args: { label: 'Qidirish yoki amal', onClick: () => {} },
}
export default meta
type Story = StoryObj<typeof SearchTrigger>

export const Field: Story = {}
export const Compact: Story = { args: { compact: true } }
