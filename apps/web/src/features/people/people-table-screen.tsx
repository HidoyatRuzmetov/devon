// `/people/table` -- the boshqarma boshlig'i's people table (v1.1 SPEC §4.3), built on the shared
// indicator registry (`@devon/contracts`) and `GET /api/v1/people/indicators`.
//
// This is the skeleton the head-console package extends with saved views, grouping, footers,
// per-column filters and row actions (SPEC §4.3's full list). What it already is, and must stay: a
// real table over real numbers with a column picker driven by the registry rather than a hard-coded
// list, every one of the five screen states, four locales, and readable at 390 px.
//
// Head-only, twice over: the sidebar entry declares `people.table.read`, and the endpoint behind it
// is `{kind:'department_managed'}` on the server. A member who types the URL gets the shared
// no-permission state, not a blank page (PERMISSIONS-AUDIT D12).
import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { useLocale, useT } from '@devon/i18n'
import { INDICATORS, type IndicatorSpec } from '@devon/contracts'
import {
  Avatar,
  Badge,
  Button,
  Checkbox,
  PageContainer,
  PageHeader,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Skeleton,
  Stagger,
  StaggerItem,
  StateView,
  cn,
  initialsFromName,
} from '@devon/ui'
import { Columns3, Users } from 'lucide-react'
import { avatarUrl } from '../../lib/avatar.js'
import { ApiError } from '../../lib/api-client.js'
import { useCan } from '../../lib/can.js'
import { useForcedState } from '../../lib/forced-state.js'
import { ForcedStateBlock } from '../../shell/forced-state-block.js'
import { useOnline } from '../../lib/use-online.js'
import { useDepartment } from '../../lib/session.js'
import { navigate } from '../../lib/router.js'
import { fetchMembers, type Member } from '../structure/api.js'
// v1.1 SPEC §5: "fields appear as columns in the people table". The `fields` feature owns the data
// and the rendering; this screen only asks for the columns and lays them out after the indicators.
// Which person fields appear here is the head's own `showInTable` switch on `/fields`, not a second
// setting hidden in this screen.
import { useFieldColumns, FieldValueDisplay } from '../fields/index.js'
import { fetchIndicators, type PersonIndicators } from './api.js'
import { formatIndicator } from './format.js'

/** SPEC §4.3: "Default columns: Ism, Boʻlim, Vazifalar, Yuklama." Everything else is opt-in through
 * the picker, so the first thing a head sees is four columns wide, not twenty. */
const DEFAULT_COLUMNS = INDICATORS.filter((i) => i.defaultColumn).map((i) => i.id)

const STORAGE_KEY = 'devon.people.table.columns'

function readStoredColumns(): string[] | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return null
    return parsed.filter((id): id is string => typeof id === 'string')
  } catch {
    return null
  }
}

function storeColumns(ids: readonly string[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids))
  } catch {
    // Storage disabled: the choice still holds for this session.
  }
}

function fullName(member: Member): string {
  return `${member.givenName} ${member.familyName}`.trim()
}

/** Three-step colour, DESIGN.md's load scale: comfortable, full, over. Never a raw hex. */
function loadTone(pct: number): string {
  if (pct >= 100) return 'bg-danger'
  if (pct >= 75) return 'bg-warning'
  return 'bg-success'
}

function WorkloadBar({ pct, label }: { pct: number; label: string }): React.JSX.Element {
  return (
    <div className="flex items-center gap-2" title={label}>
      <div className="h-2 w-20 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <div
          className={cn(
            'h-full rounded-full transition-[width] duration-(--dur-page)',
            loadTone(pct),
          )}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
      <span className="tabular-nums text-sm text-muted-foreground">{label}</span>
    </div>
  )
}

