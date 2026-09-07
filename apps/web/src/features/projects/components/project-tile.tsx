// The "one project card in every member's column" outcome (EPIC-005/TECH-SPEC §3.2) is rendered, not
// stored: a group project has no row in `app.cards` at all (only its objective/subjective *tasks*
// do -- `apps/api/src/modules/projects/repo.ts`'s `createProject` never inserts into `app.cards`), so
// the People board (a `work`-module screen) composes this tile from `useProjectsQuery()` for every
// project the column's member belongs to, rather than the server duplicating one synthetic card per
// member per project. Kept in `projects/components/` and imported by `work`'s board screen -- the one
// deliberate cross-feature import in this build, because EPIC-005 explicitly builds "one project card
// in every member's column" on top of EPIC-004's board, not the other way around.
import { useT } from '@devon/i18n'
import { HoverLift, ProgressRing, cn, useReducedMotion } from '@devon/ui'
import { RouterLink } from '../../../lib/router.js'
import type { Project } from '../api.js'

/** DESIGN.md's Jakob map ("Projects": "project cards with a progress ring and pulse"): a live project
 * gets a soft breathing halo behind its ring so it reads as "in motion" at a glance among a member's
 * cards -- done/archived projects sit still, and reduced motion always drops the pulse (the ring
 * itself, and the percentage inside it, are the feedback that survives). */
export function ProjectTile({ project }: { project: Project }) {
  const t = useT()
  const reduced = useReducedMotion()
  const percent = Math.round(project.progress * 100)
  const pulsing = project.status === 'active' && !reduced

  return (
    <HoverLift>
      <RouterLink
        href={`/projects/view?id=${encodeURIComponent(project.id)}`}
        className="flex items-center gap-3 rounded-md border border-border bg-card p-3 text-left shadow-1
          transition-colors hover:border-ring/50 focus-visible:outline-none focus-visible:ring-2
          focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        <span className="relative inline-flex shrink-0 items-center justify-center">
          {pulsing ? (
            <span
              aria-hidden="true"
              className="absolute inset-0 animate-ping rounded-full bg-primary/20"
            />
          ) : null}
          <ProgressRing
            value={percent}
            size={40}
            strokeWidth={3.5}
            label={t('projects.tile.progressAria', { percent })}
            toneClassName={project.status === 'done' ? 'text-success' : 'text-primary'}
          >
            {percent}
          </ProgressRing>
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex items-center gap-1.5">
            <span
              className={cn('size-2 shrink-0 rounded-full')}
              style={{ backgroundColor: project.colour }}
              aria-hidden="true"
            />
            <span className="truncate text-small font-semibold text-foreground">
              {project.title}
            </span>
          </div>
          <span className="text-caption text-muted-foreground">
            {t('projects.tile.progress', { percent })}
          </span>
        </div>
      </RouterLink>
    </HoverLift>
  )
}
