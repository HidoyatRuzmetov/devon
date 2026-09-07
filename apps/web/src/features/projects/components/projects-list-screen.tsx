// Group projects list (TECH-SPEC §5, EPIC-005): every project the department runs, as cards with
// progress -- the same tiles the People board embeds (`ProjectTile`), just all of them in one grid
// with a way to start a new one.
import type * as React from 'react'
import { useT } from '@devon/i18n'
import { PageHeader, Skeleton, StateView } from '@devon/ui'
import { useProjectsQuery } from '../hooks.js'
import { CreateProjectDialog } from './create-project-dialog.js'
import { ProjectTile } from './project-tile.js'

export default function ProjectsListScreen() {
  const t = useT()
  const projectsQuery = useProjectsQuery()

  let body: React.ReactNode
  if (projectsQuery.isPending) {
    body = (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-28 w-full" />
        ))}
      </div>
    )
  } else if (projectsQuery.isError) {
    body = (
      <StateView
        kind="error"
        titleKey="state.error.title"
        bodyKey="state.error.body"
        action={{ labelKey: 'state.error.action', onAction: () => void projectsQuery.refetch() }}
      />
    )
  } else if (projectsQuery.data!.length === 0) {
    body = <StateView kind="empty" titleKey="projects.emptyTitle" bodyKey="projects.emptyBody" />
  } else {
    body = (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {projectsQuery.data!.map((project) => (
          <ProjectTile key={project.id} project={project} />
        ))}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        eyebrow={t('projects.eyebrow')}
        title={t('projects.title')}
        description={t('projects.description')}
        actions={<CreateProjectDialog />}
      />
      {body}
    </div>
  )
}
