import { describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Checkbox } from './checkbox.js'
import { Switch } from './switch.js'
import { RadioGroup, RadioOption } from './radio-group.js'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './tabs.js'
import { Combobox, comboboxScore, normalizeForSearch } from './combobox.js'
import { DatePicker } from './date-picker.js'
import { Progress } from './progress.js'
import { Chip, FilterChip } from './chip.js'
import { Breadcrumb } from './breadcrumb.js'
import { Card, SectionCard } from './card.js'
import { KpiTile } from './kpi-tile.js'
import { AvatarStack } from './avatar-stack.js'
import { DataList, DataRow } from './data-list.js'
import { PageHeader } from './page-header.js'
import { SparkleButton } from './sparkle-button.js'
import { AiPreviewPanel } from './ai-preview-panel.js'
import { Button } from './button.js'

describe('Button morphs (UI-OVERHAUL.md §3)', () => {
  it('keeps the label in the box while loading so the width never jumps', () => {
    render(<Button loading>Saqlash</Button>)
    const button = screen.getByRole('button')
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
    expect(button).toHaveTextContent('Saqlash')
  })

  it('shows the success check without losing the label', () => {
    render(<Button success>Saqlash</Button>)
    const button = screen.getByRole('button', { name: 'Saqlash' })
    expect(button).not.toBeDisabled()
    expect(button.querySelector('svg')).toBeInTheDocument()
  })
})

describe('Checkbox', () => {
  it('toggles and reports its checked state', async () => {
    const onCheckedChange = vi.fn()
    render(<Checkbox checked={false} onCheckedChange={onCheckedChange} aria-label="Bajarildi" />)
    await userEvent.click(screen.getByRole('checkbox', { name: 'Bajarildi' }))
    expect(onCheckedChange).toHaveBeenCalledWith(true)
  })

  it('does not celebrate unless asked -- a settings tick is not a completed task', () => {
    const { container, rerender } = render(
      <Checkbox checked={false} aria-label="Filtr" onCheckedChange={() => {}} />,
    )
    rerender(<Checkbox checked aria-label="Filtr" onCheckedChange={() => {}} />)
    // The Celebrate layer is the only absolutely-positioned aria-hidden span this component renders.
    expect(container.querySelectorAll('span[aria-hidden="true"]')).toHaveLength(0)
  })

  it('fires the burst when a celebrated box becomes checked', () => {
    const { container, rerender } = render(
      <Checkbox celebrate checked={false} aria-label="Vazifa" onCheckedChange={() => {}} />,
    )
    rerender(<Checkbox celebrate checked aria-label="Vazifa" onCheckedChange={() => {}} />)
    const burst = container.querySelector('span[aria-hidden="true"]')
    expect(burst?.querySelectorAll('span').length).toBe(12)
  })
})

describe('Switch', () => {
  it('is a switch role and toggles', async () => {
    const onCheckedChange = vi.fn()
    render(<Switch checked={false} onCheckedChange={onCheckedChange} aria-label="Telegram" />)
    await userEvent.click(screen.getByRole('switch', { name: 'Telegram' }))
    expect(onCheckedChange).toHaveBeenCalledWith(true)
  })
})

describe('RadioGroup', () => {
  it('renders each option with a label that is itself the click target', async () => {
    const onValueChange = vi.fn()
    render(
      <RadioGroup value="a" onValueChange={onValueChange}>
        <RadioOption value="a" label="Har kuni" />
        <RadioOption value="b" label="Har hafta" description="Dushanba kunlari" />
      </RadioGroup>,
    )
    await userEvent.click(screen.getByText('Har hafta'))
    expect(onValueChange).toHaveBeenCalledWith('b')
  })
})

describe('Tabs', () => {
  it('switches panels and exposes the count', async () => {
    render(
      <Tabs defaultValue="board">
        <TabsList>
          <TabsTrigger value="board" count={12}>
            Doska
          </TabsTrigger>
          <TabsTrigger value="table">Jadval</TabsTrigger>
        </TabsList>
        <TabsContent value="board">Doska koʻrinishi</TabsContent>
        <TabsContent value="table">Jadval koʻrinishi</TabsContent>
      </Tabs>,
    )
    expect(screen.getByText('Doska koʻrinishi')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Doska/ })).toHaveTextContent('12')
    await userEvent.click(screen.getByRole('tab', { name: 'Jadval' }))
    expect(screen.getByText('Jadval koʻrinishi')).toBeInTheDocument()
  })
})

