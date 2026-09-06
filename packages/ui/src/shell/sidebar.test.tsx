import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Home, ShieldCheck } from 'lucide-react'
import { Sidebar } from './sidebar.js'
import type { NavEntry } from './nav-registry.js'

const ENTRIES: NavEntry[] = [
  { id: 'home', labelKey: 'nav.home', icon: Home, route: '/' },
  {
    id: 'admin',
    labelKey: 'nav.admin',
    icon: ShieldCheck,
    route: '/admin',
    visibleWhen: (ctx) => ctx.role === 'super_admin',
  },
]

describe('Sidebar', () => {
  it('hides a gated entry from a member session (no dead chrome, spec.md §7)', () => {
    render(
      <Sidebar
        entries={ENTRIES}
        ctx={{ role: 'member' }}
        activeRoute="/"
        wordmark="Devon"
        creditText="Raqamli texnologiyalar vazirligi tizimi"
      />,
    )
    expect(screen.queryByText('nav.admin')).not.toBeInTheDocument()
  })

  it('marks the active route with aria-current="page"', () => {
    render(
      <Sidebar
        entries={ENTRIES}
        ctx={{ role: 'super_admin' }}
        activeRoute="/admin"
        wordmark="Devon"
        creditText="Raqamli texnologiyalar vazirligi tizimi"
      />,
    )
    expect(screen.getByRole('link', { name: /nav.admin/ })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: /nav.home/ })).not.toHaveAttribute('aria-current')
  })

  it('renders every shell label with data-shell-label (the 390px overflow test hook)', () => {
    const { container } = render(
      <Sidebar
        entries={ENTRIES}
        ctx={{ role: 'super_admin' }}
        activeRoute="/"
        wordmark="Devon"
        creditText="Raqamli texnologiyalar vazirligi tizimi"
      />,
    )
    expect(container.querySelectorAll('[data-shell-label]').length).toBeGreaterThanOrEqual(3)
  })
})
