// Feature manifest for the group-projects module (MODULE-GUIDE.md "Web features").
import * as React from 'react'
import { FolderKanban } from 'lucide-react'
import type { FeatureManifest } from '../types.js'

const ProjectsListScreen = React.lazy(() => import('./components/projects-list-screen.js'))
const ProjectPageScreen = React.lazy(() => import('./components/project-page-screen.js'))

const manifest: FeatureManifest = {
  name: 'projects',
  routes: [
    { path: '/projects', component: ProjectsListScreen, titleKey: 'projects.title' },
    { path: '/projects/view', component: ProjectPageScreen, titleKey: 'projects.title' },
  ],
  sidebar: [{ id: 'projects', labelKey: 'projects.title', icon: FolderKanban, route: '/projects' }],
  quickAdd: [
    {
      id: 'projects.newProject',
      labelKey: 'projects.create.button',
      path: '/projects?new=1',
      icon: FolderKanban,
    },
  ],
}
export default manifest