describe('Combobox search normalisation (DESIGN.md §2.3)', () => {
  it('matches Uzbek Latin regardless of which apostrophe the user typed', () => {
    expect(normalizeForSearch('Oʻzbekiston')).toBe(normalizeForSearch("O'zbekiston"))
    expect(comboboxScore('Gʻayrat Toshmatov', "g'ayrat")).toBeGreaterThan(0)
  })

  it('matches Cyrillic case-insensitively', () => {
    expect(comboboxScore('Азиза Каримова', 'азиза')).toBeGreaterThan(0)
    expect(comboboxScore('Азиза Каримова', 'КАРИМОВА')).toBeGreaterThan(0)
  })

  it('ranks a prefix above a mid-word match and rejects a non-match', () => {
    expect(comboboxScore('Alisher', 'ali')).toBeGreaterThan(comboboxScore('Nodira Xalieva', 'ali'))
    expect(comboboxScore('Alisher', 'zzz')).toBe(0)
  })

  it('opens, filters and selects', async () => {
    const onValueChange = vi.fn()
    render(
      <Combobox
        options={[
          { value: '1', label: 'Aziza Karimova', description: 'Bosh mutaxassis' },
          { value: '2', label: 'Bekzod Yoʻldoshev' },
        ]}
        value={null}
        onValueChange={onValueChange}
        placeholder="Tanlang"
        searchPlaceholder="Qidirish"
        emptyMessage="Topilmadi"
        label="Xodim"
      />,
    )
    await userEvent.click(screen.getByRole('combobox', { name: 'Xodim' }))
    await userEvent.click(await screen.findByText('Aziza Karimova'))
    expect(onValueChange).toHaveBeenCalledWith('1')
  })

  it('shows skeletons rather than "nothing found" while an async source is loading', async () => {
    render(
      <Combobox
        options={[]}
        value={null}
        onValueChange={() => {}}
        onSearchChange={() => {}}
        loading
        placeholder="Tanlang"
        searchPlaceholder="Qidirish"
        emptyMessage="Topilmadi"
        label="Xodim"
      />,
    )
    await userEvent.click(screen.getByRole('combobox', { name: 'Xodim' }))
    expect(screen.queryByText('Topilmadi')).not.toBeInTheDocument()
  })
})

describe('DatePicker', () => {
  it('renders the placeholder until a date is chosen, then DD.MM.YYYY', () => {
    const { rerender } = render(
      <DatePicker
        locale="uz-Latn"
        label="Muddat"
        placeholder="Sanani tanlang"
        onSelect={() => {}}
      />,
    )
    expect(screen.getByRole('button', { name: 'Muddat' })).toHaveTextContent('Sanani tanlang')
    rerender(
      <DatePicker
        locale="uz-Latn"
        label="Muddat"
        placeholder="Sanani tanlang"
        selected={new Date(2026, 8, 7)}
        onSelect={() => {}}
      />,
    )
    expect(screen.getByRole('button', { name: 'Muddat' })).toHaveTextContent('07.09.2026')
  })
})

describe('Progress', () => {
  it('clamps out-of-range values instead of overflowing its track', () => {
    render(<Progress value={140} label="Toʻldirilgan" />)
    expect(screen.getByRole('progressbar', { name: 'Toʻldirilgan' })).toHaveAttribute(
      'aria-valuenow',
      '100',
    )
  })
})

