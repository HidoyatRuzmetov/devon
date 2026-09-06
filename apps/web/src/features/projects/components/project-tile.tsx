// The "one project card in every member's column" outcome (EPIC-005/TECH-SPEC §3.2) is rendered, not
// stored: a group project has no row in `app.cards` at all (only its objective/subjective *tasks*
// do -- `apps/api/src/modules/projects/repo.ts`'s `createProject` never inserts into `app.cards`), so
// the People board (a `work`-module screen) composes this tile from `useProjectsQuery()` for every
// project the column's member belongs to, rather than the server duplicating one synthetic card per
// member per project. Kept in `projects/components/` and imported by `work`'s board screen -- the one
// deliberate cross-feature import in this build, because EPIC-005 explicitly builds "one project card
// in every member's column" on top of EPIC-004's board, not the other way around.
import { useT } from '@devon/i18n'
import { RouterLink } from '../../../lib/router.js'
import type { Project } from '../api.js'

export function ProjectTile({ project }: { project: Project }) {
  const t = useT()
  const percent = Math.round(project.progress * 100)
  return (
    <RouterLink
      href={`/projects/view?id=${encodeURIComponent(project.id)}`}
      className="flex flex-col gap-1.5 rounded-md border border-border bg-card p-3 text-left shadow-1
        transition-colors hover:border-ring/50 focus-visible:outline-none focus-visible:ring-2
        focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      <div className="flex items-center gap-2">
        <span
          className="size-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: project.colour }}
          aria-hidden="true"
        />
        <span className="truncate text-small font-semibold text-foreground">{project.title}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
      </div>
      <span className="text-caption text-muted-foreground">
        {t('projects.tile.progress', { percent })}
      </span>
    </RouterLink>
  )
}
