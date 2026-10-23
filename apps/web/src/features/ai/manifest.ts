import * as React from 'react'
import { MessageSquareText, Search, Sparkles } from 'lucide-react'
import type { FeatureManifest } from '../types.js'

const AiSettingsScreenLazy = React.lazy(() => import('./ai-settings-screen.js'))
const AssistantScreen = React.lazy(() => import('./assistant-screen.js'))

const manifest: FeatureManifest = {
  name: 'ai',
  routes: [
    { path: '/assistant', component: AssistantScreen, titleKey: 'assistantWorkspace.title' },
    { path: '/ai', component: AiSettingsScreenLazy, titleKey: 'ai.title' },
  ],
  // SPEC §3.1: `/ai` is the helper catalogue for a member and the budget/flags/spend console for the
  // head -- one route, two products, gated field by field on the server (D2). The entry itself stays
  // visible to everyone: you must know which helpers you may use.
  sidebar: [
    {
      id: 'assistant',
      labelKey: 'assistantWorkspace.title',
      icon: Sparkles,
      route: '/assistant',
      action: 'ai.features.read',
    },
  ],
  // AI-AUDIT §5 fix 18: before v1.1 the palette knew exactly one AI thing -- "open /ai". The two
  // entries a person actually wants from a keyboard are the ones that answer a question (`Soʻrash`)
  // and the one that finds something across the whole department, so both get a command of their
  // own, deep-linking to the tab rather than dropping the person on the screen's first tab to hunt.
  commands: [
    { id: 'ai.open', labelKey: 'ai.title', path: '/ai', icon: Sparkles },
    { id: 'ai.ask', labelKey: 'ai.command.ask', path: '/assistant', icon: MessageSquareText },
    { id: 'ai.search', labelKey: 'ai.command.search', path: '/ai?tab=ask', icon: Search },
  ],
}

export default manifest
