import * as React from 'react'
import { Sparkles } from 'lucide-react'
import type { FeatureManifest } from '../types.js'

const AiSettingsScreenLazy = React.lazy(() => import('./ai-settings-screen.js'))

const manifest: FeatureManifest = {
  name: 'ai',
  routes: [{ path: '/ai', component: AiSettingsScreenLazy, titleKey: 'ai.title' }],
  sidebar: [{ id: 'ai', labelKey: 'ai.title', icon: Sparkles, route: '/ai' }],
  commands: [{ id: 'ai.open', labelKey: 'ai.title', path: '/ai' }],
}

export default manifest
