import * as React from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { AvatarMenu } from './avatar-menu.js'
import { Avatar } from '../primitives/avatar.js'

const THEME_OPTIONS = [
  { value: 'light', label: 'Yorugʻ' },
  { value: 'dark', label: 'Qorongʻi' },
  { value: 'system', label: 'Tizim boʻyicha' },
]

const meta: Meta<typeof AvatarMenu> = {
  title: 'Shell/AvatarMenu',
  component: AvatarMenu,
  args: {
    avatarLabel: 'Yusupov A.B.',
    themeLabel: 'Mavzu',
    themeOptions: THEME_OPTIONS,
    shortcutsLabel: 'Klaviatura yorliqlari',
    onOpenShortcuts: () => {},
    signOutLabel: 'Chiqish',
    onSignOut: () => {},
  },
}
export default meta
type Story = StoryObj<typeof AvatarMenu>

export const Default: Story = {
  render: (args) => {
    const [theme, setTheme] = React.useState('light')
    return (
      <AvatarMenu
        {...args}
        avatar={<Avatar alt="Yusupov Aziz" initials="AY" hueSeed="dept-1" />}
        themeValue={theme}
        onThemeChange={setTheme}
      />
    )
  },
}
