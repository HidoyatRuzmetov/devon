// Feature manifest for the automations module (EPIC-017): one route and one head-only sidebar entry
// in the Boshqaruv group (v1.1 SPEC §3.1).
import * as React from 'react'
import { Zap } from 'lucide-react'
import type { FeatureManifest } from '../types.js'

const AutomationsScreen = React.lazy(() => import('./components/automations-screen.js'))

const manifest: FeatureManifest = {
  name: 'automations',
  routes: [{ path: '/automations', component: AutomationsScreen, titleKey: 'automations.title' }],
  // `shell/nav.ts`'s `manage-head` group already reserves this id. The head-only `action` is what
  // makes a permanent slot safe: a xodim never sees the entry (nor the group heading), and a head
  // does not have to remember a palette id to reach the screen where their rules live.
  sidebar: [
    {
      id: 'automations',
      labelKey: 'automations.title',
      icon: Zap,
      route: '/automations',
      action: 'automations.read',
    },
  ],
}
export default manifest
