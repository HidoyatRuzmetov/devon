import * as React from 'react'
import { Sparkles } from 'lucide-react'
import type { FeatureManifest } from '../types.js'

const AiSettingsScreenLazy = React.lazy(() => import('./ai-settings-screen.js'))

const manifest: FeatureManifest = {
  name: 'ai',
  routes: [{ path: '/ai', component: AiSettingsScreenLazy, titleKey: 'ai.title' }],
  // SPEC §3.1: `/ai` is the helper catalogue for a member and the budget/flags/spend console for the
  // head -- one route, two products, gated field by field on the server (D2). The entry itself stays
  // visible to everyone: you must know which helpers you may use.
  sidebar: [
    {
      id: 'ai',
      labelKey: 'ai.title',
      icon: Sparkles,
      route: '/ai',
      action: 'ai.features.read',
    },
  ],
  commands: [{ id: 'ai.open', labelKey: 'ai.title', path: '/ai' }],
}

export default manifest
