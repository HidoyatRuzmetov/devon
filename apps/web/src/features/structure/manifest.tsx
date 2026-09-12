// MODULE-GUIDE.md "Web features": routes, sidebar entries and command-palette entries for the
// structure module (EPIC-003) -- bo'limlar/org chart at `/structure`, the People page at `/people`.
// `app.tsx`'s route outlet, `shell/nav.ts`'s sidebar and the command palette all read this via
// `registry.ts`; none of them is ever edited to add this feature.
import * as React from 'react'
import { Network, Users } from 'lucide-react'
import type { FeatureManifest } from '../types.js'

const StructureScreen = React.lazy(() => import('./structure-screen.js'))
const PeopleScreen = React.lazy(() => import('./people-screen.js'))

const manifest: FeatureManifest = {
  name: 'structure',
  routes: [
    {
      path: '/structure',
      component: StructureScreen,
      titleKey: 'structure.units.title',
    },
    {
      path: '/people',
      component: PeopleScreen,
      titleKey: 'structure.people.title',
    },
  ],
  sidebar: [
    // Both stay visible to every member: knowing who sits where is everyday knowledge (SPEC §2.2).
    // What a member does not get is the *editing* -- `structure-screen.tsx` hides those affordances
    // through `useCan('structure.unit.edit')`, and the server refuses them regardless.
    {
      id: 'structure',
      labelKey: 'structure.nav.units',
      icon: Network,
      route: '/structure',
      action: 'structure.read',
    },
    {
      id: 'people',
      labelKey: 'structure.nav.people',
      icon: Users,
      route: '/people',
      action: 'people.directory.read',
    },
  ],
  commands: [],
}

export default manifest
