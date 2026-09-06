import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Avatar, initialsFromName, unitHueClass } from './avatar.js'

describe('initialsFromName', () => {
  it('takes the first letter of given and family name, per the A.Y. rule', () => {
    expect(initialsFromName('Aziz', 'Yusupov')).toBe('AY')
  })
})

describe('unitHueClass', () => {
  it('is stable for the same seed', () => {
    expect(unitHueClass('dept-42')).toBe(unitHueClass('dept-42'))
  })

  it('picks one of the eight categorical hues', () => {
    expect(unitHueClass('dept-1')).toMatch(/^bg-unit-[1-8]$/)
  })
})

describe('Avatar', () => {
  it('renders an accessible name and the initials fallback without an image', async () => {
    render(<Avatar alt="Yusupov Aziz" initials="AY" hueSeed="dept-1" />)
    expect(screen.getByText('Yusupov Aziz')).toBeInTheDocument()
    // Radix's Avatar.Fallback always mounts after its `delayMs` via a timeout (even delayMs=0), so
    // it is never present synchronously on the first render.
    expect(await screen.findByText('AY')).toBeInTheDocument()
  })
})
