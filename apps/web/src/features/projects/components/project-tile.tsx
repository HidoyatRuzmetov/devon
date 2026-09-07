// The "one project card in every member's column" outcome (EPIC-005/TECH-SPEC §3.2) is rendered, not
// stored: a group project has no row in `app.cards` at all (only its objective/subjective *tasks*
// do -- `apps/api/src/modules/projects/repo.ts`'s `createProject` never inserts into `app.cards`), so
// the People board (a `work`-module screen) composes this tile from `useProjectsQuery()` for every
// project the column's member belongs to, rather than the server duplicating one synthetic card per
// member per project. Kept in `projects/components/` and imported by `work`'s board screen -- the one
// deliberate cross-feature import in this build, because EPIC-005 explicitly builds "one project card
// in every member's column" on top of EPIC-004's board, not the other way around.
//
// round2 SEV2: the tile was a 78px stub (ring + dot + name + "44% bajarildi") with no owner, no
// members, no next milestone, no status -- and the ring printed the same number the line beside it
// spelled out again. `compact` (the board-column header use) stays a small single line, duplicate
// number fixed; the full list use (`compact` omitted) is the rebuilt rich tile: status badge,
// one-line objective, next milestone with its date, a member AvatarStack and the task fraction.
import { useT, useLocale, formatDate } from '@devon/i18n'
import {
  AvatarStack,
  Badge,
  HoverLift,
  PressScale,
  ProgressRing,
  cn,
  initialsFromName,
  useReducedMotion,
} from '@devon/ui'
import { RouterLink } from '../../../lib/router.js'
import type { MemberSummary } from '../../work/api.js'
import type { Project, ProjectStatus } from '../api.js'

/** DESIGN.md §2.1: green stays success/done/on-track only -- "active" reads as merely under way. */
const STATUS_TONE: Record<ProjectStatus, 'neutral' | 'info' | 'warning' | 'success'> = {
  planning: 'neutral',
  active: 'info',
  on_hold: 'warning',
  done: 'success',
  archived: 'neutral',
}

function fullName(m: MemberSummary): string {
  return `${m.givenName} ${m.familyName}`.trim()
}

/** The earliest not-yet-done milestone, by due date (undated ones sort last) -- "what's next", the
 * one milestone worth surfacing on a tile that has room for exactly one. */
function nextMilestone(project: Project) {
  return [...project.milestones]
    .filter((m) => m.doneAt === null)
    .sort((a, b) => (a.dueOn ?? '9999-99-99').localeCompare(b.dueOn ?? '9999-99-99'))[0]
}

export function ProjectTile({
  project,
  members = [],
  compact = false,
}: {
  project: Project
  /** Resolves `project.ownerUserId`/`project.members` to names/avatars -- omit only in a context
   * with no roster at hand (`compact` never needs it). */
  members?: readonly MemberSummary[]
  /** The People board's per-column header use: one line, no duplicate percent, no properties --
   * the board card below it already carries assignee/priority/due for that member's own work. */
  compact?: boolean
}) {
  const t = useT()
  const locale = useLocale()
  const reduced = useReducedMotion()
  const percent = Math.round(project.progress * 100)
  const pulsing = project.status === 'active' && !reduced

  const ring = (
    <span className="relative inline-flex shrink-0 items-center justify-center">
      {pulsing ? (
        <span
          aria-hidden="true"
          className="absolute inset-0 animate-ping rounded-full bg-primary/20"
        />
      ) : null}
      <ProgressRing
        value={percent}
        size={compact ? 40 : 48}
        strokeWidth={3.5}
        label={t('projects.tile.progressAria', { percent })}
        toneClassName={project.status === 'done' ? 'text-success' : 'text-primary'}
      >
        {percent}
      </ProgressRing>
    </span>
  )

  const titleRow = (
    <div className="flex min-w-0 items-center gap-1.5">
      <span
        className="size-2 shrink-0 rounded-full"
        style={{ backgroundColor: project.colour }}
        aria-hidden="true"
      />
      <span className="truncate text-small font-semibold text-foreground">{project.title}</span>
    </div>
  )

  if (compact) {
    return (
      <HoverLift>
        <PressScale>
          <RouterLink
            href={`/projects/view?id=${encodeURIComponent(project.id)}`}
            className="flex items-center gap-3 rounded-md border border-border bg-card p-3 text-left shadow-1
              transition-colors hover:border-ring/50 focus-visible:outline-none focus-visible:ring-2
              focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {ring}
            {titleRow}
          </RouterLink>
        </PressScale>
      </HoverLift>
    )
  }

  const owner = members.find((m) => m.userId === project.ownerUserId)
  const memberPeople = project.members
    .map((id) => members.find((m) => m.userId === id))
    .filter((m): m is MemberSummary => Boolean(m))
    .map((m) => ({
      id: m.userId,
      name: fullName(m),
      initials: initialsFromName(m.givenName, m.familyName),
    }))
  const milestone = nextMilestone(project)
  const objectiveText = project.description?.text.trim() || null
  const taskTotal = project.objectiveTotal + project.subjectiveTotal
  const taskDone = project.objectiveDone + project.subjectiveDone

  return (
    <HoverLift className="h-full">
      <PressScale className="h-full">
        <RouterLink
          href={`/projects/view?id=${encodeURIComponent(project.id)}`}
          className="flex h-full flex-col gap-3 rounded-md border border-border bg-card p-4 text-left shadow-1
            transition-colors hover:border-ring/50 focus-visible:outline-none focus-visible:ring-2
            focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <div className="flex items-start gap-3">
            {ring}
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              {titleRow}
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge tone={STATUS_TONE[project.status]}>
                  {t(`projects.status.${project.status}`)}
                </Badge>
                {owner ? (
                  <span className="truncate text-caption text-muted-foreground">
                    {t('projects.tile.owner', { name: fullName(owner) })}
                  </span>
                ) : null}
              </div>
            </div>
          </div>

          {objectiveText ? (
            <p className="line-clamp-1 text-small text-muted-foreground">{objectiveText}</p>
          ) : null}

          <p className="text-caption text-muted-foreground">
            {milestone
              ? t('projects.tile.nextMilestone', {
                  title: milestone.title,
                  date: milestone.dueOn
                    ? formatDate(new Date(milestone.dueOn), locale)
                    : t('projects.tile.noDueDate'),
                })
              : t('projects.tile.noMilestone')}
          </p>

          <div className="mt-auto flex items-center justify-between gap-2 pt-1">
            {memberPeople.length > 0 ? (
              <AvatarStack people={memberPeople} max={4} label={t('projects.field.members')} />
            ) : (
              <span aria-hidden="true" />
            )}
            <span
              className={cn(
                'shrink-0 text-caption tabular-nums text-muted-foreground',
                taskTotal === 0 && 'invisible',
              )}
            >
              {t('projects.tile.tasks', { done: taskDone, total: taskTotal })}
            </span>
          </div>
        </RouterLink>
      </PressScale>
    </HoverLift>
  )
}
