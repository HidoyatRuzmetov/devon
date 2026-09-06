import * as React from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { Globe } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './dropdown-menu.js'
import { Button } from './button.js'

const meta: Meta<typeof DropdownMenu> = { title: 'Primitives/DropdownMenu' }
export default meta
type Story = StoryObj<typeof DropdownMenu>

/** spec.md §4.3: four autonyms, current item checked, two clicks total from any shell screen. */
export const LocaleMenu: Story = {
  render: () => {
    const [locale, setLocale] = React.useState('uz-Latn')
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary">
            <Globe className="size-4" aria-hidden="true" /> OʻZ
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuRadioGroup value={locale} onValueChange={setLocale}>
            <DropdownMenuRadioItem value="uz-Latn">Oʻzbekcha (lotin)</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="uz-Cyrl">Ўзбекча (кирилл)</DropdownMenuRadioItem>
            <DropdownMenuSeparator />
            <DropdownMenuRadioItem value="ru">Русский</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="en">English</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    )
  },
}
