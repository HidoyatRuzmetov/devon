// `/people` -- TECH-SPEC EPIC-003: "the People page listing members grouped by unit." Rebuilt to
// UI-OVERHAUL.md's Jakob row "People directory" (Slack members, Google Contacts): search first,
// cards grid with avatar/title/unit chip, a hover card, filters by unit, distinct empty/no-results.
import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { useT } from '@devon/i18n'
import { FilterChip, Input, Stagger, StaggerItem, StateView } from '@devon/ui'
import { Search } from 'lucide-react'
import { useForcedState } from '../../lib/forced-state.js'
import { ForcedStateBlock } from '../../shell/forced-state-block.js'
import { useOnline } from '../../lib/use-online.js'
import { ApiError } from '../../lib/api-client.js'
import { fetchMembers, fetchUnitsOverview, type Member, type Unit } from './api.js'
import { useMyDepartments } from './use-my-departments.js'
import { DepartmentHeader } from './department-header.js'
import { MemberCard, fullName } from './member-card.js'

type Group = { unit: Unit | null; label: string; members: Member[] }

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
  const unassigned: Member[] = []
  for (const m of members) {
    if (m.unitId) byUnit.set(m.unitId, [...(byUnit.get(m.unitId) ?? []), m])
    else unassigned.push(m)
  }
  const groups: Group[] = orderedUnits(units)
    .map((unit) => ({ unit, label: unit.name, members: byUnit.get(unit.id) ?? [] }))
    .filter((g) => g.members.length > 0)
  if (unassigned.length > 0) groups.push({ unit: null, label: '', members: unassigned })
  return groups
}

function matchesQuery(m: Member, query: string): boolean {
  if (!query) return true
  const haystack = `${fullName(m)} ${m.title ?? ''}`.toLocaleLowerCase()
  return haystack.includes(query.toLocaleLowerCase())
}

export default function PeopleScreen() {
  const t = useT()
  const forced = useForcedState()
  const online = useOnline()
  const departments = useMyDepartments()
  const departmentId = departments.activeDepartmentId
  const [query, setQuery] = React.useState('')
  const [unitFilter, setUnitFilter] = React.useState<string | null>(null)

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
    return <StateView kind="loading" titleKey="structure.people.title" />
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
  const isFiltering = query.trim().length > 0 || unitFilter !== null

  const filtered = allMembers
    .filter((m) => matchesQuery(m, query))
    .filter((m) => unitFilter === null || m.unitId === unitFilter)

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
                  setUnitFilter(null)
                },
              },
            }
          : {})}
      />
    )
  } else if (unitFilter !== null) {
    body = (
      <Stagger
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
        animateKey={`${unitFilter}:${query}`}
      >
        {filtered.map((m) => (
          <StaggerItem key={m.userId} className="h-full">
            <MemberCard member={m} unit={m.unitId ? (unitsById.get(m.unitId) ?? null) : null} />
          </StaggerItem>
        ))}
      </Stagger>
    )
  } else {
    body = (
      <div className="flex flex-col gap-8">
        {groups.map((group) => (
          <section key={group.unit?.id ?? 'unassigned'} className="flex flex-col gap-3">
            <h2 className="text-eyebrow uppercase tracking-(--text-eyebrow--letter-spacing) text-muted-foreground">
              {group.unit ? group.label : t('structure.people.unassignedGroup')}
              <span className="ml-1.5 normal-case tracking-normal text-muted-foreground/70">
                ({group.members.length})
              </span>
            </h2>
            <Stagger
              className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
              animateKey={query}
            >
              {group.members.map((m) => (
                <StaggerItem key={m.userId} className="h-full">
                  <MemberCard member={m} unit={group.unit} />
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

      <div className="relative max-w-100">
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

      {hasAnyMembers && units.length > 0 ? (
        <div
          className="flex flex-wrap gap-2"
          role="group"
          aria-label={t('structure.people.filters.label')}
        >
          <FilterChip active={unitFilter === null} onClick={() => setUnitFilter(null)}>
            {t('structure.people.filters.all')}
          </FilterChip>
          {units.map((u) => (
            <FilterChip
              key={u.id}
              active={unitFilter === u.id}
              onClick={() => setUnitFilter((cur) => (cur === u.id ? null : u.id))}
            >
              {u.name}
            </FilterChip>
          ))}
        </div>
      ) : null}

      {body}
    </div>
  )
}