export default function PeopleTableScreen(): React.JSX.Element {
  const t = useT()
  const locale = useLocale()
  const forced = useForcedState()
  const online = useOnline()
  const { departmentId } = useDepartment()
  const permission = useCan('people.table.read')

  const [columnIds, setColumnIds] = React.useState<string[]>(
    () => readStoredColumns() ?? [...DEFAULT_COLUMNS],
  )
  const columns: IndicatorSpec[] = React.useMemo(
    () =>
      columnIds
        .map((id) => INDICATORS.find((i) => i.id === id))
        .filter((spec): spec is IndicatorSpec => Boolean(spec)),
    [columnIds],
  )

  const membersQuery = useQuery({
    queryKey: ['structure', 'members', departmentId],
    queryFn: () => fetchMembers(departmentId!),
    enabled: departmentId !== null && permission.allowed,
  })

  // `openCards` always travels with the request: the Vazifalar column is not optional, it is what the
  // head opened this screen for.
  const requestedKeys = React.useMemo(() => [...new Set([...columnIds, 'openCards'])], [columnIds])
  const indicatorsQuery = useQuery({
    queryKey: ['people', 'indicators', departmentId, requestedKeys.join(',')],
    queryFn: () => fetchIndicators(requestedKeys),
    enabled: departmentId !== null && permission.allowed,
  })

  const memberUserIds = React.useMemo(
    () => (membersQuery.data ?? []).map((m) => m.userId),
    [membersQuery.data],
  )
  const fieldColumns = useFieldColumns(memberUserIds)

  function toggleColumn(id: string): void {
    setColumnIds((current) => {
      const next = current.includes(id) ? current.filter((c) => c !== id) : [...current, id]
      storeColumns(next)
      return next
    })
  }

  if (forced) return <ForcedStateBlock kind={forced} />

  if (!permission.allowed) {
    return (
      <StateView
        kind="forbidden"
        titleKey="state.denied.title"
        bodyKey="state.denied.body"
        action={{
          labelKey: 'state.denied.action',
          onAction: () => navigate('/people'),
        }}
      />
    )
  }

  if (!online) {
    return (
      <StateView
        kind="offline"
        titleKey="state.offline.banner"
        bodyKey="state.offline.empty"
        action={{
          labelKey: 'state.error.action',
          onAction: () => window.location.reload(),
        }}
      />
    )
  }

  if (membersQuery.isPending || indicatorsQuery.isPending) {
    return (
      <PageContainer>
        <PageHeader title={t('people.table.title')} description={t('people.table.description')} />
        <div className="mt-6 flex flex-col gap-2" aria-hidden="true">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-12 w-full rounded-md" />
          ))}
        </div>
      </PageContainer>
    )
  }

  const error = membersQuery.error ?? indicatorsQuery.error
  if (error instanceof ApiError && error.code === 'forbidden') {
    return (
      <StateView
        kind="forbidden"
        titleKey="state.denied.title"
        bodyKey="state.denied.body"
        action={{
          labelKey: 'state.denied.action',
          onAction: () => navigate('/people'),
        }}
      />
    )
  }
  if (error) {
    return (
      <StateView
        kind="error"
        titleKey="state.error.title"
        bodyKey="state.error.body"
        action={{
          labelKey: 'state.error.action',
          onAction: () => void indicatorsQuery.refetch(),
        }}
      />
    )
  }

  const members = membersQuery.data ?? []
  const indicators = new Map<string, PersonIndicators>(
    (indicatorsQuery.data?.people ?? []).map((p) => [p.userId, p]),
  )
  const capacity = indicatorsQuery.data?.capacityCards ?? 8

  if (members.length === 0) {
    return (
      <PageContainer>
        <PageHeader title={t('people.table.title')} description={t('people.table.description')} />
        <StateView
          kind="empty"
          titleKey="people.table.empty.title"
          bodyKey="people.table.empty.body"
        />
      </PageContainer>
    )
  }

  const columnPicker = (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="secondary" size="sm">
          <Columns3 aria-hidden="true" className="size-4" />
          {t('people.table.columns.action')}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="max-h-96 w-72 overflow-y-auto">
        <p className="mb-2 text-sm font-medium">{t('people.table.columns.heading')}</p>
        <ul className="flex flex-col gap-1">
          {INDICATORS.map((indicator) => (
            <li
              key={indicator.id}
              className="flex min-h-11 items-center gap-3 rounded-sm px-2 hover:bg-accent"
            >
              <Checkbox
                id={`people-column-${indicator.id}`}
                checked={columnIds.includes(indicator.id)}
                onCheckedChange={() => toggleColumn(indicator.id)}
              />
              <label
                htmlFor={`people-column-${indicator.id}`}
                className="flex cursor-pointer flex-col py-2"
              >
                <span className="text-sm">{t(indicator.labelKey)}</span>
                <span className="text-xs text-muted-foreground">{t(indicator.descriptionKey)}</span>
              </label>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  )

  return (
    <PageContainer>
      <PageHeader
        eyebrow={t('shell.nav.group.manageHead')}
        title={t('people.table.title')}
        description={t('people.table.description')}
        actions={columnPicker}
      />

      {/* Wide tables scroll inside their own container; the page body never scrolls sideways. */}
      <div className="mt-6 overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[36rem] border-collapse text-left text-sm">
          <caption className="sr-only">{t('people.table.caption')}</caption>
          <thead>
            <tr className="border-b border-border bg-muted/40">
              <th scope="col" className="px-4 py-3 font-medium">
                {t('people.table.column.name')}
              </th>
              {columns.map((column) => (
                <th key={column.id} scope="col" className="px-4 py-3 font-medium whitespace-nowrap">
                  <span title={t(column.descriptionKey)}>{t(column.labelKey)}</span>
                </th>
              ))}
              {fieldColumns.columns.map((column) => (
                <th
                  key={column.def.id}
                  scope="col"
                  className="px-4 py-3 font-medium whitespace-nowrap"
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <Stagger as="tbody">
            {members.map((member) => {
              const values = indicators.get(member.userId)?.values ?? {}
              return (
                <StaggerItem
                  as="tr"
                  key={member.userId}
                  className="border-b border-border last:border-0 hover:bg-accent/50"
                >
                  <th scope="row" className="px-4 py-3 font-normal">
                    <span className="flex items-center gap-3">
                      <Avatar
                        size="sm"
                        alt={fullName(member)}
                        hueSeed={member.userId}
                        initials={initialsFromName(member.givenName, member.familyName)}
                        src={avatarUrl(member.avatarKey, 64)}
                      />
                      <span className="flex flex-col">
                        <span className="font-medium">{fullName(member)}</span>
                        {member.title ? (
                          <span className="text-xs text-muted-foreground">{member.title}</span>
                        ) : null}
                      </span>
                      {member.membershipRole === 'head' ? (
                        <Badge variant="subtle">{t('shell.department.role.head')}</Badge>
                      ) : null}
                    </span>
                  </th>
                  {columns.map((column) => (
                    <td key={column.id} className="px-4 py-3 align-middle whitespace-nowrap">
                      {column.id === 'workloadPct' ? (
                        <WorkloadBar
                          pct={Number(values['workloadPct'] ?? 0)}
                          label={t('people.table.workload.value', {
                            open: Number(values['openCards'] ?? 0),
                            capacity,
                          })}
                        />
                      ) : (
                        <span className="tabular-nums">
                          {formatIndicator(column, values[column.id] ?? null, t, locale)}
                        </span>
                      )}
                    </td>
                  ))}
                  {fieldColumns.columns.map((column) => (
                    <td key={column.def.id} className="px-4 py-3 align-middle">
                      <FieldValueDisplay
                        def={column.def}
                        value={column.values.get(member.userId) ?? null}
                      />
                    </td>
                  ))}
                </StaggerItem>
              )
            })}
          </Stagger>
        </table>
      </div>

      <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
        <Users aria-hidden="true" className="size-3.5" />
        {t('people.table.footer', { count: members.length })}
      </p>
    </PageContainer>
  )
}