describe('Chip / FilterChip', () => {
  it('removes a chip through its own remove button', async () => {
    const onRemove = vi.fn()
    render(
      <Chip onRemove={onRemove} removeLabel="Olib tashlash">
        Muhim
      </Chip>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Olib tashlash' }))
    expect(onRemove).toHaveBeenCalledOnce()
  })

  it('reports its pressed state so a filter is never colour-only', () => {
    render(<FilterChip active>Muddati oʻtgan</FilterChip>)
    expect(screen.getByRole('button', { name: /Muddati/ })).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('Breadcrumb', () => {
  it('marks the last crumb as the current page and does not link it', () => {
    render(
      <Breadcrumb
        label="Yoʻl"
        items={[{ label: 'Ishlar', href: '/work' }, { label: 'Kartochka' }]}
      />,
    )
    expect(screen.getByRole('link', { name: 'Ishlar' })).toHaveAttribute('href', '/work')
    expect(screen.getByText('Kartochka')).toHaveAttribute('aria-current', 'page')
  })
})

describe('Card / SectionCard', () => {
  it('renders a section with its title and its own action row', () => {
    render(
      <SectionCard
        title="Bildirishnomalar"
        description="Kanallarni tanlang"
        actions={<Button size="sm">Saqlash</Button>}
      >
        <p>Tarkib</p>
      </SectionCard>,
    )
    expect(screen.getByRole('heading', { name: 'Bildirishnomalar' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Saqlash' })).toBeInTheDocument()
  })

  it('lifts only when it is actually clickable', () => {
    const { container } = render(<Card>Statik</Card>)
    expect(container.querySelector('.cursor-pointer')).toBeNull()
  })
})

describe('KpiTile', () => {
  it('shows an em dash rather than a fake zero when the value is unknown', () => {
    render(<KpiTile label="Oʻz vaqtida" value={null} />)
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('reads a falling overdue count as good when down is the good direction', () => {
    render(
      <KpiTile
        label="Muddati oʻtgan"
        value={4}
        delta={-20}
        deltaGoodWhen="down"
        deltaLabel="20% kamaydi"
      />,
    )
    expect(screen.getByText('20% kamaydi').parentElement).toHaveClass('text-success')
  })
})

describe('AvatarStack', () => {
  it('collapses everyone past the max into a +N disc under one group label', () => {
    const people = Array.from({ length: 8 }, (_, i) => ({
      id: `p${i}`,
      name: `Xodim ${i}`,
      initials: 'XX',
    }))
    render(<AvatarStack people={people} max={5} label="8 ishtirokchi" />)
    expect(screen.getByRole('group', { name: '8 ishtirokchi' })).toBeInTheDocument()
    expect(screen.getByText('+3')).toBeInTheDocument()
  })
})

describe('DataList / DataRow', () => {
  it('renders rows as list items with leading and trailing slots', () => {
    render(
      <DataList label="Xabarlar">
        <DataRow interactive leading={<span>L</span>} trailing={<span>T</span>}>
          Yangi topshiriq
        </DataRow>
      </DataList>,
    )
    expect(screen.getByRole('list', { name: 'Xabarlar' })).toBeInTheDocument()
    expect(screen.getByRole('listitem')).toHaveTextContent('Yangi topshiriq')
  })
})

describe('PageHeader', () => {
  it('renders exactly one h1 plus its description and actions', () => {
    render(
      <PageHeader
        eyebrow="ISHLAR"
        title="Boʻlim doskasi"
        description="Har bir xodim uchun ustun"
        actions={<Button size="sm">Yangi</Button>}
      />,
    )
    expect(screen.getByRole('heading', { level: 1, name: 'Boʻlim doskasi' })).toBeInTheDocument()
    expect(screen.getByText('Har bir xodim uchun ustun')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Yangi' })).toBeInTheDocument()
  })
})

describe('SparkleButton', () => {
  it('is reachable by its accessible name and can be pressed', async () => {
    const onClick = vi.fn()
    render(<SparkleButton aria-label="AI yordami" onClick={onClick} />)
    await userEvent.click(screen.getByRole('button', { name: 'AI yordami' }))
    expect(onClick).toHaveBeenCalledOnce()
  })
})

describe('AiPreviewPanel (TECH-SPEC §8: always preview, never auto-apply)', () => {
  const base = {
    title: 'Taklif',
    acceptLabel: 'Qabul qilish',
    editLabel: 'Tahrirlash',
    discardLabel: 'Bekor qilish',
    pendingLabel: 'Tayyorlanmoqda',
    onAccept: () => {},
    onEdit: () => {},
    onDiscard: () => {},
  }

  it('announces the pending state politely and shows no result yet', () => {
    render(
      <AiPreviewPanel {...base} status="pending">
        natija
      </AiPreviewPanel>,
    )
    expect(screen.getByRole('status')).toHaveTextContent('Tayyorlanmoqda')
    expect(screen.queryByText('natija')).not.toBeInTheDocument()
  })

  it('offers all three of Accept, Edit and Discard once a result is ready', () => {
    render(
      <AiPreviewPanel {...base} status="ready" costLine="1 200 token">
        natija
      </AiPreviewPanel>,
    )
    expect(screen.getByText('natija')).toBeInTheDocument()
    expect(screen.getByText('1 200 token')).toBeInTheDocument()
    for (const name of ['Qabul qilish', 'Tahrirlash', 'Bekor qilish']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
    }
  })

  it('shows the error as an alert and never offers Accept for it', () => {
    render(<AiPreviewPanel {...base} status="error" errorMessage="Xatolik yuz berdi" />)
    expect(screen.getByRole('alert')).toHaveTextContent('Xatolik yuz berdi')
    expect(screen.queryByRole('button', { name: 'Qabul qilish' })).not.toBeInTheDocument()
  })
})
