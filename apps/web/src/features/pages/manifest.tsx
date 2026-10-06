import * as React from 'react'
import { FileText } from 'lucide-react'
import type { FeatureManifest } from '../types.js'

const PagesScreen = React.lazy(() => import('./pages-screen.js'))
const FaqScreen = React.lazy(() => import('./faq-screen.js'))

const manifest: FeatureManifest = {
  name: 'pages',
  routes: [
    { path: '/pages', component: PagesScreen, titleKey: 'pages.title' },
    { path: '/help', component: FaqScreen, titleKey: 'help.title' },
  ],
  sidebar: [{ id: 'pages', labelKey: 'pages.title', icon: FileText, route: '/pages' }],
  commands: [
    { id: 'pages.open', labelKey: 'pages.title', path: '/pages' },
    { id: 'help.open', labelKey: 'help.title', path: '/help' },
  ],
}

export default manifest
