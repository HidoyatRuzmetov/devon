import * as React from 'react'
import { ClipboardCheck } from 'lucide-react'
import type { FeatureManifest } from '../types.js'

const DepartmentsHubScreen = React.lazy(() => import('./departments-hub-screen.js'))
const CreateRequestScreen = React.lazy(() => import('./create-request-screen.js'))
const ApprovalQueueScreen = React.lazy(() => import('./approval-queue-screen.js'))
const DepartmentDetailScreen = React.lazy(() => import('../accounts/legacy-settings-screen.js'))
const JoinScreen = React.lazy(() => import('./join-screen.js'))

const manifest: FeatureManifest = {
  name: 'departments',
  routes: [
    {
      path: '/departments',
      component: DepartmentsHubScreen,
      titleKey: 'departments.title',
    },
    {
      path: '/departments/new',
      component: CreateRequestScreen,
      titleKey: 'departments.create.title',
    },
    {
      path: '/departments/requests',
      component: ApprovalQueueScreen,
      titleKey: 'departments.approvalQueue.title',
    },
    {
      path: '/department',
      component: DepartmentDetailScreen,
      titleKey: 'departments.settings.title',
    },
    {
      path: '/join',
      component: JoinScreen,
      titleKey: 'departments.join.title',
    },
  ],
  sidebar: [
    {
      id: 'department-requests',
      labelKey: 'departments.approvalQueue.title',
      icon: ClipboardCheck,
      route: '/departments/requests',
      visibleWhen: (ctx) => ctx.role === 'super_admin',
    },
  ],
  commands: [
    {
      id: 'departments.create',
      labelKey: 'departments.landing.createCta',
      path: '/departments/new',
      // v1.1 critique SEV2 #11: Ctrl+K offered "Boʻlim yaratish" to a xodim who is already in a
      // department. SPEC §2.2 puts that CTA in the no-department state only -- creating a department
      // raises a super-admin approval request, so this is a real mis-trigger, not clutter. The
      // `/departments` page was fixed in the wave; the palette was not, because a palette entry had
      // no way to say this. Now it does.
      visibleWhen: (ctx) => ctx.hasDepartment === false,
    },
    {
      id: 'departments.join',
      labelKey: 'departments.landing.joinCta',
      path: '/join',
    },
  ],
}

export default manifest
