import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LocaleMenu } from './locale-menu.js'

const OPTIONS = [
  { value: 'uz-Latn', autonym: 'Oʻzbekcha (lotin)' },
  { value: 'uz-Cyrl', autonym: 'Ўзбекча (кирилл)' },
  { value: 'ru', autonym: 'Русский' },
  { value: 'en', autonym: 'English' },
]

describe('LocaleMenu', () => {
  it('selects a locale in exactly two clicks (AC-4)', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(
      <LocaleMenu
        triggerLabel="Interfeys tili"
        chip="OʻZ"
        options={OPTIONS}
        value="uz-Latn"
        onChange={onChange}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Interfeys tili' })) // click 1
    const ru = await screen.findByRole('menuitemradio', { name: 'Русский' })
    await user.click(ru) // click 2
    expect(onChange).toHaveBeenCalledWith('ru')
  })

  it('marks the current locale as checked and renders every autonym in its own script', async () => {
    const user = userEvent.setup()
    render(
      <LocaleMenu
        triggerLabel="Interfeys tili"
        chip="RU"
        options={OPTIONS}
        value="ru"
        onChange={() => {}}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Interfeys tili' }))
    expect(await screen.findByRole('menuitemradio', { name: 'Русский' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(screen.getByRole('menuitemradio', { name: 'English' })).toHaveAttribute(
      'aria-checked',
      'false',
    )
  })
})
