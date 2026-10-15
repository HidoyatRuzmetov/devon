import { describe, expect, it } from 'vitest'
import { fireEvent, render } from '@testing-library/react'
import { OrgChartAvatar } from '../../src/features/structure/org-chart-avatar.js'

const person = {
  givenName: 'Dilnoza',
  familyName: 'Karimova',
  avatarKey: 'avatars/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222',
}

describe('SVG org chart avatars', () => {
  it('uses the photo, falls back after failure, and accepts a newly uploaded photo', () => {
    const { container, rerender } = render(
      <svg>
        <OrgChartAvatar person={person} cy={70} fill="red" textStyle={{}} />
      </svg>,
    )
    const image = container.querySelector('image')!
    expect(image.getAttribute('href')).toBe(
      '/api/v1/accounts/avatar/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/64',
    )
    expect(image.getAttribute('clip-path')).toMatch(/^url\(#org-avatar-/)
    fireEvent.error(image)
    expect(container.querySelector('image')).toBeNull()
    expect(container.querySelector('text')).toHaveTextContent('DK')
    rerender(
      <svg>
        <OrgChartAvatar
          person={{ ...person, avatarKey: person.avatarKey.replaceAll('22222222', '33333333') }}
          cy={70}
          fill="red"
          textStyle={{}}
        />
      </svg>,
    )
    expect(container.querySelector('image')?.getAttribute('href')).toContain('33333333')
  })
})
