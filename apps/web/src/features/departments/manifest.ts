import * as React from 'react'
import { Building2, ClipboardCheck, Settings2 } from 'lucide-react'
import type { FeatureManifest } from '../types.js'

const DepartmentsHubScreen = React.lazy(() => import('./departments-hub-screen.js'))
const CreateRequestScreen = React.lazy(() => import('./create-request-screen.js'))
const ApprovalQueueScreen = React.lazy(() => import('./approval-queue-screen.js'))
const DepartmentDetailScreen = React.lazy(() => import('./department-detail-screen.js'))
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
      id: 'departments',
      labelKey: 'departments.title',
      icon: Building2,
      route: '/departments',
    },
    {
      id: 'department-requests',
      labelKey: 'departments.approvalQueue.title',
      icon: ClipboardCheck,
      route: '/departments/requests',
      visibleWhen: (ctx) => ctx.role === 'super_admin',
    },
    // v1.1 SPEC §3.1: "Boʻlim sozlamalari" belongs in the head's Boshqaruv group. A member reaching
    // `/department` still sees the department's profile and its settings *values* (they must know
    // whether self-assign is on); what they never see is the entry that presents it as a control
    // panel, nor the Invite/Danger tabs the screen itself gates.
    {
      id: 'department-settings',
      labelKey: 'departments.settings.title',
      icon: Settings2,
      route: '/department',
      action: 'departments.settings.edit',
    },
  ],
  commands: [
    {
      id: 'departments.create',
      labelKey: 'departments.landing.createCta',
      path: '/departments/new',
    },
    {
      id: 'departments.join',
      labelKey: 'departments.landing.joinCta',
      path: '/join',
    },
  ],
}

export default manifest
