import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CalendarDays, Home, Inbox, KanbanSquare, Users } from 'lucide-react'
import { Sidebar } from './sidebar.js'
import { BottomTabBar } from './bottom-tab-bar.js'
import { DepartmentSwitcher } from './department-switcher.js'
import { SidebarUserBlock } from './sidebar-user-block.js'
import { ThemeToggle } from './theme-toggle.js'
import { InboxBell } from './inbox-bell.js'
import { QuickAdd } from './quick-add.js'
import { PageContainer, RouteSkeleton } from './page-container.js'
import { ShortcutOverlay } from './shortcut-overlay.js'
import type { NavEntry } from './nav-registry.js'

const ENTRIES: NavEntry[] = [
  { id: 'home', labelKey: 'nav.home', icon: Home, route: '/' },
  { id: 'inbox', labelKey: 'nav.inbox', icon: Inbox, route: '/inbox' },
  { id: 'work', labelKey: 'nav.work', icon: KanbanSquare, route: '/work' },
  { id: 'people', labelKey: 'nav.people', icon: Users, route: '/people' },
  { id: 'events', labelKey: 'nav.events', icon: CalendarDays, route: '/events' },
]

describe('Sidebar grouping and counts (UI-OVERHAUL.md §2 row 1)', () => {
  it('renders group headings and keeps every entry a group did not claim', () => {
    render(
      <Sidebar
        entries={ENTRIES}
        ctx={{ role: 'member' }}
        activeRoute="/"
        wordmark="Devon"
        creditText="Raqamli texnologiyalar vazirligi tizimi"
        groups={[
          { id: 'top', entryIds: ['home', 'inbox'] },
          { id: 'work', labelKey: 'nav.group.work', entryIds: ['work'] },
        ]}
      />,
    )
    // A key with no message renders as its own key in angle brackets (`translate()`), which is
    // exactly what a heading group needs to prove: the group rendered, with its own label slot.
    expect(screen.getByText(/nav\.group\.work/)).toBeInTheDocument()
    // `people` and `events` belong to no group here and must still be reachable.
    expect(screen.getByRole('link', { name: /nav.people/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /nav.events/ })).toBeInTheDocument()
  })

  it('shows a count next to the entry it belongs to, and nothing at zero', () => {
    render(
      <Sidebar
        entries={ENTRIES}
        ctx={{ role: 'member' }}
        activeRoute="/"
        wordmark="Devon"
        creditText="credit"
        counts={{ inbox: 7, work: 0 }}
      />,
    )
    expect(screen.getByRole('link', { name: /nav.inbox/ })).toHaveTextContent('7')
    expect(screen.getByRole('link', { name: /nav.work/ })).not.toHaveTextContent('0')
  })

  it('caps a very large count rather than widening the row', () => {
    render(
      <Sidebar
        entries={ENTRIES}
        ctx={{ role: 'member' }}
        activeRoute="/"
        wordmark="Devon"
        creditText="credit"
        counts={{ inbox: 1240 }}
      />,
    )
    expect(screen.getByRole('link', { name: /nav.inbox/ })).toHaveTextContent('99+')
  })

  it('hides labels (but keeps them for screen readers) when collapsed to the rail', () => {
    render(
      <Sidebar
        entries={ENTRIES}
        ctx={{ role: 'member' }}
        activeRoute="/"
        wordmark="Devon"
        creditText="credit"
        collapsed
      />,
    )
    // The label is still the link's accessible name -- an icon rail must not become unlabelled.
    expect(screen.getByRole('link', { name: /nav.work/ })).toBeInTheDocument()
  })
})

describe('BottomTabBar (390px)', () => {
  it('never renders more than five tabs', () => {
    render(
      <BottomTabBar
        entries={[...ENTRIES, { id: 'x', labelKey: 'nav.x', icon: Home, route: '/x' }]}
        activeRoute="/"
        label="Asosiy boʻlimlar"
      />,
    )
    expect(screen.getByRole('navigation', { name: 'Asosiy boʻlimlar' })).toBeInTheDocument()
    expect(screen.getAllByRole('link')).toHaveLength(5)
  })

  it('marks the active tab as the current page', () => {
    render(<BottomTabBar entries={ENTRIES} activeRoute="/work" label="Asosiy boʻlimlar" />)
    expect(screen.getByRole('link', { name: /nav.work/ })).toHaveAttribute('aria-current', 'page')
  })
})

