import { BarChart3 } from 'lucide-react'
import * as React from 'react'
import type { FeatureManifest } from '../types.js'

const AnalyticsScreen = React.lazy(() => import('./checkin-screen.js'))

const manifest: FeatureManifest = {
  name: 'analytics',
  routes: [
    {
      path: '/analytics',
      component: AnalyticsScreen,
      titleKey: 'checkins.title',
    },
  ],
  // Shared deliverables are visible to every member; cycle agreement remains head-only.
  sidebar: [
    {
      id: 'analytics',
      labelKey: 'checkins.title',
      icon: BarChart3,
      route: '/analytics',
      action: 'analytics.department.read',
    },
  ],
  commands: [{ id: 'analytics.open', labelKey: 'checkins.title', path: '/analytics' }],
}

export default manifest
