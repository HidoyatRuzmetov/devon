import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TopBar } from './top-bar.js'

describe('TopBar', () => {
  it('renders as a landmark header with each region in DOM (reading/tab) order', () => {
    render(
      <TopBar
        leading={<button>☰</button>}
        title={<span>Bosh sahifa</span>}
        search={<button>Qidirish</button>}
        trailing={<button>Chiqish</button>}
      />,
    )
    const header = screen.getByRole('banner')
    const buttons = header.querySelectorAll('button')
    expect(Array.from(buttons).map((b) => b.textContent)).toEqual(['☰', 'Qidirish', 'Chiqish'])
  })
})