describe('DepartmentSwitcher', () => {
  it('shows the active department and switches on select', async () => {
    const onSelect = vi.fn()
    render(
      <DepartmentSwitcher
        departments={[
          { id: 'd1', name: 'Tahlil boʻlimi', roleLabel: 'Boshliq' },
          { id: 'd2', name: 'Rivojlantirish boʻlimi', roleLabel: 'Xodim' },
        ]}
        activeId="d1"
        onSelect={onSelect}
        label="Boʻlim"
        heading="Boʻlimlar"
        emptyLabel="Boʻlim yoʻq"
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Boʻlim' }))
    // The row's own avatar repeats the department name for screen readers, so match the row.
    await userEvent.click(await screen.findByRole('button', { name: /Rivojlantirish/ }))
    expect(onSelect).toHaveBeenCalledWith('d2')
  })

  it('falls back to the empty label when the user is in no department', () => {
    render(
      <DepartmentSwitcher
        departments={[]}
        activeId={null}
        onSelect={() => {}}
        label="Boʻlim"
        heading="Boʻlimlar"
        emptyLabel="Boʻlim yoʻq"
      />,
    )
    expect(screen.getByRole('button', { name: 'Boʻlim' })).toHaveTextContent('Boʻlim yoʻq')
  })
})

describe('SidebarUserBlock', () => {
  it('opens its menu and runs the chosen action', async () => {
    const onSelect = vi.fn()
    render(
      <SidebarUserBlock
        avatar={<span>AK</span>}
        name="Aziza Karimova"
        secondary="Bosh mutaxassis"
        label="Hisob"
        actions={[{ id: 'signout', label: 'Chiqish', onSelect, danger: true }]}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Hisob' }))
    await userEvent.click(await screen.findByText('Chiqish'))
    expect(onSelect).toHaveBeenCalledOnce()
  })
})

describe('ThemeToggle', () => {
  it('cycles light → dark → system on successive presses', async () => {
    const onChange = vi.fn()
    const { rerender } = render(<ThemeToggle value="light" onChange={onChange} label="Mavzu" />)
    await userEvent.click(screen.getByRole('button', { name: 'Mavzu' }))
    expect(onChange).toHaveBeenLastCalledWith('dark')

    rerender(<ThemeToggle value="dark" onChange={onChange} label="Mavzu" />)
    await userEvent.click(screen.getByRole('button', { name: 'Mavzu' }))
    expect(onChange).toHaveBeenLastCalledWith('system')

    rerender(<ThemeToggle value="system" onChange={onChange} label="Mavzu" />)
    await userEvent.click(screen.getByRole('button', { name: 'Mavzu' }))
    expect(onChange).toHaveBeenLastCalledWith('light')
  })
})

describe('InboxBell', () => {
  it('shows the count and keeps it out of the accessible name (the label carries it)', () => {
    render(<InboxBell count={3} label="3 ta oʻqilmagan xabar" onClick={() => {}} />)
    const bell = screen.getByRole('button', { name: '3 ta oʻqilmagan xabar' })
    expect(bell).toHaveTextContent('3')
  })

  it('renders no badge at zero', () => {
    render(<InboxBell count={0} label="Xabarlar" onClick={() => {}} />)
    expect(screen.getByRole('button', { name: 'Xabarlar' })).toHaveTextContent('')
  })
})

describe('QuickAdd', () => {
  it('renders nothing when a session has nothing it can create (no dead chrome)', () => {
    const { container } = render(<QuickAdd actions={[]} label="Yangi" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('runs the chosen action', async () => {
    const onSelect = vi.fn()
    render(
      <QuickAdd actions={[{ id: 'card', label: 'Yangi kartochka', onSelect }]} label="Yangi" />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Yangi' }))
    await userEvent.click(await screen.findByText('Yangi kartochka'))
    expect(onSelect).toHaveBeenCalledOnce()
  })
})

describe('PageContainer / RouteSkeleton', () => {
  it('applies the requested content width', () => {
    const { container } = render(
      <PageContainer width="narrow">
        <p>content</p>
      </PageContainer>,
    )
    expect(container.firstElementChild?.className).toContain('max-w-(--width-content-narrow)')
  })

  it('announces the route skeleton politely', () => {
    render(<RouteSkeleton label="Yuklanmoqda" />)
    expect(screen.getByRole('status')).toHaveTextContent('Yuklanmoqda')
  })
})

describe('ShortcutOverlay', () => {
  it('groups shortcuts under their headings', () => {
    render(
      <ShortcutOverlay
        title="Klaviatura yorliqlari"
        open
        onOpenChange={() => {}}
        shortcuts={[
          { keys: ['Ctrl/⌘', 'K'], description: 'Qidirish', group: 'Umumiy' },
          { keys: ['g', 'h'], description: 'Bosh sahifa', group: 'Oʻtish' },
        ]}
      />,
    )
    expect(screen.getByText('Umumiy')).toBeInTheDocument()
    expect(screen.getByText('Oʻtish')).toBeInTheDocument()
  })
})
