// MODULE-GUIDE.md "Web features": the head's people surfaces (v1.1 SPEC §4.3, §6). `/people` itself
// stays the everyone-directory owned by the `structure` feature -- this feature owns the management
// half, which is why its table entry declares a head-only action and lands in the Boshqaruv group
// (`shell/nav.ts`'s `manage-head`).
//
// `/people/me` is the one person page a xodim may open (SPEC §6), so it declares
// `people.person.readOwn` -- an `own_account` action every signed-in person passes.
import * as React from 'react'
import { IdCard, Table2 } from 'lucide-react'
import type { FeatureManifest } from '../types.js'

const PeopleTableScreen = React.lazy(() => import('./people-table-screen.js'))
const MyProfileScreen = React.lazy(() => import('./my-profile-screen.js'))

const manifest: FeatureManifest = {
  name: 'people',
  routes: [
    {
      path: '/people/table',
      component: PeopleTableScreen,
      titleKey: 'people.table.title',
    },
    {
      path: '/people/me',
      component: MyProfileScreen,
      titleKey: 'people.person.own.title',
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
      icon: Table2,
    },
    {
      id: 'people.me.open',
      labelKey: 'people.person.own.title',
      path: '/people/me',
      icon: IdCard,
    },
  ],
}

export default manifest
