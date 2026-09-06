import * as React from 'react'
import { Keyboard, LogOut } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../primitives/dropdown-menu.js'

export interface ThemeOption {
  value: string
  label: string
}

export interface AvatarMenuProps {
  /** The rendered trigger -- normally an `<Avatar>`. Kept as a slot (not a fixed `Avatar` prop set)
   * so a caller can pass whatever it has already composed. */
  avatarLabel: string
  avatar: React.ReactNode
  themeLabel: string
  themeOptions: readonly ThemeOption[]
  themeValue: string
  onThemeChange: (value: string) => void
  shortcutsLabel: string
  onOpenShortcuts: () => void
  signOutLabel: string
  onSignOut: () => void
}

/** spec.md §4.5: theme group (radio), shortcuts, separator, sign out. No profile link -- the
 * profile page does not exist yet (spec.md §1.1). No confirmation dialog on sign-out (spec.md
 * §1.1: "No confirm dialog anywhere in this epic, including sign-out"). */
export function AvatarMenu({
  avatarLabel,
  avatar,
  themeLabel,
  themeOptions,
  themeValue,
  onThemeChange,
  shortcutsLabel,
  onOpenShortcuts,
  signOutLabel,
  onSignOut,
}: AvatarMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={avatarLabel}
        className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        {avatar}
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuLabel>
          <span data-shell-label>{themeLabel}</span>
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup value={themeValue} onValueChange={onThemeChange}>
          {themeOptions.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value}>
              <span data-shell-label>{option.label}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onOpenShortcuts}>
          <Keyboard className="size-4" aria-hidden="true" />
          <span data-shell-label>{shortcutsLabel}</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onSignOut}>
          <LogOut className="size-4" aria-hidden="true" />
          <span data-shell-label>{signOutLabel}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
