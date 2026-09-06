// `/people` -- TECH-SPEC EPIC-003: "the People page listing members grouped by unit."
import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { useT } from '@devon/i18n'
import { StateView, Input } from '@devon/ui'
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

  const filtered = membersQuery.data.filter((m) => matchesQuery(m, query))
  const groups = groupByUnit(unitsQuery.data.units, filtered)

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

      {groups.length === 0 ? (
        <StateView kind="empty" titleKey="structure.people.empty.title" />
      ) : (
        <div className="flex flex-col gap-8">
          {groups.map((group) => (
            <section key={group.unit?.id ?? 'unassigned'} className="flex flex-col gap-3">
              <h2 className="text-h4 text-foreground">
                {group.unit ? group.label : t('structure.people.unassignedGroup')}
              </h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {group.members.map((m) => (
                  <MemberCard key={m.userId} member={m} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
