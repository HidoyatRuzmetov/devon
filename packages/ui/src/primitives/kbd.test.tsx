import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Kbd, ModKbd } from './kbd.js'

describe('Kbd', () => {
  it('renders literal children', () => {
    render(<Kbd>Esc</Kbd>)
    expect(screen.getByText('Esc')).toBeInTheDocument()
  })

  it('joins a keys array with a space', () => {
    render(<Kbd keys={['Ctrl', 'K']} />)
    expect(screen.getByText('Ctrl K')).toBeInTheDocument()
  })
})

describe('ModKbd', () => {
  it('renders a platform modifier plus the given letter', () => {
    render(<ModKbd letter="K" />)
    expect(screen.getByText(/K$/)).toBeInTheDocument()
  })
})
