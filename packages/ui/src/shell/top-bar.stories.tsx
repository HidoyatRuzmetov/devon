import type { Meta, StoryObj } from '@storybook/react-vite'
import { Menu } from 'lucide-react'
import { TopBar } from './top-bar.js'
import { IconButton } from '../primitives/icon-button.js'
import { SearchTrigger } from './search-trigger.js'
import { DemoChip } from './demo-chip.js'
import { LocaleMenu } from './locale-menu.js'
import { Avatar } from '../primitives/avatar.js'

const meta: Meta<typeof TopBar> = { title: 'Shell/TopBar', parameters: { layout: 'fullscreen' } }
export default meta
type Story = StoryObj<typeof TopBar>

const LOCALE_OPTIONS = [
  { value: 'uz-Latn', autonym: 'Oʻzbekcha (lotin)' },
  { value: 'ru', autonym: 'Русский' },
]

export const Desktop1440: Story = {
  render: () => (
    <TopBar
      leading={
        <IconButton aria-label="Yon panelni yigʻish">
          <Menu aria-hidden="true" />
        </IconButton>
      }
      title={
        <div>
          <p className="text-eyebrow uppercase text-muted-foreground">BUGUN</p>
          <p className="text-lead">Bosh sahifa</p>
        </div>
      }
      search={<SearchTrigger label="Qidirish yoki amal" onClick={() => {}} />}
      trailing={
        <>
          <DemoChip label="Demo maʼlumotlar" popoverText="Namoyish rejimi." />
          <LocaleMenu
            triggerLabel="Interfeys tili"
            chip="OʻZ"
            options={LOCALE_OPTIONS}
            value="uz-Latn"
            onChange={() => {}}
          />
          <Avatar alt="Yusupov Aziz" initials="AY" hueSeed="dept-1" />
        </>
      }
    />
  ),
}

export const Mobile390: Story = {
  render: () => (
    <div className="w-97.5">
      <TopBar
        leading={
          <IconButton aria-label="Menyuni ochish" size="touch">
            <Menu aria-hidden="true" />
          </IconButton>
        }
        title={<p className="font-display text-h3">Devon</p>}
        search={<SearchTrigger label="Qidirish yoki amal" onClick={() => {}} compact />}
        trailing={
          <>
            <LocaleMenu
              triggerLabel="Interfeys tili"
              chip="OʻZ"
              options={LOCALE_OPTIONS}
              value="uz-Latn"
              onChange={() => {}}
            />
            <Avatar alt="Yusupov Aziz" initials="AY" hueSeed="dept-1" />
          </>
        }
      />
    </div>
  ),
}
