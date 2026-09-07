// Registers the exact path `/` (MODULE-GUIDE.md "Web features": `matchFeatureRoute` is checked
// before the five core routes in `app.tsx`'s `RouteOutlet`), so this feature fully replaces
// `apps/web/src/routes/home.tsx`'s EPIC-000 placeholder without editing any core routing file --
// `home-screen.tsx`'s own header explains why that is safe (every guard the placeholder had is
// reproduced first). No sidebar entry of its own: `apps/web/src/shell/nav.ts`'s `CORE_NAV_ENTRIES`
// already carries a fixed `{ id: 'home', route: '/' }` entry (TECH-SPEC §5's five sidebar areas
// start with Home), so a second one here would just duplicate it.
import * as React from 'react'
import type { FeatureManifest } from '../types.js'

const HomeScreen = React.lazy(() => import('./home-screen.js'))

const manifest: FeatureManifest = {
  name: 'home',
  routes: [{ path: '/', component: HomeScreen, titleKey: 'home.eyebrow' }],
}

export default manifest
