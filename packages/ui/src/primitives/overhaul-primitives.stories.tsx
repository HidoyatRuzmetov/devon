import * as React from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { Button } from './button.js'
import { Checkbox } from './checkbox.js'
import { Switch } from './switch.js'
import { RadioGroup, RadioOption } from './radio-group.js'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './tabs.js'
import { Combobox } from './combobox.js'
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
import { Badge } from './badge.js'
import { ProgressRing } from '../motion/progress-ring.js'

const meta = {
  title: 'Foundations/Primitives (overhaul)',
  parameters: { layout: 'fullscreen' },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

function Row({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-b border-border py-6">
      <h3 className="text-eyebrow uppercase tracking-(--text-eyebrow--letter-spacing) text-muted-foreground">
        {title}
      </h3>
      <div className="flex flex-wrap items-center gap-4">{children}</div>
    </section>
  )
}

const PEOPLE = [
  { id: 'a', name: 'Aziza Karimova', initials: 'AK' },
  { id: 'b', name: 'Bekzod Yoʻldoshev', initials: 'BY' },
  { id: 'c', name: 'Dilnoza Rahimova', initials: 'DR' },
  { id: 'd', name: 'Eldor Tursunov', initials: 'ET' },
  { id: 'e', name: 'Feruza Norova', initials: 'FN' },
  { id: 'f', name: 'Gulnora Saidova', initials: 'GS' },
  { id: 'g', name: 'Hasan Umarov', initials: 'HU' },
]

function Gallery() {
  const [checked, setChecked] = React.useState(false)
  const [on, setOn] = React.useState(true)
  const [freq, setFreq] = React.useState('day')
  const [person, setPerson] = React.useState<string | null>(null)
  const [date, setDate] = React.useState<Date | undefined>(undefined)
  const [saving, setSaving] = React.useState(false)
  const [saved, setSaved] = React.useState(false)

  return (
    <div className="mx-auto flex max-w-220 flex-col p-8 font-sans">
      <PageHeader
        eyebrow="DIZAYN TIZIMI"
        title="Primitivlar"
        description="Har bir ekran shu qismlardan yigʻiladi."
        above={
          <Breadcrumb
            label="Yoʻl"
            items={[{ label: 'Foundations', href: '#' }, { label: 'Primitivlar' }]}
          />
        }
        actions={
          <>
            <SparkleButton aria-label="AI yordami" />
            <Button
              size="sm"
              loading={saving}
              success={saved}
              onClick={() => {
                setSaving(true)
                window.setTimeout(() => {
                  setSaving(false)
                  setSaved(true)
                  window.setTimeout(() => setSaved(false), 1200)
                }, 900)
              }}
            >
              Saqlash
            </Button>
          </>
        }
        tabs={
          <TabsList>
            <TabsTrigger value="all" count={24}>
              Hammasi
            </TabsTrigger>
            <TabsTrigger value="mine" count={6}>
              Meniki
            </TabsTrigger>
          </TabsList>
        }
      />

      <Row title="Checkbox · Switch · RadioGroup">
        <span className="flex items-center gap-2 text-body text-foreground">
          <Checkbox
            id="story-done"
            celebrate
            checked={checked}
            onCheckedChange={(v) => setChecked(v === true)}
          />
          <label htmlFor="story-done">Bajarildi</label>
        </span>
        <span className="flex items-center gap-2 text-body text-foreground">
          <Switch id="story-telegram" checked={on} onCheckedChange={setOn} />
          <label htmlFor="story-telegram">Telegram</label>
        </span>
        <RadioGroup value={freq} onValueChange={setFreq}>
          <RadioOption value="day" label="Har kuni" />
          <RadioOption value="week" label="Har hafta" description="Dushanba kunlari" />
        </RadioGroup>
      </Row>

      <Row title="Combobox · DatePicker">
        <div className="w-70">
          <Combobox
            options={PEOPLE.map((p) => ({ value: p.id, label: p.name }))}
            value={person}
            onValueChange={setPerson}
            placeholder="Xodimni tanlang"
            searchPlaceholder="Qidirish"
            emptyMessage="Topilmadi"
            label="Xodim"
          />
        </div>
        <div className="w-50">
          <DatePicker
            locale="uz-Latn"
            label="Muddat"
            placeholder="Sanani tanlang"
            selected={date}
            onSelect={setDate}
          />
        </div>
      </Row>

      <Row title="Chip · FilterChip · Badge">
        <Chip tone="primary" dotClassName="bg-unit-3">
          Tahlil boʻlimi
        </Chip>
        <Chip onRemove={() => {}} removeLabel="Olib tashlash">
          Muhim
        </Chip>
        <FilterChip active count={4}>
          Muddati oʻtgan
        </FilterChip>
        <FilterChip addVariant>Filtr</FilterChip>
        <Badge tone="success">Bajarildi</Badge>
      </Row>

      <Row title="Progress · ProgressRing · AvatarStack">
        <div className="w-60">
          <Progress value={62} label="Loyiha" />
        </div>
        <ProgressRing value={62} label="62%" size={48}>
          62%
        </ProgressRing>
        <AvatarStack people={PEOPLE} label="7 ishtirokchi" />
      </Row>

      <Row title="KpiTile">
        <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-3">
          <KpiTile
            label="Oʻz vaqtida"
            value={87}
            suffix="%"
            delta={4}
            deltaLabel="+4% oʻtgan haftaga nisbatan"
            question="Muddatlarga qanchalik amal qilinmoqda?"
          />
          <KpiTile
            label="Muddati oʻtgan"
            value={4}
            delta={-20}
            deltaGoodWhen="down"
            deltaLabel="20% kamaydi"
          />
          <KpiTile label="Fokus daqiqalari" value={null} />
        </div>
      </Row>

      <Row title="Card · SectionCard · DataList">
        <div className="grid w-full grid-cols-1 gap-4 lg:grid-cols-2">
          <Card interactive>
            <h4 className="text-lead text-foreground">Interaktiv kartochka</h4>
            <p className="text-small text-muted-foreground">Ustiga olib borilganda koʻtariladi.</p>
          </Card>
          <SectionCard
            title="Bildirishnomalar"
            description="Qaysi kanallardan xabar olasiz"
            actions={<Button size="sm">Saqlash</Button>}
          >
            <p className="text-body text-muted-foreground">Boʻlim tarkibi.</p>
          </SectionCard>
        </div>
        <DataList label="Xabarlar" className="w-full">
          {PEOPLE.slice(0, 4).map((p, i) => (
            <DataRow
              key={p.id}
              interactive
              {...(i === 0 ? { railClassName: 'bg-attention' } : {})}
              leading={<Checkbox aria-label={p.name} />}
              trailing={
                <Badge tone={i === 0 ? 'warning' : 'neutral'}>
                  {i === 0 ? 'Muddati' : 'Ochiq'}
                </Badge>
              }
            >
              <span className="min-w-0 truncate">{p.name} — hisobotni tayyorlash</span>
            </DataRow>
          ))}
        </DataList>
      </Row>

      <Row title="Tabs">
        <Tabs defaultValue="board" className="w-full">
          <TabsList>
            <TabsTrigger value="board">Doska</TabsTrigger>
            <TabsTrigger value="table">Jadval</TabsTrigger>
            <TabsTrigger value="calendar">Kalendar</TabsTrigger>
          </TabsList>
          <TabsContent value="board" className="py-4 text-body text-muted-foreground">
            Doska koʻrinishi
          </TabsContent>
          <TabsContent value="table" className="py-4 text-body text-muted-foreground">
            Jadval koʻrinishi
          </TabsContent>
          <TabsContent value="calendar" className="py-4 text-body text-muted-foreground">
            Kalendar koʻrinishi
          </TabsContent>
        </Tabs>
      </Row>

      <Row title="AiPreviewPanel">
        <div className="grid w-full grid-cols-1 gap-4 lg:grid-cols-2">
          <AiPreviewPanel
            title="Vazifa tavsifi taklifi"
            status="pending"
            pendingLabel="Tayyorlanmoqda"
            acceptLabel="Qabul qilish"
            editLabel="Tahrirlash"
            discardLabel="Bekor qilish"
            onAccept={() => {}}
            onEdit={() => {}}
            onDiscard={() => {}}
          />
          <AiPreviewPanel
            title="Vazifa tavsifi taklifi"
            status="ready"
            costLine="1 240 token · 820 ms"
            pendingLabel="Tayyorlanmoqda"
            acceptLabel="Qabul qilish"
            editLabel="Tahrirlash"
            discardLabel="Bekor qilish"
            onAccept={() => {}}
            onEdit={() => {}}
            onDiscard={() => {}}
          >
            <p>Hisobotni chorak yakunlari boʻyicha tayyorlash va boʻlim boshligʻiga yuborish.</p>
          </AiPreviewPanel>
        </div>
      </Row>
    </div>
  )
}

export const Overview: Story = { render: () => <Gallery /> }
