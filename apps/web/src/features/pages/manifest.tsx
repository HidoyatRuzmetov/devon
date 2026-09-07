import * as React from 'react'
import { FileText } from 'lucide-react'
import type { FeatureManifest } from '../types.js'

const PagesScreen = React.lazy(() => import('./pages-screen.js'))

const manifest: FeatureManifest = {
  name: 'pages',
  routes: [{ path: '/pages', component: PagesScreen, titleKey: 'pages.title' }],
  sidebar: [{ id: 'pages', labelKey: 'pages.title', icon: FileText, route: '/pages' }],
  commands: [{ id: 'pages.open', labelKey: 'pages.title', path: '/pages' }],
}

export default manifest
