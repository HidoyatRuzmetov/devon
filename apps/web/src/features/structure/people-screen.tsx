// `/people` -- TECH-SPEC EPIC-003: "the People page listing members grouped by unit." Rebuilt to
// UI-OVERHAUL.md's Jakob row "People directory" (Slack members, Google Contacts): search first,
// cards grid with avatar/title/unit chip, a hover card, filters by unit, distinct empty/no-results.
import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useT } from '@devon/i18n'
import {
  Avatar,
  Badge,
  Button,
  FilterChip,
  Input,
  SegmentedControl,
  Stagger,
  StaggerItem,
  StateView,
  cn,
  initialsFromName,
  normalizeForSearch,
} from '@devon/ui'
import { Search } from 'lucide-react'
import { useForcedState } from '../../lib/forced-state.js'
import { ForcedStateBlock } from '../../shell/forced-state-block.js'
import { useOnline } from '../../lib/use-online.js'
import { navigate, useSearchParams } from '../../lib/router.js'
import { ApiError } from '../../lib/api-client.js'
import { avatarUrl } from '../../lib/avatar.js'
import { useCan } from '../../lib/can.js'
import { useSession } from '../../lib/session.js'
import { PersonPage } from '../people/person/person-page.js'
import { personIdFromSearch, personPath } from '../people/routes.js'
import { fetchMembers, fetchUnitsOverview, type Member, type Unit } from './api.js'
import { useMyDepartments } from './use-my-departments.js'
import { DepartmentHeader } from './department-header.js'
import { MemberCard, formalName, fullName } from './member-card.js'
import { fetchPeopleContacts } from '../people/api.js'
import { useCsrfToken } from '../people/hooks.js'
import {
  QuickAssignSheet,
  type QuickAssignSubmit,
} from '../people/components/quick-assign-sheet.js'
import { createCard } from '../work/api.js'

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
  const [unitFilter, setUnitFilter] = React.useState<string | null>(null)
  // ui-blitz round3 #23: the hover card's "copy link" action writes `?member=<userId>` -- this reads
  // it back, drops any unit filter that would hide that member, and scrolls/highlights their card
  // once the directory has loaded. `consumedRef` makes this a one-shot effect (the param stays in the
  // URL after landing, so a later re-render must not keep re-scrolling/re-clearing the filter).
  const search = useSearchParams()
  const session = useSession()
  const canSeeAnyPerson = useCan('people.person.read')
  const personId = personIdFromSearch(search)
  // SPEC §4.1: a member gets the directory; SPEC §6: the only person page they may open is their
  // own. `useCan` hides the link; the server refuses it regardless (`{kind:'department_managed'}`).
  const profileHrefFor = React.useCallback(
    (userId: string): string | undefined => {
      if (canSeeAnyPerson.allowed) return personPath(userId)
      return userId === session.user?.id ? '/people/me' : undefined
    },
    [canSeeAnyPerson.allowed, session.user?.id],
  )
  /**
   * v1.1 critique SEV2 #15 -- "a member still cannot do anything with a colleague".
   *
   * SPEC §4.1 asks the directory for four actions on every card: a hover card, a Telegram deep link
   * where the head's setting allows one, "open board column", and "assign a task ... for anyone,
   * since any member may create a card for a colleague". The first and third existed. These are the
   * other two.
   *
   * `QuickAssignSheet` is the people module's own composer, already used by the table's row action
   * -- the same sheet, the same one-card-per-person rule, reached from the screen a xodim actually
   * has. Telegram handles stay head-only (`GET /people/contacts`, PERMISSIONS-AUDIT §4.13): the
   * query is gated on the same capability, so for a member it is never issued and the button simply
   * is not there.
   */
  const csrf = useCsrfToken()
  const queryClient = useQueryClient()
  const canSeeContacts = useCan('people.table.read')
  const [assignTarget, setAssignTarget] = React.useState<Member | null>(null)

  const contactsQuery = useQuery({
    queryKey: ['people', 'contacts', departmentId],
    queryFn: fetchPeopleContacts,
    enabled: departmentId !== null && canSeeContacts.allowed,
  })
  const telegramByUser = React.useMemo(() => {
    const out = new Map<string, string>()
    for (const contact of contactsQuery.data ?? []) {
      if (contact.telegramDeepLink) out.set(contact.userId, contact.telegramDeepLink)
    }
    return out
  }, [contactsQuery.data])

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

  const [layout, setLayout] = React.useState<'cards' | 'table'>('cards')
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
    setUnitFilter((cur) => (cur !== null && cur !== member.unitId ? null : cur))
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

  // The `person` search param on `/people` is the person page (SPEC §6). The exact-path router this shell ships means
  // a detail view is a search param, exactly like `/work?card=` and `/events?event=` -- see
  // `features/people/routes.ts` for why, and for the one place that changes when a param-bearing
  // router lands.
  if (personId) {
    if (!canSeeAnyPerson.allowed && personId !== session.user?.id) {
      return (
        <StateView
          kind="forbidden"
          titleKey="people.person.denied.title"
          bodyKey="people.person.denied.body"
          action={{
            labelKey: 'people.person.denied.action',
            onAction: () => navigate('/people/me'),
          }}
        />
      )
    }
    return (
      <div className="flex flex-col gap-4">
        <PersonPage userId={personId} onBack={() => navigate('/people')} />
      </div>
    )
  }

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
  } else if (layout === 'table') {
    // SPEC §4.1: "cards or a simple table (name, boʻlim, unit role, title)". Deliberately the four
    // directory facts and nothing else -- every indicator column is head-only and lives on
    // `/people/table`, which a member cannot open at all.
    body = (
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[32rem] border-collapse text-left text-small">
          <caption className="sr-only">{t('structure.people.table.caption')}</caption>
          <thead>
            <tr className="border-b border-border bg-muted/40">
              <th scope="col" className="px-3 py-2 font-medium">
                {t('structure.people.table.name')}
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                {t('structure.people.table.unit')}
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                {t('structure.people.table.unitRole')}
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                {t('structure.people.table.title')}
              </th>
            </tr>
          </thead>
          <Stagger as="tbody" animateKey={`${query}:${unitFilter ?? ''}`}>
            {filtered.map((m) => {
              const href = profileHrefFor(m.userId)
              const unitName = m.unitId ? (unitsById.get(m.unitId)?.name ?? null) : null
              return (
                <StaggerItem
                  as="tr"
                  key={m.userId}
                  className="border-b border-border last:border-0 hover:bg-accent/50"
                >
                  <th scope="row" className="px-3 py-2 font-normal">
                    <DirectoryName member={m} href={href} />
                  </th>
                  <td className="px-3 py-2">
                    {unitName ??
                      t(
                        m.membershipRole === 'head'
                          ? 'headScope.departmentWide'
                          : 'structure.people.unassignedGroup',
                      )}
                  </td>
                  <td className="px-3 py-2">
                    {m.unitRole ? (
                      <Badge tone={m.unitRole === 'head' ? 'info' : 'neutral'}>
                        {t(`structure.roles.roleLabel.${m.unitRole}`)}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">
                        {t('structure.people.table.noRole')}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {m.title ?? (
                      <span className="text-muted-foreground">
                        {t('structure.people.table.noTitle')}
                      </span>
                    )}
                  </td>
                </StaggerItem>
              )
            })}
          </Stagger>
        </table>
      </div>
    )
  } else if (unitFilter !== null) {
    body = (
      <Stagger
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
        animateKey={`${unitFilter}:${query}`}
      >
        {filtered.map((m) => (
          <StaggerItem key={m.userId} className="h-full">
            {/* Already filtered to exactly this unit (the filter chip bar above names it) -- no
                `onFilterByUnit` here, since re-applying the same filter would be a no-op action. */}
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
                unit={m.unitId ? (unitsById.get(m.unitId) ?? null) : null}
                profileHref={profileHrefFor(m.userId)}
                onAssign={m.userId === session.user?.id ? undefined : () => setAssignTarget(m)}
                telegramDeepLink={telegramByUser.get(m.userId)}
              />
            </div>
          </StaggerItem>
        ))}
      </Stagger>
    )
  } else {
    body = (
      <div className="flex flex-col gap-8">
        {groups.map((group) => (
          <section key={group.unit?.id ?? group.scope} className="flex flex-col gap-3">
            <h2 className="text-eyebrow uppercase tracking-(--text-eyebrow--letter-spacing) text-muted-foreground">
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
                      unit={m.unitId ? (unitsById.get(m.unitId) ?? null) : null}
                      onFilterByUnit={m.unitId ? setUnitFilter : undefined}
                      profileHref={profileHrefFor(m.userId)}
                      onAssign={
                        m.userId === session.user?.id ? undefined : () => setAssignTarget(m)
                      }
                      telegramDeepLink={telegramByUser.get(m.userId)}
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
        <SegmentedControl
          size="sm"
          label={t('structure.people.layout.label')}
          value={layout}
          onValueChange={setLayout}
          options={[
            { value: 'cards', label: t('structure.people.layout.cards') },
            { value: 'table', label: t('structure.people.layout.table') },
          ]}
        />
        {canSeeAnyPerson.allowed ? (
          <Button variant="secondary" size="sm" onClick={() => navigate('/people/table')}>
            {t('structure.people.openTable')}
          </Button>
        ) : null}
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

/** The directory table's name cell: avatar + name, a link to the person page when the viewer may
 * open it, plain text when they may not (never a link that answers 403). */
function DirectoryName({
  member,
  href,
}: {
  member: Member
  href: string | undefined
}): React.JSX.Element {
  const content = (
    <span className="flex items-center gap-2.5">
      <Avatar
        size="sm"
        alt={fullName(member)}
        hueSeed={member.unitId ?? member.userId}
        initials={initialsFromName(member.givenName, member.familyName)}
        src={avatarUrl(member.avatarKey, 64)}
      />
      <span className="truncate font-medium">{fullName(member)}</span>
    </span>
  )
  if (!href) return content
  return (
    <a
      href={href}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
        event.preventDefault()
        navigate(href)
      }}
      className="rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {content}
    </a>
  )
}
