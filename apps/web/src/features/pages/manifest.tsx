import * as React from 'react'
import { FileText } from 'lucide-react'
import type { FeatureManifest } from '../types.js'

const PagesScreen = React.lazy(() => import('./pages-screen.js'))
const GettingStartedScreen = React.lazy(() => import('../onboarding/getting-started-screen.js'))

const manifest: FeatureManifest = {
  name: 'pages',
  routes: [
    { path: '/pages', component: PagesScreen, titleKey: 'pages.title' },
    {
      path: '/help',
      component: GettingStartedScreen,
      titleKey: 'onboarding.title',
    },
  ],
  sidebar: [{ id: 'pages', labelKey: 'pages.title', icon: FileText, route: '/pages' }],
  commands: [
    { id: 'pages.open', labelKey: 'pages.title', path: '/pages' },
    { id: 'help.open', labelKey: 'onboarding.title', path: '/help' },
  ],
}

export default manifest
