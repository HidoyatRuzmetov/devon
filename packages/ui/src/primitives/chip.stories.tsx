import type { Meta, StoryObj } from '@storybook/react-vite'
import { Gavel } from 'lucide-react'
import { Chip } from './chip.js'

const meta: Meta<typeof Chip> = { title: 'Primitives/Chip', component: Chip }
export default meta
type Story = StoryObj<typeof Chip>

export const Tones: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Chip tone="neutral">Neytral</Chip>
      <Chip tone="primary">Asosiy</Chip>
      <Chip tone="attention">Eʼtibor</Chip>
      <Chip tone="success">Muvaffaqiyat</Chip>
      <Chip tone="destructive">Xato</Chip>
      <Chip tone="info">Axborot</Chip>
      <Chip tone="outline">Kontur</Chip>
    </div>
  ),
}

/** A leading icon must sit `shrink-0` beside the truncating label span, never inside it -- inside it
 * the icon and the label's first character render at the same x (round2 SEV1 finding, /inbox reason
 * chips). This story pins that regression with both a short and a long label. */
export const WithLeadingIcon: Story = {
  render: () => (
    <div className="flex max-w-40 flex-col items-start gap-2">
      <Chip tone="attention" leading={<Gavel className="size-3" aria-hidden="true" />}>
        Qaror
      </Chip>
      <Chip tone="info" leading={<Gavel className="size-3" aria-hidden="true" />}>
        Juda uzun yorliq matni bu yerda kesiladi
      </Chip>
    </div>
  ),
}

export const Removable: Story = {
  render: () => (
    <Chip tone="neutral" onRemove={() => {}} removeLabel="Olib tashlash">
      Olib tashlanadigan chip
    </Chip>
  ),
}
