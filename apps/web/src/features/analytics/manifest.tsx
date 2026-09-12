import * as React from 'react'
import { BarChart3 } from 'lucide-react'
import type { FeatureManifest } from '../types.js'

const AnalyticsScreen = React.lazy(() => import('./analytics-screen.js'))

const manifest: FeatureManifest = {
  name: 'analytics',
  routes: [
    {
      path: '/analytics',
      component: AnalyticsScreen,
      titleKey: 'analytics.title',
    },
  ],
  // SPEC §2.2: department and unit aggregates are for everyone; the person-axis charts inside are
  // head-only and the screen hides them (`analytics-screen.tsx`), so the entry itself stays open.
  sidebar: [
    {
      id: 'analytics',
      labelKey: 'analytics.title',
      icon: BarChart3,
      route: '/analytics',
      action: 'analytics.department.read',
    },
  ],
  commands: [{ id: 'analytics.open', labelKey: 'analytics.title', path: '/analytics' }],
}

export default manifest
