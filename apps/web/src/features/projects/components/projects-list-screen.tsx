// Group projects list (TECH-SPEC §5, EPIC-005): every project the department runs, as cards with
// progress -- the same tiles the People board embeds (`ProjectTile`), just all of them in one grid
// with a way to start a new one.
import type * as React from 'react'
import { useT } from '@devon/i18n'
import { PageHeader, Skeleton, Stagger, StaggerItem, StateView } from '@devon/ui'
import { useMembers } from '../../work/hooks.js'
import { useProjectsQuery } from '../hooks.js'
import { CreateProjectDialog } from './create-project-dialog.js'
import { ProjectTile } from './project-tile.js'

export default function ProjectsListScreen() {
  const t = useT()
  const projectsQuery = useProjectsQuery()
  const members = useMembers()

  let body: React.ReactNode
  if (projectsQuery.isPending) {
    // round2 SEV2: six of the old 78px stub tiles left 570px of empty page below them -- the rebuilt
    // tile (status, objective, milestone, members, task fraction) is taller, and its skeleton matches
    // that (DESIGN.md §4's "skeleton matches final layout"), not the old stub's height.
    body = (
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-40 w-full" />
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
    // Two columns, not three -- the richer tile (owner, milestone, AvatarStack) needs the width a
    // third column would take away, and two rows of it fill the page a stub grid used to leave empty.
    body = (
      <Stagger className="grid grid-cols-1 items-stretch gap-3 lg:grid-cols-2">
        {projectsQuery.data!.map((project) => (
          <StaggerItem key={project.id}>
            <ProjectTile project={project} members={members} />
          </StaggerItem>
        ))}
      </Stagger>
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
