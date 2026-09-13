// MODULE-GUIDE.md "Web features": the custom-fields manager (v1.1 SPEC §5). Its sidebar entry id is
// `fields`, which `shell/nav.ts`'s `manage-head` group already reserves -- so this manifest lands in
// the Boshqaruv group with no edit to the shell, and disappears entirely for a xodim because the
// entry declares a head-only action the shell resolves through the same `can()` the routes use.
//
// The member half of this feature has no route of its own: it is a section of `/account`
// (`components/my-fields-section.tsx`), which is where the fill request's deep link
// (`/account#fields`) and its Telegram button both point.
import * as React from 'react'
import { ListChecks } from 'lucide-react'
import type { FeatureManifest } from '../types.js'

const FieldsScreen = React.lazy(() => import('./fields-screen.js'))

const manifest: FeatureManifest = {
  name: 'fields',
  routes: [
    {
      path: '/fields',
      component: FieldsScreen,
      titleKey: 'fields.manager.title',
    },
  ],
  sidebar: [
    {
      id: 'fields',
      labelKey: 'fields.manager.nav',
      icon: ListChecks,
      route: '/fields',
      action: 'fields.definition.manage',
    },
  ],
  // Only the *member* half needs a palette entry of its own. `/fields` already reaches the palette
  // through its sidebar entry above, which carries the head-only action id -- a second, ungated
  // command for the same route would be the one way a xodim could be offered a destination the
  // sidebar just hid (`command-palette-controller.tsx` drops a command that repeats a nav route, so
  // this is also simply redundant today).
  commands: [
    {
      id: 'fields.my.open',
      labelKey: 'fields.my.title',
      path: '/account#fields',
    },
  ],
}

export default manifest
