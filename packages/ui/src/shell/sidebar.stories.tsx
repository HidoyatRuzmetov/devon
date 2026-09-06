import type { Meta, StoryObj } from '@storybook/react-vite'
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

const meta: Meta<typeof Sidebar> = {
  title: 'Shell/Sidebar',
  component: Sidebar,
  args: {
    entries: ENTRIES,
    activeRoute: '/',
    wordmark: 'Devon',
    creditText: 'Raqamli texnologiyalar vazirligi tizimi',
  },
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <div className="h-125">
        <Story />
      </div>
    ),
  ],
}
export default meta
type Story = StoryObj<typeof Sidebar>

export const Member: Story = { args: { ctx: { role: 'member' } } }
export const SuperAdmin: Story = { args: { ctx: { role: 'super_admin' } } }
export const Collapsed: Story = { args: { ctx: { role: 'super_admin' }, collapsed: true } }
