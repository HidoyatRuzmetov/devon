import * as React from 'react'
import { BarChart3 } from 'lucide-react'
import type { FeatureManifest } from '../types.js'

const AnalyticsScreen = React.lazy(() => import('./analytics-screen.js'))

const manifest: FeatureManifest = {
  name: 'analytics',
  routes: [{ path: '/analytics', component: AnalyticsScreen, titleKey: 'analytics.title' }],
  sidebar: [{ id: 'analytics', labelKey: 'analytics.title', icon: BarChart3, route: '/analytics' }],
  commands: [{ id: 'analytics.open', labelKey: 'analytics.title', path: '/analytics' }],
}

export default manifest
