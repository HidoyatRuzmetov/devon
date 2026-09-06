import type { Meta, StoryObj } from '@storybook/react-vite'
import { Kbd, ModKbd } from './kbd.js'

const meta: Meta<typeof Kbd> = { title: 'Primitives/Kbd', component: Kbd }
export default meta
type Story = StoryObj<typeof Kbd>

export const Single: Story = { args: { children: 'Esc' } }
export const Combo: Story = { args: { keys: ['↑', '↓'] } }
export const PlatformModifier: Story = { render: () => <ModKbd letter="K" /> }
