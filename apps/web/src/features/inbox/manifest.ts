// Inbox + Telegram feature manifest (MODULE-GUIDE.md "Web features"). Three exact-path routes: the
// inbox itself (sidebar entry, reached from anywhere via the shell's search/command overlay too),
// and two settings screens reached from links on the inbox screen and from the command palette.
import * as React from 'react'
import { Inbox, Send, SlidersHorizontal } from 'lucide-react'
import type { FeatureManifest } from '../types.js'

const InboxScreen = React.lazy(() => import('./inbox-screen.js'))
const PreferencesScreen = React.lazy(() => import('./preferences-screen.js'))
const TelegramScreen = React.lazy(() => import('./telegram-screen.js'))

const manifest: FeatureManifest = {
  name: 'inbox',
  routes: [
    { path: '/inbox', component: InboxScreen, titleKey: 'inbox.title' },
    {
      path: '/inbox/preferences',
      component: PreferencesScreen,
      titleKey: 'inbox.preferences.title',
    },
    { path: '/inbox/telegram', component: TelegramScreen, titleKey: 'telegram.title' },
  ],
  sidebar: [{ id: 'inbox', labelKey: 'inbox.title', icon: Inbox, route: '/inbox' }],
  commands: [
    {
      id: 'inbox.preferences',
      labelKey: 'inbox.preferences.title',
      path: '/inbox/preferences',
      icon: SlidersHorizontal,
    },
    { id: 'inbox.telegram', labelKey: 'telegram.title', path: '/inbox/telegram', icon: Send },
  ],
}

export default manifest
