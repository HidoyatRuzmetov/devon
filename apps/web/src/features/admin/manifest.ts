import * as React from 'react'
import type { FeatureManifest } from '../types.js'

const DashboardScreen = React.lazy(() => import('./dashboard-screen.js'))
const DepartmentsScreen = React.lazy(() => import('./departments-screen.js'))
const AccountsScreen = React.lazy(() => import('./accounts-screen.js'))
const AnalyticsScreen = React.lazy(() => import('./analytics-screen.js'))
const AuditScreen = React.lazy(() => import('./audit-screen.js'))
const HealthScreen = React.lazy(() => import('./health-screen.js'))
const SettingsScreen = React.lazy(() => import('./settings-screen.js'))

// EPIC-013: this feature's exact-path `/admin` route is checked by `app.tsx`'s route outlet before
// its own five-route switch (MODULE-GUIDE.md "Web features"), so it supersedes the foundation's
// `routes/admin.tsx` placeholder there -- see `dashboard-screen.tsx`'s header.
const manifest: FeatureManifest = {
  name: 'admin',
  routes: [
    { path: '/admin', component: DashboardScreen, titleKey: 'admin.console.title' },
    {
      path: '/admin/departments',
      component: DepartmentsScreen,
      titleKey: 'admin.console.tabs.departments',
    },
    { path: '/admin/accounts', component: AccountsScreen, titleKey: 'admin.console.tabs.accounts' },
    {
      path: '/admin/analytics',
      component: AnalyticsScreen,
      titleKey: 'admin.console.tabs.analytics',
    },
    { path: '/admin/audit', component: AuditScreen, titleKey: 'admin.console.tabs.audit' },
    { path: '/admin/health', component: HealthScreen, titleKey: 'admin.console.tabs.health' },
    { path: '/admin/settings', component: SettingsScreen, titleKey: 'admin.console.tabs.settings' },
  ],
  // No `sidebar` entry here: `shell/nav.ts`'s core `CORE_NAV_ENTRIES` already has one super-admin-only
  // "Boshqaruv" entry routing to `/admin` (design.md §3.6/§7) -- this manifest's routes below give that
  // existing entry somewhere real to land, rather than duplicating it (a second entry broke
  // `test/unit/nav.test.ts`'s exact-order assertion the first time this was tried, precisely because
  // it would be redundant).
  // Every tab of the super admin's console. `action: 'admin.console'` is what keeps them out of a
  // head's or a xodim's Ctrl+K -- the sidebar's own `/admin` entry is gated by `visibleWhen`, but a
  // palette row for a sub-tab has no sidebar twin to inherit that from (v1.1 integration, HANDOFFS #1).
  commands: [
    {
      id: 'admin.departments',
      labelKey: 'admin.console.tabs.departments',
      path: '/admin/departments',
      action: 'admin.console',
    },
    {
      id: 'admin.accounts',
      labelKey: 'admin.console.tabs.accounts',
      path: '/admin/accounts',
      action: 'admin.console',
    },
    {
      id: 'admin.analytics',
      labelKey: 'admin.console.tabs.analytics',
      path: '/admin/analytics',
      action: 'admin.console',
    },
    {
      id: 'admin.audit',
      labelKey: 'admin.console.tabs.audit',
      path: '/admin/audit',
      action: 'admin.console',
    },
    {
      id: 'admin.health',
      labelKey: 'admin.console.tabs.health',
      path: '/admin/health',
      action: 'admin.console',
    },
    {
      id: 'admin.settings',
      labelKey: 'admin.console.tabs.settings',
      path: '/admin/settings',
      action: 'admin.console',
    },
  ],
}

export default manifest
