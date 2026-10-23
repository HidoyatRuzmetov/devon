// Inbox and its delivery settings. Settings live under /account; the old inbox paths redirect
// existing bookmarks and notification links to the canonical profile-settings pages.
import * as React from 'react'
import { Send, SlidersHorizontal } from 'lucide-react'
import type { FeatureManifest } from '../types.js'
import { useNotificationsQuery } from './hooks.js'

const LegacyInboxScreen = React.lazy(() => import('./legacy-inbox-screen.js'))
const LegacySettingsScreen = React.lazy(() => import('./legacy-settings-screen.js'))

const manifest: FeatureManifest = {
  name: 'inbox',
  routes: [
    { path: '/inbox', component: LegacyInboxScreen, titleKey: 'inbox.title' },
    {
      path: '/inbox/preferences',
      component: LegacySettingsScreen,
      titleKey: 'inbox.preferences.title',
    },
    { path: '/inbox/telegram', component: LegacySettingsScreen, titleKey: 'telegram.title' },
  ],
  // Keep the personal unread bell available on every route. The Home feed has its own cursor
  // cache; both queries share the notifications invalidation prefix and a polling fallback.
  useSidebarCounts: () => {
    const query = useNotificationsQuery('unread')
    return { inbox: query.data?.unreadCount ?? 0 }
  },
  commands: [
    {
      id: 'inbox.preferences',
      labelKey: 'inbox.preferences.title',
      path: '/account/notifications',
      icon: SlidersHorizontal,
    },
    { id: 'inbox.telegram', labelKey: 'telegram.title', path: '/account/telegram', icon: Send },
  ],
}

export default manifest
