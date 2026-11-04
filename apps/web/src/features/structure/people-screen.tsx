import { ViewSkeleton } from '../../lib/view-skeleton.js'
// `/people` -- TECH-SPEC EPIC-003: "the People page listing members grouped by unit." Rebuilt to
// UI-OVERHAUL.md's Jakob row "People directory" (Slack members, Google Contacts): search first,
// cards with unit identity and professional profile drawers, unit filters and distinct empty/no-results.
import { useT } from '@devon/i18n'
import {
  Button,
  Checkbox,
  Popover,
  PopoverTrigger,
  PopoverContent,
  Input,
  Stagger,
  StaggerItem,
  StateView,
  cn,
  normalizeForSearch,
} from '@devon/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Building2, Search, ChevronDown } from 'lucide-react'
import * as React from 'react'
import { ApiError } from '../../lib/api-client.js'
import { useForcedState } from '../../lib/forced-state.js'
import { useSearchParams } from '../../lib/router.js'
import { useMeQuery } from '../../lib/session.js'
import { createUnitPalette, unitColorClass } from '../../lib/unit-palette.js'
import { useOnline } from '../../lib/use-online.js'
import { ForcedStateBlock } from '../../shell/forced-state-block.js'
import { createCard } from '../work/api.js'
import { QuickAssignSheet, type QuickAssignSubmit } from '../work/components/quick-assign-sheet.js'
import { fetchMembers, fetchUnitsOverview, type Member, type Unit } from './api.js'
import { DepartmentHeader } from './department-header.js'
import { MemberCard, formalName, fullName } from './member-card.js'
import { useMyDepartments } from './use-my-departments.js'

type Group = {
  scope: 'department' | 'unit' | 'unassigned'
  unit: Unit | null
  label: string
  members: Member[]
}

/** Depth-first order matching the tree list (`structure-screen.tsx`), so a bo'lim's members always
 * appear directly after the bo'lim itself and before its sub-bo'lim's members. */
function orderedUnits(units: Unit[]): Unit[] {
  const byParent = new Map<string | null, Unit[]>()
  for (const u of units) {
    const list = byParent.get(u.parentUnitId) ?? []
    list.push(u)
    byParent.set(u.parentUnitId, list)
  }
  for (const list of byParent.values())
    list.sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name))

  const out: Unit[] = []
  const visit = (parentId: string | null) => {
    for (const u of byParent.get(parentId) ?? []) {
      out.push(u)
      visit(u.id)
    }
  }
  visit(null)
  return out
}

function groupByUnit(units: Unit[], members: Member[]): Group[] {
  const byUnit = new Map<string, Member[]>()
  const leadership: Member[] = []
  const unassigned: Member[] = []
  for (const m of members) {
    if (m.membershipRole === 'head') leadership.push(m)
    else if (m.unitId) byUnit.set(m.unitId, [...(byUnit.get(m.unitId) ?? []), m])
    else unassigned.push(m)
  }
  const groups: Group[] = orderedUnits(units)
    .map((unit) => ({
      scope: 'unit' as const,
      unit,
      label: unit.name,
      members: byUnit.get(unit.id) ?? [],
    }))
    .filter((g) => g.members.length > 0)
  if (leadership.length > 0)
    groups.unshift({ scope: 'department', unit: null, label: '', members: leadership })
  if (unassigned.length > 0)
    groups.push({ scope: 'unassigned', unit: null, label: '', members: unassigned })
  return groups
}

/** Both name orders and the job title, folded through the one Uzbek-aware normaliser this product
 * uses everywhere (DESIGN.md §2.3) -- so "Karimova", "Nodira", "Gʻaniyev" and "G'aniyev" all find the
 * same colleague, whichever order the head happens to think in. */
function matchesQuery(m: Member, query: string): boolean {
  if (!query) return true
  const haystack = normalizeForSearch(`${fullName(m)} ${formalName(m)} ${m.title ?? ''}`)
  return haystack.includes(normalizeForSearch(query))
}

