import * as React from 'react'
import { NotebookTabs } from 'lucide-react'
import type { FeatureManifest } from '../types.js'

const PersonalScreenLazy = React.lazy(() => import('./personal-screen.js'))

const manifest: FeatureManifest = {
  name: 'personal',
  routes: [{ path: '/personal', component: PersonalScreenLazy, titleKey: 'personal.title' }],
  sidebar: [{ id: 'personal', labelKey: 'personal.title', icon: NotebookTabs, route: '/personal' }],
  commands: [{ id: 'personal.open', labelKey: 'personal.title', path: '/personal' }],
}

export default manifest
