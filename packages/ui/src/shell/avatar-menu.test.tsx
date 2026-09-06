import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AvatarMenu } from './avatar-menu.js'

const THEME_OPTIONS = [
  { value: 'light', label: 'Yorugʻ' },
  { value: 'dark', label: 'Qorongʻi' },
  { value: 'system', label: 'Tizim boʻyicha' },
]

describe('AvatarMenu', () => {
  it('calls onSignOut immediately -- no confirmation dialog anywhere in this epic (spec.md §1.1)', async () => {
    const onSignOut = vi.fn()
    const user = userEvent.setup()
    render(
      <AvatarMenu
        avatarLabel="Yusupov A.B."
        avatar={<span>AY</span>}
        themeLabel="Mavzu"
        themeOptions={THEME_OPTIONS}
        themeValue="light"
        onThemeChange={() => {}}
        shortcutsLabel="Klaviatura yorliqlari"
        onOpenShortcuts={() => {}}
        signOutLabel="Chiqish"
        onSignOut={onSignOut}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Yusupov A.B.' }))
    await user.click(await screen.findByText('Chiqish'))
    expect(onSignOut).toHaveBeenCalledOnce()
  })

  it('changes theme via the radio group', async () => {
    const onThemeChange = vi.fn()
    const user = userEvent.setup()
    render(
      <AvatarMenu
        avatarLabel="Yusupov A.B."
        avatar={<span>AY</span>}
        themeLabel="Mavzu"
        themeOptions={THEME_OPTIONS}
        themeValue="light"
        onThemeChange={onThemeChange}
        shortcutsLabel="Klaviatura yorliqlari"
        onOpenShortcuts={() => {}}
        signOutLabel="Chiqish"
        onSignOut={() => {}}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Yusupov A.B.' }))
    await user.click(await screen.findByText('Qorongʻi'))
    expect(onThemeChange).toHaveBeenCalledWith('dark')
  })
})
