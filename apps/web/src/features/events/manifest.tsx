// Feature manifest (MODULE-GUIDE.md "Web features") -- the one file `registry.ts` discovers via
// `import.meta.glob`. `name` must equal this directory name ("events").
import * as React from 'react'
import { CalendarDays } from 'lucide-react'
import { queryClient } from '../../lib/query-client.js'
import type { FeatureManifest } from '../types.js'

const EventsScreen = React.lazy(() => import('./events-screen.js'))

const manifest: FeatureManifest = {
  name: 'events',
  routes: [{ path: '/events', component: EventsScreen, titleKey: 'events.title' }],
  // H5.2 "prefetch on hover/focus": warms the default-range events list before the click.
  sidebar: [
    {
      id: 'events',
      labelKey: 'events.title',
      icon: CalendarDays,
      route: '/events',
      onPrefetch: () => {
        void import('./hooks.js')
          .then(({ prefetchEvents }) => prefetchEvents(queryClient))
          .catch(() => {})
      },
    },
  ],
  commands: [{ id: 'events.create', labelKey: 'events.actions.create', path: '/events?new=1' }],
  quickAdd: [
    {
      id: 'events.newEvent',
      labelKey: 'events.actions.create',
      path: '/events?new=1',
      icon: CalendarDays,
    },
  ],
}

export default manifest
