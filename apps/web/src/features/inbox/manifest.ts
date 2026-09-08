// Inbox + Telegram feature manifest (MODULE-GUIDE.md "Web features"). Three exact-path routes: the
// inbox itself (sidebar entry, reached from anywhere via the shell's search/command overlay too),
// and two settings screens reached from links on the inbox screen and from the command palette.
import * as React from 'react'
import { Inbox, Send, SlidersHorizontal } from 'lucide-react'
import { queryClient } from '../../lib/query-client.js'
import type { FeatureManifest } from '../types.js'
import { prefetchNotifications, useNotificationsQuery } from './hooks.js'

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
  // H5.2 "prefetch on hover/focus": warms the inbox tab's default query before the click.
  sidebar: [
    {
      id: 'inbox',
      labelKey: 'inbox.title',
      icon: Inbox,
      route: '/inbox',
      onPrefetch: () => void prefetchNotifications(queryClient),
    },
  ],
  // The shell's sidebar count and top-bar bell both read this (MODULE-GUIDE.md "Web features":
  // `useSidebarCounts`). It reuses the inbox list query this feature already polls -- no extra
  // request exists just to draw a badge, and a session that never opens the inbox still gets the
  // count from the same cached response the inbox screen will use.
  useSidebarCounts: () => {
    const query = useNotificationsQuery('unread')
    return { inbox: query.data?.unreadCount ?? 0 }
  },
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
