// MODULE-GUIDE.md "Web features": the head's people surfaces (v1.1 SPEC §4.3, §6). `/people` itself
// stays the everyone-directory owned by the `structure` feature -- this feature owns the management
// half, which is why its sidebar entry declares a head-only action and lands in the Boshqaruv group
// (`shell/nav.ts`'s `manage-head`).
import * as React from 'react'
import { Table2 } from 'lucide-react'
import type { FeatureManifest } from '../types.js'

const PeopleTableScreen = React.lazy(() => import('./people-table-screen.js'))

const manifest: FeatureManifest = {
  name: 'people',
  routes: [
    {
      path: '/people/table',
      component: PeopleTableScreen,
      titleKey: 'people.table.title',
    },
  ],
  sidebar: [
    {
      id: 'people-table',
      labelKey: 'people.table.nav',
      icon: Table2,
      route: '/people/table',
      // The shell resolves this through the same `can()` the endpoint declares, so the entry and the
      // 403 can never disagree (SPEC §3.1).
      action: 'people.table.read',
    },
  ],
  commands: [
    {
      id: 'people.table.open',
      labelKey: 'people.table.nav',
      path: '/people/table',
    },
  ],
}

export default manifest
