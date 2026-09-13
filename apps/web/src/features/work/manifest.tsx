// Feature manifest for the work module (MODULE-GUIDE.md "Web features"): routes, the sidebar entry,
// and command-palette entries. Every screen component is `React.lazy` so a session that never opens
// `/work` never pays for this feature's bundle.
import * as React from 'react'
import { GaugeCircle, KanbanSquare, Target } from 'lucide-react'
import { queryClient } from '../../lib/query-client.js'
import type { FeatureManifest } from '../types.js'
import { prefetchBoard } from './hooks.js'

const BoardScreen = React.lazy(() => import('./components/board-screen.js'))
const TableScreen = React.lazy(() => import('./components/table-screen.js'))
const TimelineScreen = React.lazy(() => import('./components/timeline-screen.js'))
const CalendarScreen = React.lazy(() => import('./components/calendar-screen.js'))
const MineScreen = React.lazy(() => import('./components/mine-screen.js'))
const ArchiveScreen = React.lazy(() => import('./components/archive-screen.js'))
const CardPageScreen = React.lazy(() => import('./components/card-page-screen.js'))
// v1.1 SPEC §7: the three screens the work-plus features earned of their own.
const WorkloadScreen = React.lazy(() => import('./components/workload-screen.js'))
const TemplatesScreen = React.lazy(() => import('./components/templates-screen.js'))
const GoalsScreen = React.lazy(() => import('./components/goals-screen.js'))

const manifest: FeatureManifest = {
  name: 'work',
  routes: [
    { path: '/work', component: BoardScreen, titleKey: 'work.title' },
    { path: '/work/table', component: TableScreen, titleKey: 'work.view.table' },
    { path: '/work/timeline', component: TimelineScreen, titleKey: 'work.view.timeline' },
    { path: '/work/calendar', component: CalendarScreen, titleKey: 'work.view.calendar' },
    { path: '/work/mine', component: MineScreen, titleKey: 'work.view.mine' },
    { path: '/work/archive', component: ArchiveScreen, titleKey: 'work.view.archive' },
    { path: '/work/card', component: CardPageScreen, titleKey: 'work.card.peekTitle' },
    { path: '/work/workload', component: WorkloadScreen, titleKey: 'work.workload.title' },
    { path: '/work/templates', component: TemplatesScreen, titleKey: 'work.templates.title' },
    { path: '/goals', component: GoalsScreen, titleKey: 'work.goals.title' },
  ],
  // H5.2 "prefetch on hover/focus": warms the board query before the click that navigates here.
  sidebar: [
    {
      id: 'work',
      labelKey: 'work.title',
      icon: KanbanSquare,
      route: '/work',
      onPrefetch: () => void prefetchBoard(queryClient),
    },
    // v1.1 SPEC §3.1: two of the six destinations `shell/nav.ts`'s `manage-head` group reserves ids
    // for. Both declare a head-only action, so the entries -- and the group heading with them --
    // simply do not exist for a xodim, resolved by the same `can()` the routes declare.
    {
      id: 'workload',
      labelKey: 'work.workload.title',
      icon: GaugeCircle,
      route: '/work/workload',
      action: 'work.workload.read',
    },
    {
      id: 'goals',
      labelKey: 'work.goals.title',
      icon: Target,
      route: '/goals',
      action: 'goals.read',
    },
  ],
  commands: [
    { id: 'work.mine', labelKey: 'work.view.mine', path: '/work/mine' },
    { id: 'work.table', labelKey: 'work.view.table', path: '/work/table' },
    { id: 'work.templates', labelKey: 'work.templates.title', path: '/work/templates' },
  ],
  // The shell's top-bar quick-add (MODULE-GUIDE.md "Web features": `quickAdd`).
  //
  // v1.1 (WALKTHROUGH-FINDINGS 2.2): this used to point at `/work`, so the product's most prominent
  // button navigated to the board and stopped -- no dialog, no focused input. `?new=1` opens the
  // card composer (`components/new-card-dialog.tsx`) on arrival, from any screen in the product.
  quickAdd: [
    {
      id: 'work.newCard',
      labelKey: 'work.actions.create',
      path: '/work?new=1',
      icon: KanbanSquare,
    },
  ],
}
export default manifest
