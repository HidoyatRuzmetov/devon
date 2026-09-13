// Feature manifest for the automations module (EPIC-017). One route, one command-palette entry, no
// sidebar presence: automations are a head's setup screen, not a place anybody works daily, so it
// lives in the palette and in department settings rather than taking a permanent slot in a sidebar
// twenty-six members also see.
import * as React from 'react'
import { Zap } from 'lucide-react'
import type { FeatureManifest } from '../types.js'

const AutomationsScreen = React.lazy(() => import('./components/automations-screen.js'))

const manifest: FeatureManifest = {
  name: 'automations',
  routes: [{ path: '/automations', component: AutomationsScreen, titleKey: 'automations.title' }],
  commands: [{ id: 'automations', labelKey: 'automations.title', path: '/automations', icon: Zap }],
}
export default manifest
