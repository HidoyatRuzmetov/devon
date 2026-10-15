import { describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AvatarStack } from './avatar-stack.js'

const people = [
  { id: 'aziz', name: 'Aziz Yusupov', initials: 'AY' },
  { id: 'dilnoza', name: 'Dilnoza Karimova', initials: 'DK' },
  { id: 'bekzod', name: 'Bekzod Tursunov', initials: 'BT' },
]

describe('AvatarStack', () => {
  it('shows the hovered person, including when moving from the first face to another', async () => {
    const user = userEvent.setup()
    render(<AvatarStack people={people} label="Project colleagues" />)
    await user.hover(screen.getByRole('button', { name: people[0]!.name }))
    expect(await screen.findByRole('tooltip')).toHaveTextContent(people[0]!.name)
    await user.unhover(screen.getByRole('button', { name: people[0]!.name }))
    await user.hover(screen.getByRole('button', { name: people[1]!.name }))
    await waitFor(() => expect(screen.getByRole('tooltip')).toHaveTextContent(people[1]!.name))
  })

  it('allows each face to receive keyboard focus and names all collapsed colleagues', async () => {
    const user = userEvent.setup()
    render(<AvatarStack people={people} max={2} label="Project colleagues" />)
    await user.tab()
    expect(screen.getByRole('button', { name: people[0]!.name })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('button', { name: people[1]!.name })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('button', { name: people[2]!.name })).toHaveFocus()
    expect(await screen.findByRole('tooltip')).toHaveTextContent(people[2]!.name)
    expect(screen.getByText('+1')).toBeInTheDocument()
  })

  it('can reveal a name hint by clicking and dismiss it with Escape', async () => {
    const user = userEvent.setup()
    render(<AvatarStack people={people} label="Project colleagues" />)
    const button = screen.getByRole('button', { name: people[1]!.name })
    await user.click(button)
    expect(await screen.findByRole('tooltip')).toHaveTextContent(people[1]!.name)
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument())
  })
})
