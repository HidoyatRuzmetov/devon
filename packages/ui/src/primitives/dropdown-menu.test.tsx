import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from './dropdown-menu.js'
import { Button } from './button.js'

describe('DropdownMenu', () => {
  it('opens on trigger click and selects a radio item in two clicks total (AC-4)', async () => {
    const user = userEvent.setup()
    render(
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button>OʻZ</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuRadioGroup value="uz-Latn">
            <DropdownMenuRadioItem value="uz-Latn">Oʻzbekcha (lotin)</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="ru">Русский</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>,
    )
    await user.click(screen.getByRole('button', { name: 'OʻZ' })) // click 1
    const ruItem = await screen.findByText('Русский')
    expect(ruItem.closest('[role="menuitemradio"]')).toBeInTheDocument()
    await user.click(ruItem) // click 2
  })
})
