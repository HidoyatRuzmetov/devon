// Feature manifest for the calendar module (MODULE-GUIDE.md "Web features"). `name` must equal this
// directory name ("calendar").
//
// This manifest carries one thing no other manifest does: `useSidebarCounts` is where the realtime
// bridge is mounted. The shell calls every manifest's counts hook unconditionally, once per render of
// the signed-in shell (`features/registry.ts` documents why that hook position is stable), which
// makes it the one place a feature can run session-wide code without editing `app.tsx` -- a file
// every parallel v1.1 package would otherwise have to touch. `useRealtimeBridge()` joins this
// person's department and inbox channels and turns each publication into a React Query invalidation,
// which is what replaces the product's polling.
//
// It returns no counts. A badge on "Kalendar" would be a badge on *time passing* -- every person has
// something in the next thirty days, so the number would never be absent and would therefore never
// mean anything (DESIGN.md: a count is a fact about your work, never decoration).
import * as React from 'react'
import { CalendarClock } from 'lucide-react'
import { queryClient } from '../../lib/query-client.js'
import { useRealtimeBridge } from '../../lib/realtime/index.js'
import type { FeatureManifest } from '../types.js'
import { prefetchAgenda } from './hooks.js'

const CalendarScreen = React.lazy(() => import('./calendar-screen.js'))

const manifest: FeatureManifest = {
  name: 'calendar',
  routes: [{ path: '/calendar', component: CalendarScreen, titleKey: 'calendar.title' }],
  sidebar: [
    {
      id: 'calendar',
      labelKey: 'calendar.title',
      icon: CalendarClock,
      route: '/calendar',
      // H5.2 "prefetch on hover/focus": warms the default 30-day agenda before the click.
      onPrefetch: () => void prefetchAgenda(queryClient),
    },
  ],
  commands: [
    { id: 'calendar.feeds', labelKey: 'calendar.feeds.title', path: '/calendar?tab=feeds' },
    { id: 'calendar.push', labelKey: 'calendar.push.title', path: '/calendar?tab=push' },
  ],
  useSidebarCounts: () => {
    useRealtimeBridge()
    return {}
  },
}

export default manifest
