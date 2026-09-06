import * as React from 'react'
import { UserCog } from 'lucide-react'
import type { FeatureManifest } from '../types.js'

const RegisterScreen = React.lazy(() => import('./register-screen.js'))
const AccountSettingsScreen = React.lazy(() => import('./account-settings-screen.js'))

const manifest: FeatureManifest = {
  name: 'accounts',
  routes: [
    { path: '/register', component: RegisterScreen, titleKey: 'accounts.register.title' },
    { path: '/account', component: AccountSettingsScreen, titleKey: 'accounts.settings.title' },
  ],
  sidebar: [
    { id: 'account-settings', labelKey: 'accounts.settings.title', icon: UserCog, route: '/account' },
  ],
  commands: [],
}

export default manifest