export default function PeopleScreen() {
  const t = useT()
  const forced = useForcedState()
  const online = useOnline()
  const departments = useMyDepartments()
  const departmentId = departments.activeDepartmentId
  const [query, setQuery] = React.useState('')
  const [unitFilter, setUnitFilter] = React.useState<string[]>(() =>
    new URLSearchParams(window.location.search).getAll('unit'),
  )
  // ui-blitz round3 #23: the hover card's "copy link" action writes `?member=<userId>` -- this reads
  // it back, drops any unit filter that would hide that member, and scrolls/highlights their card
  // once the directory has loaded. `consumedRef` makes this a one-shot effect (the param stays in the
  // URL after landing, so a later re-render must not keep re-scrolling/re-clearing the filter).
  const search = useSearchParams()
  const me = useMeQuery().data
  const csrf = me?.csrfToken ?? ''
  const queryClient = useQueryClient()
  const [assignTarget, setAssignTarget] = React.useState<Member | null>(null)

  const assignMutation = useMutation({
    mutationFn: (input: QuickAssignSubmit) =>
      Promise.all(
        input.assigneeUserIds.map((assigneeUserId) =>
          createCard(
            {
              title: input.title,
              assigneeUserId,
              priority: input.priority,
              dueAt: input.dueAt,
              ...(input.estimateMin === null ? {} : { estimateMin: input.estimateMin }),
            },
            csrf,
          ),
        ),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['work', 'board'] })
    },
  })

  const highlightMemberId = search.get('member')
  const [highlightedId, setHighlightedId] = React.useState<string | null>(null)
  const consumedHighlightRef = React.useRef<string | null>(null)

  const membersQuery = useQuery({
    queryKey: ['structure', 'members', departmentId],
    queryFn: () => fetchMembers(departmentId!),
    enabled: departmentId !== null,
  })
  const unitsQuery = useQuery({
    queryKey: ['structure', 'units', departmentId],
    queryFn: () => fetchUnitsOverview(departmentId!),
    enabled: departmentId !== null,
  })

  React.useEffect(() => {
    if (!highlightMemberId || !membersQuery.data) return
    if (consumedHighlightRef.current === highlightMemberId) return
    const member = membersQuery.data.find((m) => m.userId === highlightMemberId)
    if (!member) return
    consumedHighlightRef.current = highlightMemberId
    setUnitFilter((cur) => (cur.length && !cur.includes(member.unitId ?? '') ? [] : cur))
    setQuery('')
    const raf = requestAnimationFrame(() => {
      const el = document.querySelector(`[data-member-id="${CSS.escape(highlightMemberId)}"]`)
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      setHighlightedId(highlightMemberId)
      window.setTimeout(
        () => setHighlightedId((cur) => (cur === highlightMemberId ? null : cur)),
        2400,
      )
    })
    return () => cancelAnimationFrame(raf)
  }, [highlightMemberId, membersQuery.data])

  if (forced) return <ForcedStateBlock kind={forced} />

  if (!online) {
    return (
      <StateView
        kind="offline"
        titleKey="state.offline.banner"
        bodyKey="state.offline.empty"
        action={{ labelKey: 'state.error.action', onAction: () => window.location.reload() }}
      />
    )
  }
  if (departments.isLoading || (departmentId && (membersQuery.isPending || unitsQuery.isPending))) {
    return <ViewSkeleton view="people" />
  }
  const error = membersQuery.error ?? unitsQuery.error ?? (departments.isError ? new Error() : null)
  if (error instanceof ApiError && error.code === 'forbidden') {
    return (
      <StateView
        kind="forbidden"
        titleKey="state.denied.title"
        bodyKey="state.denied.body"
        action={{ labelKey: 'state.denied.action', onAction: () => window.history.back() }}
      />
    )
  }
  if (error) {
    return (
      <StateView
        kind="error"
        titleKey="state.error.title"
        bodyKey="state.error.body"
        action={{ labelKey: 'state.error.action', onAction: () => membersQuery.refetch() }}
      />
    )
  }
  if (!departmentId || !membersQuery.data || !unitsQuery.data) {
    return (
      <StateView
        kind="empty"
        titleKey="structure.people.empty.title"
        action={{ labelKey: 'state.error.action', onAction: () => window.location.reload() }}
      />
    )
  }

  const allMembers = membersQuery.data
  const units = orderedUnits(unitsQuery.data.units)
  const unitsById = new Map(units.map((u) => [u.id, u]))
  const unitPalette = createUnitPalette(units)
  const isFiltering = query.trim().length > 0 || unitFilter.length > 0

  const filtered = allMembers
    .filter((m) => matchesQuery(m, query))
    .filter((m) => unitFilter.length === 0 || unitFilter.includes(m.unitId ?? ''))

  const groups = groupByUnit(units, filtered)
  const hasAnyMembers = allMembers.length > 0

  // A plain if/else (not a JSX ternary chain) so no `>...<` boundary in the switch itself can ever be
  // mistaken for hard-coded text by `check-i18n.mjs`'s regex heuristic (structure-screen.tsx's own
  // body switch does the same, for the same reason).
  let body: React.ReactNode
  if (!hasAnyMembers) {
    body = <StateView kind="empty" titleKey="structure.people.empty.title" />
  } else if (groups.length === 0) {
    body = (
      <StateView
        kind="empty"
        titleKey="structure.people.noResults.title"
        bodyKey="structure.people.noResults.body"
        {...(isFiltering
          ? {
              action: {
                labelKey: 'structure.people.filters.clear',
                onAction: () => {
                  setQuery('')
                  setUnitFilter([])
                },
              },
            }
          : {})}
      />
    )
  } else {
    body = (
      <div className="flex flex-col gap-8">
        {groups.map((group) => (
          <section
            key={group.unit?.id ?? group.scope}
            data-unit-color={unitColorClass(
              unitPalette,
              group.unit?.id,
              group.scope === 'department',
            )}
            style={
              {
                '--directory-unit': `var(${unitColorClass(unitPalette, group.unit?.id, group.scope === 'department').replace('bg-', '--color-')})`,
              } as React.CSSProperties
            }
            className="flex min-w-0 flex-col gap-4 rounded-lg border border-border bg-[color-mix(in_oklab,var(--directory-unit)_5%,var(--color-background))] p-3 sm:p-4"
          >
            <h2 className="flex items-center gap-3 text-lead font-semibold sm:text-h3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-[color-mix(in_oklab,var(--directory-unit)_15%,var(--color-card))] text-foreground">
                <Building2 className="size-5" aria-hidden="true" />
              </span>
              {group.unit
                ? group.label
                : t(
                    group.scope === 'department'
                      ? 'headScope.leadership'
                      : 'structure.people.unassignedGroup',
                  )}
              <span className="ml-1.5 normal-case tracking-normal text-muted-foreground">
                ({group.members.length})
              </span>
            </h2>
            <Stagger
              className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
              animateKey={query}
            >
              {group.members.map((m) => (
                <StaggerItem key={m.userId} className="h-full">
                  <div
                    data-member-id={m.userId}
                    className={cn(
                      'h-full rounded-md transition-shadow duration-(--dur-standard)',
                      highlightedId === m.userId &&
                        'ring-2 ring-primary ring-offset-2 ring-offset-background',
                    )}
                  >
                    <MemberCard
                      member={m}
                      unitColour={unitColorClass(
                        unitPalette,
                        m.unitId,
                        m.membershipRole === 'head',
                      )}
                      unit={m.unitId ? (unitsById.get(m.unitId) ?? null) : null}
                      onAssign={m.userId === me?.user.id ? undefined : () => setAssignTarget(m)}
                    />
                  </div>
                </StaggerItem>
              ))}
            </Stagger>
          </section>
        ))}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <DepartmentHeader
        titleKey="structure.people.title"
        subtitleKey="structure.people.subtitle"
        departments={departments}
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative max-w-100 flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('structure.people.searchPlaceholder')}
            aria-label={t('structure.people.searchPlaceholder')}
            className="pl-9"
          />
        </div>
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="secondary"
              className="min-w-36 justify-between"
              aria-label={t('structure.people.filters.label')}
            >
              <Building2 className="size-4" />
              {unitFilter.length
                ? t('peopleDownloads.unitsSelected', { count: unitFilter.length })
                : t('structure.people.filters.all')}
              <ChevronDown className="size-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            className="w-72 p-2"
            aria-label={t('structure.people.filters.label')}
          >
            <label className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2.5 text-small hover:bg-accent">
              <Checkbox
                checked={unitFilter.length === 0}
                onCheckedChange={() => setUnitFilter([])}
              />
              {t('structure.people.filters.all')}
            </label>
            <div className="my-1 border-t border-border" />
            <div className="max-h-72 overflow-y-auto">
              {units.map((unit) => (
                <label
                  key={unit.id}
                  className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2.5 text-small hover:bg-accent"
                >
                  <Checkbox
                    checked={unitFilter.includes(unit.id)}
                    onCheckedChange={() =>
                      setUnitFilter((current) =>
                        current.includes(unit.id)
                          ? current.filter((id) => id !== unit.id)
                          : [...current, unit.id],
                      )
                    }
                  />
                  <span
                    className={cn(
                      'size-2 shrink-0 rounded-full',
                      unitColorClass(unitPalette, unit.id),
                    )}
                  />
                  <span className="min-w-0 break-words">{unit.name}</span>
                </label>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {body}

      {/* SEV2 #15: the same composer the people table's row action opens -- one card per person,
          with its own history, never a shared card. Any member may create one for a colleague. */}
      <QuickAssignSheet
        targets={
          assignTarget
            ? [
                {
                  userId: assignTarget.userId,
                  givenName: assignTarget.givenName,
                  familyName: assignTarget.familyName,
                  title: assignTarget.title,
                  avatarKey: assignTarget.avatarKey,
                },
              ]
            : []
        }
        onOpenChange={(open) => {
          if (!open) setAssignTarget(null)
        }}
        onSubmit={async (input) => {
          await assignMutation.mutateAsync(input)
        }}
        pending={assignMutation.isPending}
      />
    </div>
  )
}
