import type { Meta, StoryObj } from '@storybook/react-vite'
import { Input } from './input.js'

const meta: Meta<typeof Input> = {
  title: 'Primitives/Input',
  component: Input,
  args: { placeholder: 'Login yoki e-pochta' },
}
export default meta
type Story = StoryObj<typeof Input>

export const Default: Story = { args: {} }
export const Invalid: Story = { args: { invalid: true, defaultValue: 'notoʻgʻri' } }
export const Disabled: Story = { args: { disabled: true, defaultValue: 'aziz.b' } }
