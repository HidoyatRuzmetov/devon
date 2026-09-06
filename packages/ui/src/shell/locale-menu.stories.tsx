import * as React from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { LocaleMenu } from './locale-menu.js'

const OPTIONS = [
  { value: 'uz-Latn', autonym: 'Oʻzbekcha (lotin)' },
  { value: 'uz-Cyrl', autonym: 'Ўзбекча (кирилл)' },
  { value: 'ru', autonym: 'Русский' },
  { value: 'en', autonym: 'English' },
]

const meta: Meta<typeof LocaleMenu> = {
  title: 'Shell/LocaleMenu',
  component: LocaleMenu,
  args: { triggerLabel: 'Interfeys tili', chip: 'OʻZ', options: OPTIONS },
}
export default meta
type Story = StoryObj<typeof LocaleMenu>

export const Default: Story = {
  render: (args) => {
    const [value, setValue] = React.useState('uz-Latn')
    return <LocaleMenu {...args} value={value} onChange={setValue} />
  },
}
