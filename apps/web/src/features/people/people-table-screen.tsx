// `/people/table` -- the boshqarma boshligʻi's people table (v1.1 SPEC §4.3).
//
// TanStack Table drives the column model (visibility, order, per-column sort and filter, the global
// search) and TanStack Virtual draws the rows, because a boshqarma of 200 people is a real number
// and a table that renders all of them is a table nobody scrolls twice. Grouping, the footer
// calculations and the 390 px card fallback are this screen's own, layered on the row model the
// table hands back -- a group header is a row in a list, not a table feature we need a plugin for.
//
// Head-only, twice over: the sidebar entry declares `people.table.read`, and every endpoint behind it
// is `{kind:'department_managed'}` on the server. A member who types the URL gets the shared
// no-permission state, not a blank page (PERMISSIONS-AUDIT D12).
import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnFiltersState,
  type SortingState,
} from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
import { formatNumber, useLocale, useT } from '@devon/i18n'
import {
  DEFAULT_PEOPLE_VIEW_CONFIG,
  INDICATORS,
  PEOPLE_VIEW_CAPS,
  PEOPLE_VIEW_URL_PARAM,
  decodePeopleViewConfig,
  encodePeopleViewConfig,
  normalizePeopleViewConfig,
  samePeopleViewConfig,
  type PeopleColumnFilter,
  type PeopleView,
  type PeopleViewConfig,
} from '@devon/contracts'
import {
  Avatar,
  Badge,
  Button,
  Checkbox,
  Input,
  PageContainer,
  PageHeader,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Reveal,
  SegmentedControl,
  Select,
  Skeleton,
  Stagger,
  StaggerItem,
  StateView,
  cn,
  initialsFromName,
  normalizeForSearch,
  toast,
} from '@devon/ui'
import {
  BellRing,
  Download,
  MoreVertical,
  Search,
  Send,
  Table2,
  UserPlus,
  Users,
} from 'lucide-react'
import { avatarUrl } from '../../lib/avatar.js'
import { ApiError } from '../../lib/api-client.js'
import { useCan } from '../../lib/can.js'
import { useForcedState } from '../../lib/forced-state.js'
import { ForcedStateBlock } from '../../shell/forced-state-block.js'
import { useMediaQuery } from '../../lib/use-media-query.js'
import { useOnline } from '../../lib/use-online.js'
import { useViewportBoundedHeight } from '../../lib/use-viewport-bounded-height.js'
import { useDepartment } from '../../lib/session.js'
import { navigate, replaceSearchParam, useSearchParams } from '../../lib/router.js'
import { fetchMembers, type Member } from '../structure/api.js'
import { createCard, fetchBoard, type Card } from '../work/api.js'
// v1.1 SPEC §5: "fields appear as columns in the people table". The `fields` feature owns the data;
// this screen asks for it and then treats every one of those fields as an ordinary column.
//
// v1.1 critique SEV2 #7: a field column used to be a second-class citizen rendered after the
// indicators -- no picker entry, no sort, no filter, no resize handle, no footer figure. It is now
// a `TableColumnSpec` like any other (`column-spec.ts`), which is what gives it all five.
import { useFieldColumns } from '../fields/index.js'
import { notifyMany } from '../fields/api.js'
import {
  columnLabel,
  fieldColumnId,
  fieldColumnSpec,
  indicatorColumnSpec,
  type TableColumnSpec,
} from './column-spec.js'
import { fetchIndicators, fetchPeopleContacts, peopleExportUrl } from './api.js'
import {
  useCreateViewMutation,
  useCsrfToken,
  useDeleteViewMutation,
  usePatchViewMutation,
  usePeopleViewsQuery,
  pickInitialView,
} from './hooks.js'
import { formatIndicator } from './format.js'
import { ColumnPicker } from './components/column-picker.js'
import { ColumnHeader } from './components/column-header.js'
import { ViewTabs } from './components/view-tabs.js'
import { QuickAssignSheet, type QuickAssignSubmit } from './components/quick-assign-sheet.js'
import {
  calculate,
  compareCells,
  defaultCalculation,
  matchesFilter,
  type CellValue,
} from './table-model.js'
import { boardColumnPath, personPath } from './routes.js'

type PersonRow = {
  member: Member
  values: Record<string, CellValue>
  cards: Card[]
}

const NAME_COLUMN = 'name'
const TASKS_COLUMN = 'tasks'

function fullName(member: Member): string {
  return `${member.givenName} ${member.familyName}`.trim()
}

/** Three-step colour, DESIGN.md's load scale: comfortable, full, over. Never a raw hex. */
function loadTone(pct: number): string {
  if (pct >= 100) return 'bg-destructive'
  if (pct >= 75) return 'bg-warning'
  return 'bg-primary'
}

/**
 * What the Yuklama bar says next to itself (SPEC §4.3: "bar: hours vs capacity, or open count when
 * estimates are off").
 *
 * The department is the unit of choice here, not the person: `workloadHours` is `null` for anyone
 * whose open cards carry no estimate at all, which is what a department that does not estimate looks
 * like -- and in that world an hours label would be an invented number. Where estimates exist, hours
 * is the honest reading, because two cards are not two equal days.
 */
function workloadLabel(
  values: Record<string, CellValue>,
  capacityCards: number,
  t: Translate,
  locale: ReturnType<typeof useLocale>,
): string {
  const hours = values['workloadHours']
  if (typeof hours === 'number') {
    return t('people.table.workload.hours', {
      hours: formatNumber(hours, locale),
      pct: formatNumber(Number(values['workloadPct'] ?? 0), locale),
    })
  }
  return t('people.table.workload.value', {
    open: Number(values['openCards'] ?? 0),
    capacity: capacityCards,
  })
}

function WorkloadBar({ pct, label }: { pct: number; label: string }): React.JSX.Element {
  return (
    <span className="flex items-center gap-2" title={label}>
      <span className="h-2 w-20 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <span
          className={cn(
            'block h-full rounded-full transition-[width] duration-(--dur-page) ease-(--ease-standard)',
            loadTone(pct),
          )}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </span>
      <span className="tabular-nums text-small text-muted-foreground">{label}</span>
    </span>
  )
}

export default function PeopleTableScreen(): React.JSX.Element {
  const t = useT()
  const locale = useLocale()
  const forced = useForcedState()
  const online = useOnline()
  const queryClient = useQueryClient()
  const csrf = useCsrfToken()
  const { departmentId } = useDepartment()
  const permission = useCan('people.table.read')
  const canExport = useCan('people.export')
  const canAssign = useCan('people.assignTask')
  const narrow = useMediaQuery('(max-width: 767px)')
  const search = useSearchParams()

  // --- the view being looked at ------------------------------------------------------------------
  const viewsQuery = usePeopleViewsQuery(permission.allowed)
  const createView = useCreateViewMutation()
  const patchView = usePatchViewMutation()
  const deleteView = useDeleteViewMutation()

  const [activeViewId, setActiveViewId] = React.useState<string | null>(null)
  const [config, setConfig] = React.useState<PeopleViewConfig>(
    () => decodePeopleViewConfig(search.get(PEOPLE_VIEW_URL_PARAM)) ?? DEFAULT_PEOPLE_VIEW_CONFIG,
  )
  const adoptedRef = React.useRef(false)

  // The department's default view is the table's starting point -- unless the URL already carries
  // one, which is what makes a shared link land on exactly the table the sender was looking at.
  React.useEffect(() => {
    if (adoptedRef.current) return
    if (!viewsQuery.data) return
    adoptedRef.current = true
    if (search.get(PEOPLE_VIEW_URL_PARAM)) return
    const initial = pickInitialView(viewsQuery.data)
    if (!initial) return
    setActiveViewId(initial.id)
    setConfig(initial.config)
  }, [viewsQuery.data, search])

  // The URL is the state (DESIGN.md §8). `replaceSearchParam` never grows the back stack, so
  // toggling a column does not cost the head five presses of Back to leave the screen.
  React.useEffect(() => {
    replaceSearchParam(
      PEOPLE_VIEW_URL_PARAM,
      samePeopleViewConfig(config, DEFAULT_PEOPLE_VIEW_CONFIG)
        ? null
        : encodePeopleViewConfig(config),
    )
  }, [config])

  const activeView = viewsQuery.data?.find((v) => v.id === activeViewId) ?? null
  const dirty = activeView ? !samePeopleViewConfig(activeView.config, config) : false

  function patchConfig(patch: Partial<PeopleViewConfig>): void {
    setConfig((current) => normalizePeopleViewConfig({ ...current, ...patch }))
  }

  // --- data ---------------------------------------------------------------------------------------
  //
  // v1.1 critique SEV2 #7: one list of columns, not two. A registry indicator and a person custom
  // field are both `TableColumnSpec`s from here down, which is what gives a field column the sort,
  // the filter, the resize handle and the footer calculation it did not have.

  // `workloadHours` rides along with `workloadPct` (HANDOFFS #5): the bar's own label is hours where
  // the department estimates and an open-card count where it does not, and it cannot tell the two
  // apart without the hours figure. Same source, same query -- no extra statement.
  const requestedKeys = React.useMemo(
    () => [
      ...new Set([
        // A `field:` id is not an indicator key, so it never goes to the indicators endpoint.
        ...config.columns.filter((id) => !id.startsWith('field:')),
        'openCards',
        'workloadPct',
        'workloadHours',
        'unit',
        'unitRole',
      ]),
    ],
    [config.columns],
  )

  const membersQuery = useQuery({
    queryKey: ['structure', 'members', departmentId],
    queryFn: () => fetchMembers(departmentId!),
    enabled: departmentId !== null && permission.allowed,
  })
  const indicatorsQuery = useQuery({
    queryKey: ['people', 'indicators', departmentId, requestedKeys.join(',')],
    queryFn: () => fetchIndicators(requestedKeys),
    enabled: departmentId !== null && permission.allowed,
  })
  // The Vazifalar column shows real card titles as chips, so it needs the board -- one request that
  // already groups every open card by the person it belongs to.
  const boardQuery = useQuery({
    queryKey: ['work', 'board'],
    queryFn: fetchBoard,
    enabled: departmentId !== null && permission.allowed,
  })
  // One request for every row's Telegram deep link, so the "message" row action is a real message
  // (SPEC §4.3). Head-only on the server; a person who never linked simply has no button.
  const contactsQuery = useQuery({
    queryKey: ['people', 'contacts', departmentId],
    queryFn: fetchPeopleContacts,
    enabled: departmentId !== null && permission.allowed,
  })

  // The head's own person fields ride beside the indicator columns. One request for the whole
  // cohort, never one per row (I-14).
  const memberUserIds = React.useMemo(
    () => (membersQuery.data ?? []).map((m) => m.userId),
    [membersQuery.data],
  )
  const fieldColumns = useFieldColumns(memberUserIds)

  /**
   * SEV2 #7. Every person field the head marked `showInTable`, as a column of the same kind as an
   * indicator, plus a `userId -> value` lookup so the row cells and the footer read from one place.
   *
   * The picker offers all of them; `config.columns` decides which are on. A field the head has not
   * chosen is simply not rendered -- which is the whole point: before this, a `showInTable` field
   * was a column that could not be turned off.
   */
  const fieldSpecs = React.useMemo(
    () => fieldColumns.columns.map((column) => fieldColumnSpec(column.def, locale)),
    [fieldColumns.columns, locale],
  )
  const fieldValuesByColumnId = React.useMemo(() => {
    const out = new Map<string, ReadonlyMap<string, CellValue>>()
    for (const column of fieldColumns.columns) {
      out.set(fieldColumnId(column.def.key), column.values as ReadonlyMap<string, CellValue>)
    }
    return out
  }, [fieldColumns.columns])
  /** `field:<key>` -> the definition id, for "ask to fill" from the column header menu. */
  const fieldDefIdByColumnId = React.useMemo(() => {
    const out = new Map<string, string>()
    for (const column of fieldColumns.columns) out.set(fieldColumnId(column.def.key), column.def.id)
    return out
  }, [fieldColumns.columns])

  /** Everything the picker may offer, registry first then the department's own. */
  const availableColumns = React.useMemo<TableColumnSpec[]>(
    () => [...INDICATORS.map(indicatorColumnSpec), ...fieldSpecs],
    [fieldSpecs],
  )

  /** The chosen columns, in the head's own order, whichever kind each one is. */
  const columnSpecs = React.useMemo<TableColumnSpec[]>(() => {
    const byId = new Map(availableColumns.map((column) => [column.id, column]))
    return config.columns
      .map((id) => byId.get(id))
      .filter((column): column is TableColumnSpec => Boolean(column))
  }, [availableColumns, config.columns])

  // SEV2 #6: the head asks a cohort to fill their fields, from the row menu, the bulk bar or a
  // column header. One mutation, three scopes.
  const askToFill = useMutation({
    mutationFn: (scope: { defIds?: readonly string[]; userIds?: readonly string[] }) =>
      notifyMany(scope, csrf),
    onSuccess: (result) => {
      toast.success(
        result.asked > 0
          ? t('people.table.askToFill.asked', { people: result.asked })
          : result.reminded > 0
            ? t('people.table.askToFill.reminded', { people: result.reminded })
            : t('people.table.askToFill.nothingToAsk'),
      )
      void queryClient.invalidateQueries({ queryKey: ['fields'] })
    },
    onError: () => toast.error(t('people.table.askToFill.failed')),
  })

  // --- row actions --------------------------------------------------------------------------------
  const [assignTargets, setAssignTargets] = React.useState<readonly PersonRow[]>([])
  const [selection, setSelection] = React.useState<readonly string[]>([])

  const assignMutation = useMutation({
    // One card per person: the bulk bar gives the same task to several desks, and each desk gets its
    // own card with its own history, never one card shared between people (a shared card has no
    // owner, which is the bug the board's giver/assignee pair exists to prevent).
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
      void queryClient.invalidateQueries({ queryKey: ['people', 'indicators'] })
    },
  })

  if (forced) return <ForcedStateBlock kind={forced} />

  if (!permission.allowed) {
    return (
      <StateView
        kind="forbidden"
        titleKey="state.denied.title"
        bodyKey="people.table.denied.body"
        action={{ labelKey: 'people.table.denied.action', onAction: () => navigate('/people') }}
      />
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

  if (membersQuery.isPending || indicatorsQuery.isPending) {
    return (
      <PageContainer>
        <PageHeader
          eyebrow={t('shell.nav.group.manageHead')}
          title={t('people.table.title')}
          description={t('people.table.description')}
        />
        <div className="mt-6 flex flex-col gap-2" aria-hidden="true">
          <Skeleton className="h-9 w-64 rounded-sm" />
          {Array.from({ length: 8 }).map((_, index) => (
            <Skeleton key={index} className="h-11 w-full rounded-sm" />
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
        bodyKey="people.table.denied.body"
        action={{ labelKey: 'people.table.denied.action', onAction: () => navigate('/people') }}
      />
    )
  }
  if (error) {
    return (
      <StateView
        kind="error"
        titleKey="state.error.title"
        bodyKey="state.error.body"
        action={{ labelKey: 'state.error.action', onAction: () => void indicatorsQuery.refetch() }}
      />
    )
  }

  const members = membersQuery.data ?? []
  const indicatorValues = new Map(
    (indicatorsQuery.data?.people ?? []).map((p) => [p.userId, p.values]),
  )
  const capacity = indicatorsQuery.data?.capacityCards ?? 8
  const cardsByUser = new Map<string, Card[]>(
    (boardQuery.data?.columns ?? []).map((column) => [column.member.userId, column.cards]),
  )
  const telegramByUser = new Map<string, string>(
    (contactsQuery.data ?? [])
      .filter((contact): contact is typeof contact & { telegramDeepLink: string } =>
        Boolean(contact.telegramDeepLink),
      )
      .map((contact) => [contact.userId, contact.telegramDeepLink]),
  )

  const rows: PersonRow[] = members.map((member) => {
    // SEV2 #7: a field's answer lives in the same `values` bag as an indicator's, under its
    // `field:<key>` id, so sorting, filtering, the footer and the CSV all reach it the same way.
    const values: Record<string, CellValue> = {
      ...((indicatorValues.get(member.userId) ?? {}) as Record<string, CellValue>),
    }
    for (const [columnId, byUser] of fieldValuesByColumnId) {
      values[columnId] = (byUser.get(member.userId) ?? null) as CellValue
    }
    return {
      member,
      values,
      cards: (cardsByUser.get(member.userId) ?? []).filter((card) => card.status === 'active'),
    }
  })

  return (
    <PeopleTable
      rows={rows}
      specs={columnSpecs}
      availableColumns={availableColumns}
      fieldDefIdByColumnId={fieldDefIdByColumnId}
      onAskToFill={(scope) => askToFill.mutate(scope)}
      askPending={askToFill.isPending}
      config={config}
      patchConfig={patchConfig}
      capacity={capacity}
      locale={locale}
      t={t}
      narrow={narrow}
      views={viewsQuery.data ?? []}
      activeView={activeView}
      activeViewId={activeViewId}
      dirty={dirty}
      busy={createView.isPending || patchView.isPending || deleteView.isPending}
      canExport={canExport.allowed}
      canAssign={canAssign.allowed}
      selection={selection}
      setSelection={setSelection}
      telegramByUser={telegramByUser}
      assignTargets={assignTargets}
      setAssignTargets={setAssignTargets}
      assignPending={assignMutation.isPending}
      onAssign={async (input) => {
        await assignMutation.mutateAsync(input)
      }}
      onSelectView={(view) => {
        setActiveViewId(view?.id ?? null)
        setConfig(view ? view.config : DEFAULT_PEOPLE_VIEW_CONFIG)
      }}
      onRevert={() => {
        if (activeView) setConfig(activeView.config)
      }}
      onSaveOver={(view) => {
        patchView.mutate(
          { id: view.id, input: { config, version: view.version } },
          { onSuccess: () => toast.success(t('people.table.views.saved', { name: view.name })) },
        )
      }}
      onSaveAs={async (input) => {
        const view = await createView.mutateAsync({ ...input, config })
        setActiveViewId(view.id)
        toast.success(t('people.table.views.saved', { name: view.name }))
      }}
      onMakeDefault={(view) =>
        patchView.mutate({
          id: view.id,
          input: { makeDepartmentDefault: !view.isDepartmentDefault, version: view.version },
        })
      }
      onToggleShared={(view) =>
        patchView.mutate({ id: view.id, input: { shared: !view.shared, version: view.version } })
      }
      onDelete={(view) =>
        deleteView.mutate(view.id, {
          onSuccess: () => {
            if (activeViewId === view.id) {
              setActiveViewId(null)
              setConfig(DEFAULT_PEOPLE_VIEW_CONFIG)
            }
            toast.success(t('people.table.views.deleted', { name: view.name }))
          },
        })
      }
    />
  )
}

type Translate = (key: string, vars?: Record<string, string | number>) => string

type PeopleTableProps = {
  rows: PersonRow[]
  /** SEV2 #7: the chosen columns, registry indicators and person custom fields alike. */
  specs: TableColumnSpec[]
  /** Everything the picker may offer. */
  availableColumns: readonly TableColumnSpec[]
  /** `field:<key>` -> definition id, for the column header's "ask to fill". */
  fieldDefIdByColumnId: ReadonlyMap<string, string>
  onAskToFill: (scope: { defIds?: readonly string[]; userIds?: readonly string[] }) => void
  askPending: boolean
  config: PeopleViewConfig
  patchConfig: (patch: Partial<PeopleViewConfig>) => void
  capacity: number
  locale: ReturnType<typeof useLocale>
  t: Translate
  narrow: boolean
  views: readonly PeopleView[]
  activeView: PeopleView | null
  activeViewId: string | null
  dirty: boolean
  busy: boolean
  canExport: boolean
  canAssign: boolean
  selection: readonly string[]
  setSelection: (next: readonly string[]) => void
  /** `userId` -> `tg://user?id=…`, only for the colleagues who have linked Telegram. */
  telegramByUser: Map<string, string>
  assignTargets: readonly PersonRow[]
  setAssignTargets: (next: readonly PersonRow[]) => void
  assignPending: boolean
  onAssign(input: QuickAssignSubmit): Promise<void>
  onSelectView: (view: PeopleView | null) => void
  onRevert: () => void
  onSaveOver: (view: PeopleView) => void
  onSaveAs: (input: {
    name: string
    shared: boolean
    makeDepartmentDefault: boolean
  }) => Promise<void>
  onMakeDefault: (view: PeopleView) => void
  onToggleShared: (view: PeopleView) => void
  onDelete: (view: PeopleView) => void
}

function PeopleTable(props: PeopleTableProps): React.JSX.Element {
  const {
    rows,
    specs,
    availableColumns,
    fieldDefIdByColumnId,
    onAskToFill,
    askPending,
    config,
    patchConfig,
    capacity,
    locale,
    t,
    narrow,
    canExport,
    canAssign,
    selection,
    setSelection,
  } = props

  const scrollRef = React.useRef<HTMLDivElement>(null)
  // SEV2 #19: the scroller takes whatever is left of the viewport under whatever chrome happens to
  // be above it, measured rather than guessed at with a fixed `calc(100vh-22rem)`.
  const [heightRef, scrollerHeight] = useViewportBoundedHeight<HTMLDivElement>(320)

  const columns = React.useMemo<ColumnDef<PersonRow>[]>(() => {
    const name: ColumnDef<PersonRow> = {
      id: NAME_COLUMN,
      accessorFn: (row) => fullName(row.member),
      enableSorting: true,
      sortingFn: (a, b) =>
        normalizeForSearch(fullName(a.original.member)).localeCompare(
          normalizeForSearch(fullName(b.original.member)),
        ),
    }
    const tasks: ColumnDef<PersonRow> = {
      id: TASKS_COLUMN,
      accessorFn: (row) => row.cards.length,
      enableSorting: true,
      sortingFn: (a, b) => a.original.cards.length - b.original.cards.length,
    }
    const dynamic: ColumnDef<PersonRow>[] = specs.map((spec) => ({
      id: spec.id,
      accessorFn: (row) => (row.values[spec.id] ?? null) as CellValue,
      enableSorting: true,
      sortingFn: (a, b) =>
        compareCells(
          spec,
          a.original.values[spec.id] ?? null,
          b.original.values[spec.id] ?? null,
          false,
        ),
      filterFn: (row, _columnId, value) =>
        matchesFilter(spec, row.original.values[spec.id] ?? null, value as PeopleColumnFilter),
    }))
    return [name, tasks, ...dynamic]
  }, [specs])

  const sorting: SortingState = config.sort
    ? [{ id: config.sort.columnId, desc: config.sort.desc }]
    : []
  const columnFilters: ColumnFiltersState = config.filters.map((filter) => ({
    id: filter.columnId,
    value: filter,
  }))

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting, columnFilters, globalFilter: config.search },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    globalFilterFn: (row, _columnId, filterValue) => {
      const query = normalizeForSearch(String(filterValue ?? ''))
      if (!query) return true
      const haystack = [
        fullName(row.original.member),
        row.original.member.title ?? '',
        String(row.original.values['unit'] ?? ''),
        row.original.member.membershipRole === 'head' ? t('headScope.departmentWide') : '',
      ].join(' ')
      return normalizeForSearch(haystack).includes(query)
    },
    onSortingChange: (updater) => {
      const next = typeof updater === 'function' ? updater(sorting) : updater
      const first = next[0]
      patchConfig({ sort: first ? { columnId: first.id, desc: first.desc } : null })
    },
    manualPagination: true,
  })

  const modelRows = table.getRowModel().rows

  // --- grouping (SPEC §4.3: "group by bo'lim (default) or unit role") -----------------------------
  type RenderRow =
    | { kind: 'group'; key: string; label: string; count: number }
    | { kind: 'person'; key: string; row: PersonRow }

  const renderRows: RenderRow[] = React.useMemo(() => {
    const people = modelRows.map((r) => r.original)
    if (config.groupBy === 'none') {
      return people.map((row) => ({ kind: 'person' as const, key: row.member.userId, row }))
    }
    const keyOf = (row: PersonRow): string => {
      if (config.groupBy === 'unit') {
        if (row.member.membershipRole === 'head') return 'department-head'
        return row.member.unitId ? `unit:${row.member.unitId}` : ''
      }
      const raw = row.values['unitRole'] as string | null
      return raw && String(raw).length > 0 ? String(raw) : ''
    }
    const groups = new Map<string, PersonRow[]>()
    for (const row of people) {
      const key = keyOf(row)
      groups.set(key, [...(groups.get(key) ?? []), row])
    }
    const ordered = [...groups.entries()].sort((a, b) => {
      if (a[0] === 'department-head') return -1
      if (b[0] === 'department-head') return 1
      if (a[0] === '') return 1
      if (b[0] === '') return -1
      const label = (entry: [string, PersonRow[]]) =>
        config.groupBy === 'unit' ? String(entry[1][0]?.values['unit'] ?? '') : entry[0]
      return label(a).localeCompare(label(b)) || a[0].localeCompare(b[0])
    })
    const out: RenderRow[] = []
    for (const [key, people2] of ordered) {
      out.push({
        kind: 'group',
        key: `group:${key}`,
        label:
          config.groupBy === 'unit' && key === 'department-head'
            ? t('headScope.leadership')
            : key === ''
              ? t('people.table.group.none')
              : config.groupBy === 'unitRole'
                ? t(`people.table.unitRole.${key}`)
                : String(people2[0]?.values['unit'] ?? ''),
        count: people2.length,
      })
      for (const row of people2) out.push({ kind: 'person', key: row.member.userId, row })
    }
    return out
  }, [modelRows, config.groupBy, t])

  const rowHeight = config.density === 'compact' ? 36 : 44
  // The mobile cards scroll with the page, not the desktop table's absent scroll element.
  const virtualise = !narrow && renderRows.length > 60
  const virtualizer = useVirtualizer({
    count: renderRows.length,
    getScrollElement: () => scrollRef.current,
    enabled: virtualise,
    getItemKey: (index) => renderRows[index]!.key,
    // Measured row heights update spacer geometry; schedule the write after the observer delivery.
    useAnimationFrameWithResizeObserver: true,
    // Enabling/measuring rows during a React layout pass must not synchronously flush React
    // again. Normal scheduled updates retain the measured range without lifecycle warnings.
    useFlushSync: false,
    estimateSize: (index) => (renderRows[index]?.kind === 'group' ? 32 : rowHeight),
    overscan: 12,
  })
  // Virtualise only when it earns its keep: below this a plain table renders faster than the
  // measurement pass, keeps Ctrl+F working and prints correctly.
  const virtualItems = virtualizer.getVirtualItems()
  const paddingTop = virtualise && virtualItems.length > 0 ? (virtualItems[0]?.start ?? 0) : 0
  const paddingBottom =
    virtualise && virtualItems.length > 0
      ? virtualizer.getTotalSize() - (virtualItems[virtualItems.length - 1]?.end ?? 0)
      : 0
  const visible: RenderRow[] = virtualise
    ? virtualItems.map((item) => renderRows[item.index]!).filter(Boolean)
    : renderRows

  const allSelected = rows.length > 0 && selection.length === rows.length
  // Deduped: `openCards` is both a default column and the one figure the export always carries, and
  // without this the CSV grew a second identical column whenever the head kept the default view.
  const exportUrl = peopleExportUrl(
    [...new Set([...config.columns, 'openCards'])],
    selection.length > 0 ? selection : [],
  )

  /**
   * SEV2 #6: which of this person's custom fields are still empty, as definition ids. Read off the
   * cells the table already holds -- no extra request, and it can only ever name a field this head
   * has chosen to look at.
   */
  function missingFieldsFor(row: PersonRow): string[] {
    const out: string[] = []
    for (const spec of specs) {
      const defId = fieldDefIdByColumnId.get(spec.id)
      if (!defId) continue
      const value = row.values[spec.id]
      const empty =
        value === null ||
        value === undefined ||
        value === '' ||
        (Array.isArray(value) && value.length === 0)
      if (empty) out.push(defId)
    }
    return out
  }

  function toggleSelection(userId: string): void {
    setSelection(
      selection.includes(userId) ? selection.filter((id) => id !== userId) : [...selection, userId],
    )
  }

  function sortStateOf(columnId: string): 'asc' | 'desc' | null {
    if (config.sort?.columnId !== columnId) return null
    return config.sort.desc ? 'desc' : 'asc'
  }

  function toggleSort(columnId: string): void {
    if (config.sort?.columnId !== columnId) {
      patchConfig({ sort: { columnId, desc: false } })
      return
    }
    patchConfig(config.sort.desc ? { sort: null } : { sort: { columnId, desc: true } })
  }

  const actions = (
    <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
      {/* SEV2 #19: the search moved up here from its own full-width row. That row plus the page
          header plus the saved-view tab strip were the 22 rem the table was being asked to survive
          under, which left four and a half rows visible on a 900 px screen. */}
      <div className="relative w-full max-w-72 sm:w-64">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          value={config.search}
          onChange={(e) => patchConfig({ search: e.target.value })}
          placeholder={t('people.table.searchPlaceholder')}
          aria-label={t('people.table.searchPlaceholder')}
          className="h-9 pl-9"
        />
      </div>
      {config.filters.length > 0 ? (
        <Button variant="ghost" size="sm" onClick={() => patchConfig({ filters: [] })}>
          {t('people.table.filter.clearAll', { count: config.filters.length })}
        </Button>
      ) : null}
      <SegmentedControl
        size="sm"
        label={t('people.table.density.label')}
        value={config.density}
        onValueChange={(value) => patchConfig({ density: value })}
        options={[
          { value: 'comfortable', label: t('people.table.density.comfortable') },
          { value: 'compact', label: t('people.table.density.compact') },
        ]}
      />
      <Select
        aria-label={t('people.table.groupBy.label')}
        value={config.groupBy}
        onChange={(e) => patchConfig({ groupBy: e.target.value as PeopleViewConfig['groupBy'] })}
        className="h-9 w-auto text-small"
        options={[
          { value: 'unit', label: t('people.table.groupBy.unit') },
          { value: 'unitRole', label: t('people.table.groupBy.unitRole') },
          { value: 'none', label: t('people.table.groupBy.none') },
        ]}
      />
      <ColumnPicker
        value={config.columns}
        onChange={(next) => patchConfig({ columns: next })}
        available={availableColumns}
        maxColumns={PEOPLE_VIEW_CAPS.maxColumns}
        // SEV2 #7: Ism and Vazifalar are always rendered, plus every chosen column that still
        // resolves -- which is exactly the number of columns on screen, and what the badge claimed
        // to be counting.
        renderedCount={specs.length + 2}
      />
      {canExport ? (
        <Button asChild variant="secondary" size="sm">
          <a href={exportUrl} rel="noopener">
            <Download aria-hidden="true" className="size-4" />
            {t('people.table.export')}
          </a>
        </Button>
      ) : null}
    </div>
  )

  let body: React.JSX.Element
  if (rows.length === 0) {
    body = (
      <StateView
        kind="empty"
        titleKey="people.table.empty.title"
        bodyKey="people.table.empty.body"
      />
    )
  } else if (renderRows.length === 0) {
    body = (
      <StateView
        kind="empty"
        titleKey="people.table.noResults.title"
        bodyKey="people.table.noResults.body"
        action={{
          labelKey: 'people.table.noResults.action',
          onAction: () => patchConfig({ search: '', filters: [] }),
        }}
      />
    )
  } else if (narrow) {
    body = (
      <PeopleCards
        renderRows={visible}
        specs={specs}
        capacity={capacity}
        locale={locale}
        t={t}
        canAssign={canAssign}
        onAssign={(row) => props.setAssignTargets([row])}
      />
    )
  } else {
    body = (
      // SEV2 #19: the table got 531 px of a 900 px screen because `max-h-[calc(100vh-22rem)]` was a
      // guess at how much chrome sat above it -- and the guess was made before the saved-view tab
      // strip and the search row existed. `useViewportBoundedHeight` measures the element's own top
      // instead, so the table takes whatever is actually left, at any window size, with any number
      // of view tabs.
      // The named scroll region needs focus for native arrow-key scrolling; it stays a region,
      // rather than pretending to be an ARIA grid with a different cell-navigation contract.
      <div
        // Two refs on one node: the virtualizer needs the element (`scrollRef`) and the height hook
        // needs to observe it (`heightRef`).
        ref={(node) => {
          scrollRef.current = node
          heightRef(node)
        }}
        style={{ maxHeight: scrollerHeight }}
        role="region"
        aria-label={t('people.table.caption')}
        tabIndex={0 /* eslint-disable-line jsx-a11y/no-noninteractive-tabindex */}
        className="w-full min-w-0 overflow-auto rounded-lg border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <table className="w-full min-w-[44rem] border-collapse text-left text-small">
          <caption className="sr-only">{t('people.table.caption')}</caption>
          <thead className="sticky top-0 z-10 bg-surface-2">
            <tr className="border-b border-border">
              {/* SEV2 #19: the checkbox and the name are pinned left. The table is 1370 px wide in
                  a 1080 px viewport, and scrolling right used to lose the one thing a row needs in
                  order to be read at all. `bg-surface-2` on the header cells and `bg-card` on the
                  body cells so the pinned column has a ground of its own to sit on rather than
                  letting the scrolled content show through it. */}
              <th scope="col" className="sticky left-0 z-20 w-10 bg-surface-2 px-2 py-2">
                <Checkbox
                  aria-label={t('people.table.selectAll')}
                  checked={allSelected}
                  onCheckedChange={() =>
                    setSelection(allSelected ? [] : rows.map((r) => r.member.userId))
                  }
                />
              </th>
              <th
                scope="col"
                className="sticky left-10 z-20 min-w-56 border-r border-border bg-surface-2 px-3 py-2 font-medium"
              >
                <button
                  type="button"
                  onClick={() => toggleSort(NAME_COLUMN)}
                  className="min-h-9 rounded-sm px-1 text-left font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {t('people.table.column.name')}
                </button>
              </th>
              <th scope="col" className="min-w-40 px-3 py-2 font-medium">
                <button
                  type="button"
                  onClick={() => toggleSort(TASKS_COLUMN)}
                  className="min-h-9 rounded-sm px-1 text-left font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {t('people.table.column.tasks')}
                </button>
              </th>
              {specs.map((spec) => (
                <th
                  key={spec.id}
                  scope="col"
                  className="relative pl-3 pr-8 py-2 font-medium"
                  style={config.widths[spec.id] ? { width: config.widths[spec.id] } : undefined}
                >
                  <ColumnHeader
                    spec={spec}
                    sort={sortStateOf(spec.id)}
                    onSort={() => toggleSort(spec.id)}
                    filter={config.filters.find((f) => f.columnId === spec.id) ?? null}
                    onFilter={(next) =>
                      patchConfig({
                        filters: next
                          ? [...config.filters.filter((f) => f.columnId !== spec.id), next]
                          : config.filters.filter((f) => f.columnId !== spec.id),
                      })
                    }
                    // SEV2 #6: only a custom field can be "asked for" -- an indicator is derived,
                    // and nobody can fill in their own overdue count.
                    {...(fieldDefIdByColumnId.has(spec.id)
                      ? {
                          onAskToFill: () =>
                            onAskToFill({ defIds: [fieldDefIdByColumnId.get(spec.id)!] }),
                          askPending,
                        }
                      : {})}
                  />
                  <ColumnResizer
                    label={t('people.table.resize', { name: columnLabel(spec, t) })}
                    width={config.widths[spec.id] ?? null}
                    onResize={(px) => patchConfig({ widths: { ...config.widths, [spec.id]: px } })}
                    onReset={() => {
                      const next = { ...config.widths }
                      delete next[spec.id]
                      patchConfig({ widths: next })
                    }}
                  />
                </th>
              ))}
              <th scope="col" className="w-28 px-3 py-2 text-right font-medium">
                {t('people.table.column.actions')}
              </th>
            </tr>
          </thead>
          <Stagger as="tbody" animateKey={`${config.groupBy}:${config.search}`}>
            {paddingTop > 0 ? (
              <tr style={{ height: paddingTop }} aria-hidden="true">
                <td colSpan={specs.length + 3} />
              </tr>
            ) : null}
            {visible.map((entry, visibleIndex) => {
              const measuredRow = virtualise
                ? {
                    ref: virtualizer.measureElement,
                    'data-index': virtualItems[visibleIndex]!.index,
                  }
                : {}
              return entry.kind === 'group' ? (
                <tr key={entry.key} className="bg-muted/60" {...measuredRow}>
                  <th
                    scope="colgroup"
                    colSpan={specs.length + 3}
                    className="px-3 py-1.5 text-left text-eyebrow uppercase tracking-(--text-eyebrow--letter-spacing) text-muted-foreground"
                  >
                    {entry.label}
                    <span className="ml-1.5 normal-case tracking-normal">({entry.count})</span>
                  </th>
                </tr>
              ) : (
                <StaggerItem
                  as="tr"
                  key={entry.key}
                  {...measuredRow}
                  className={cn(
                    'border-b border-border last:border-0',
                    'transition-colors duration-(--dur-micro) ease-out hover:bg-accent/50',
                    selection.includes(entry.row.member.userId) && 'bg-accent/40',
                    config.density === 'compact' ? 'h-9' : 'h-11',
                  )}
                >
                  <td
                    className={cn(
                      'sticky left-0 z-10 px-2',
                      selection.includes(entry.row.member.userId) ? 'bg-accent/40' : 'bg-card',
                    )}
                  >
                    <Checkbox
                      aria-label={t('people.table.selectRow', {
                        name: fullName(entry.row.member),
                      })}
                      checked={selection.includes(entry.row.member.userId)}
                      onCheckedChange={() => toggleSelection(entry.row.member.userId)}
                    />
                  </td>
                  <th
                    scope="row"
                    className={cn(
                      'sticky left-10 z-10 min-w-56 border-r border-border px-3 font-normal',
                      selection.includes(entry.row.member.userId) ? 'bg-accent/40' : 'bg-card',
                    )}
                  >
                    <PersonCell row={entry.row} t={t} />
                  </th>
                  <td className="min-w-40 px-3">
                    <TaskChips cards={entry.row.cards} t={t} />
                  </td>
                  {specs.map((spec) => (
                    <td key={spec.id} className="px-3 align-middle whitespace-nowrap">
                      {spec.id === 'workloadPct' ? (
                        <WorkloadBar
                          pct={Number(entry.row.values['workloadPct'] ?? 0)}
                          label={workloadLabel(entry.row.values, capacity, t, locale)}
                        />
                      ) : (
                        <span className="tabular-nums">
                          {spec.id === 'unit' &&
                          entry.row.member.membershipRole === 'head' &&
                          entry.row.values['unit'] == null
                            ? t('headScope.departmentWide')
                            : formatIndicator(spec, entry.row.values[spec.id] ?? null, t, locale)}
                        </span>
                      )}
                    </td>
                  ))}
                  <td className="px-3 text-right">
                    <RowActions
                      row={entry.row}
                      t={t}
                      canAssign={canAssign}
                      onAssign={() => props.setAssignTargets([entry.row])}
                      telegramDeepLink={props.telegramByUser.get(entry.row.member.userId)}
                      missingFieldDefIds={missingFieldsFor(entry.row)}
                      askPending={askPending}
                      onAskToFill={() =>
                        onAskToFill({
                          defIds: missingFieldsFor(entry.row),
                          userIds: [entry.row.member.userId],
                        })
                      }
                    />
                  </td>
                </StaggerItem>
              )
            })}
            {paddingBottom > 0 ? (
              <tr style={{ height: paddingBottom }} aria-hidden="true">
                <td colSpan={specs.length + 3} />
              </tr>
            ) : null}
          </Stagger>
          <tfoot className="sticky bottom-0 bg-surface-2">
            <tr className="border-t border-border">
              <td className="sticky left-0 z-10 bg-surface-2 px-2" />
              <td className="sticky left-10 z-10 border-r border-border bg-surface-2 px-3 py-2 text-caption text-muted-foreground">
                {t('people.table.footer', { count: modelRows.length })}
              </td>
              <td className="px-3 py-2 text-caption tabular-nums text-muted-foreground">
                {t('people.table.footerTasks', {
                  count: modelRows.reduce((sum, r) => sum + r.original.cards.length, 0),
                })}
              </td>
              {specs.map((spec) => {
                const kind = defaultCalculation(spec)
                if (!kind) return <td key={spec.id} className="px-3 py-2" />
                const values = modelRows.map(
                  (r) => (r.original.values[spec.id] ?? null) as CellValue,
                )
                const result = calculate(spec, kind, values)
                // SEV2 #7: the fill progress the head actually manages -- "6 / 27" under Taʼlim --
                // which until now existed on /fields and nowhere in the table.
                const text =
                  kind === 'filled'
                    ? t('people.table.calc.filledOf', {
                        filled: result.value ?? 0,
                        total: values.length,
                      })
                    : result.value === null
                      ? '—'
                      : formatIndicator(spec, result.value, t, locale)
                return (
                  <td
                    key={spec.id}
                    className="px-3 py-2 text-caption tabular-nums text-muted-foreground"
                    title={t(`people.table.calc.${kind}`)}
                  >
                    {text}
                  </td>
                )
              })}
              <td className="px-3 py-2" />
            </tr>
          </tfoot>
        </table>
      </div>
    )
  }

  return (
    <PageContainer>
      <PageHeader
        eyebrow={t('shell.nav.group.manageHead')}
        title={t('people.table.title')}
        description={t('people.table.description')}
        actions={actions}
      />

      <div className="mt-4 flex min-w-0 flex-col gap-3">
        <ViewTabs
          views={props.views}
          activeViewId={props.activeViewId}
          dirty={props.dirty}
          busy={props.busy}
          baseTabLabel={t('people.table.views.base')}
          onSelect={props.onSelectView}
          onRevert={props.onRevert}
          onSaveOver={props.onSaveOver}
          onSaveAs={props.onSaveAs}
          onMakeDefault={props.onMakeDefault}
          onToggleShared={props.onToggleShared}
          onDelete={props.onDelete}
        />

        {body}
      </div>

      {/* SEV2 #19: the bulk bar FLOATS over the table rather than being inserted above it. Inline,
          selecting two rows pushed the already-short table down another 90 px -- the one moment a
          head needs to see more rows, not fewer. Fixed to the bottom of the viewport, out of the
          document flow, so the table never moves under the cursor that is selecting in it. */}
      {selection.length > 0 ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-4 z-30 flex justify-center px-4">
          <Reveal className="pointer-events-auto">
            <div className="flex flex-wrap items-center gap-2 rounded-full border border-primary/30 bg-surface-2 px-4 py-2 shadow-2">
              <Users aria-hidden="true" className="size-4 text-primary" />
              <span className="text-small font-medium">
                {t('people.table.bulk.selected', { count: selection.length })}
              </span>
              {canAssign ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    const chosen = rows.filter((row) => selection.includes(row.member.userId))
                    if (chosen.length > 0) props.setAssignTargets(chosen)
                  }}
                >
                  <UserPlus aria-hidden="true" className="size-4" />
                  {t('people.table.bulk.assign', { count: selection.length })}
                </Button>
              ) : null}
              {/* SEV2 #6: "ask to fill" in the bulk bar, scoped to the selection. The head has just
                  picked the people whose cells are empty; asking them is the next thing they want. */}
              <Button
                variant="secondary"
                size="sm"
                loading={askPending}
                onClick={() => onAskToFill({ userIds: selection })}
              >
                <BellRing aria-hidden="true" className="size-4" />
                {t('people.table.askToFill.bulk', { count: selection.length })}
              </Button>
              {canExport ? (
                <Button asChild variant="secondary" size="sm">
                  <a href={exportUrl} rel="noopener">
                    <Download aria-hidden="true" className="size-4" />
                    {t('people.table.bulk.export')}
                  </a>
                </Button>
              ) : null}
              <Button variant="ghost" size="sm" onClick={() => setSelection([])}>
                {t('people.table.bulk.clear')}
              </Button>
            </div>
          </Reveal>
        </div>
      ) : null}

      <QuickAssignSheet
        targets={props.assignTargets.map((row) => ({
          userId: row.member.userId,
          givenName: row.member.givenName,
          familyName: row.member.familyName,
          title: row.member.title,
          avatarKey: row.member.avatarKey,
        }))}
        onOpenChange={(open) => {
          if (!open) props.setAssignTargets([])
        }}
        onSubmit={props.onAssign}
        pending={props.assignPending}
      />
    </PageContainer>
  )
}

function PersonCell({ row, t }: { row: PersonRow; t: Translate }): React.JSX.Element {
  const name = fullName(row.member)
  return (
    <a
      href={personPath(row.member.userId)}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
        event.preventDefault()
        navigate(personPath(row.member.userId))
      }}
      className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2.5 gap-y-1 rounded-sm py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {/* Decorative: the link's own text already says the name, and `Avatar` always renders an
          `sr-only` copy of `alt` -- so passing the name here made every row announce it twice. */}
      <Avatar
        size="sm"
        alt=""
        hueSeed={row.member.userId}
        initials={initialsFromName(row.member.givenName, row.member.familyName)}
        src={avatarUrl(row.member.avatarKey, 64)}
      />
      <span className="flex min-w-0 flex-col">
        <span className="break-words font-medium">{name}</span>
        {row.member.title ? (
          <span className="break-words text-caption text-muted-foreground">{row.member.title}</span>
        ) : null}
      </span>
      {row.member.membershipRole === 'head' ? (
        <Badge tone="primary" variant="subtle" className="col-start-2 justify-self-start">
          {t('shell.department.role.head')}
        </Badge>
      ) : null}
    </a>
  )
}

function TaskChips({ cards, t }: { cards: Card[]; t: Translate }): React.JSX.Element {
  if (cards.length === 0) {
    return <span className="text-caption text-muted-foreground">{t('people.table.noTasks')}</span>
  }
  const first = cards.slice(0, 3)
  const rest = cards.length - first.length
  return (
    <span className="flex flex-wrap items-center gap-1">
      {first.map((card) => (
        <a
          key={card.id}
          href={`/work?card=${card.id}`}
          onClick={(event) => {
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
            event.preventDefault()
            navigate(`/work?card=${card.id}`)
          }}
          title={card.title}
          className={cn(
            'inline-flex min-h-6 max-md:min-h-11 max-w-40 max-md:max-w-full items-center rounded-sm border border-border px-1.5 py-0.5',
            'text-caption transition-colors duration-(--dur-micro) hover:bg-accent',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            card.risk === 'overdue' && 'border-destructive/40 text-destructive',
            card.risk === 'at_risk' && 'border-warning/50 text-warning',
          )}
        >
          <span className="min-w-0 break-words">{card.title}</span>
        </a>
      ))}
      {rest > 0 ? (
        <span className="text-caption text-muted-foreground">
          {t('people.table.moreTasks', { count: rest })}
        </span>
      ) : null}
    </span>
  )
}

/**
 * The per-column resize grip (SPEC §4.3 "drag to reorder; resize"). The width it writes lands in the
 * saved view's `widths` map, so a head who widened "Vazifalar" once gets that table back tomorrow and
 * in the link they paste to a colleague.
 *
 * Pointer *and* keyboard: this is a width slider with an aria-valuenow, arrow keys move it 16 px at a
 * time and Home resets the column to its natural width -- a resize handle reachable only by drag is a
 * setting a keyboard user simply cannot have (DESIGN.md §6).
 */
function ColumnResizer({
  label,
  width,
  onResize,
  onReset,
}: {
  label: string
  width: number | null
  onResize: (px: number) => void
  onReset: () => void
}): React.JSX.Element {
  const MIN = 64
  const MAX = 640
  const clamp = (px: number): number => Math.min(MAX, Math.max(MIN, Math.round(px)))
  const ref = React.useRef<HTMLButtonElement>(null)
  const [naturalWidth, setNaturalWidth] = React.useState(MIN)
  React.useLayoutEffect(() => {
    const cell = ref.current?.closest('th')
    if (!cell) return undefined
    // Reading the width changes only the announced value, never the table's layout.
    const measure = () => setNaturalWidth(Math.round(cell.getBoundingClientRect().width))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(cell)
    return () => observer.disconnect()
  }, [])

  function start(event: React.PointerEvent<HTMLButtonElement>): void {
    if (event.button !== 0) return
    event.preventDefault()
    const th = ref.current?.closest('th')
    if (!th) return
    const startX = event.clientX
    const startWidth = th.getBoundingClientRect().width
    const target = event.currentTarget
    target.setPointerCapture(event.pointerId)
    const move = (e: PointerEvent): void => onResize(clamp(startWidth + (e.clientX - startX)))
    const stop = (): void => {
      target.releasePointerCapture(event.pointerId)
      target.removeEventListener('pointermove', move)
      target.removeEventListener('pointerup', stop)
      target.removeEventListener('pointercancel', stop)
    }
    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', stop)
    target.addEventListener('pointercancel', stop)
  }

  function key(event: React.KeyboardEvent<HTMLButtonElement>): void {
    const current = width ?? ref.current?.closest('th')?.getBoundingClientRect().width ?? 160
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
      event.preventDefault()
      onResize(clamp(current - 16))
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
      event.preventDefault()
      onResize(clamp(current + 16))
    } else if (event.key === 'Home') {
      event.preventDefault()
      onReset()
    } else if (event.key === 'End') {
      event.preventDefault()
      onResize(MAX)
    }
  }

  return (
    <button
      ref={ref}
      type="button"
      // The value changes the horizontal column width, including the standard slider arrow keys.
      // A real <button> (not a bare div with a tabIndex) so it is in the tab order by construction
      // and the pointer handlers sit on something a keyboard user can already reach.
      role="slider"
      aria-orientation="horizontal"
      aria-label={label}
      aria-valuenow={width ?? naturalWidth}
      aria-valuemin={MIN}
      aria-valuemax={MAX}
      onPointerDown={start}
      onKeyDown={key}
      onDoubleClick={onReset}
      className="group absolute inset-y-1 right-0 flex w-6 cursor-col-resize touch-none items-center justify-center rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span
        aria-hidden="true"
        className="h-6 w-1 rounded-full bg-border group-hover:bg-primary/60 group-focus-visible:bg-primary"
      />
    </button>
  )
}

/**
 * v1.1 critique SEV2 #6: "notify-to-fill -- the CTO's named feature -- is unreachable from the one
 * screen where the gap is visible. Looking at a column of two dozen em-dashes under 'Sertifikatlar',
 * the head has no way to act."
 *
 * The row now carries an overflow menu with "Toʻldirishni soʻrash", scoped to *this person's*
 * missing fields -- `missingFieldDefIds` is computed from the cells already on screen, so the ask is
 * never sent to somebody who already answered, and the item does not appear at all for a person with
 * nothing missing. (The server filters again on the same rule -- `fields/service.ts`'s `notifyMany`
 * -- so this is the manners, not the enforcement.)
 */
function RowActions({
  row,
  t,
  canAssign,
  onAssign,
  telegramDeepLink,
  missingFieldDefIds,
  onAskToFill,
  askPending,
}: {
  row: PersonRow
  t: Translate
  canAssign: boolean
  onAssign: () => void
  telegramDeepLink: string | undefined
  missingFieldDefIds: readonly string[]
  onAskToFill: () => void
  askPending: boolean
}): React.JSX.Element {
  return (
    <span className="flex items-center justify-end gap-1">
      {canAssign ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={onAssign}
          aria-label={t('people.table.action.assign', { name: fullName(row.member) })}
        >
          <UserPlus aria-hidden="true" className="size-4" />
        </Button>
      ) : null}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => navigate(boardColumnPath(row.member))}
        aria-label={t('people.table.action.board', { name: fullName(row.member) })}
      >
        <Table2 aria-hidden="true" className="size-4" />
      </Button>
      {telegramDeepLink ? (
        <Button
          asChild
          variant="ghost"
          size="sm"
          aria-label={t('people.table.action.message', { name: fullName(row.member) })}
        >
          <a href={telegramDeepLink} rel="noopener noreferrer">
            <Send aria-hidden="true" className="size-4" />
          </a>
        </Button>
      ) : null}
      {missingFieldDefIds.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              aria-label={t('people.table.action.more', { name: fullName(row.member) })}
            >
              <MoreVertical aria-hidden="true" className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem disabled={askPending} onSelect={onAskToFill}>
              <BellRing aria-hidden="true" className="size-4" />
              {t('people.table.askToFill.row', { count: missingFieldDefIds.length })}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </span>
  )
}

/** 390 px: the row becomes a card carrying the first three columns plus the name (SPEC §4.3). A
 * horizontally scrolling twelve-column table on a phone is a table nobody reads. */
function PeopleCards({
  renderRows,
  specs,
  capacity,
  locale,
  t,
  canAssign,
  onAssign,
}: {
  renderRows: readonly (
    | { kind: 'group'; key: string; label: string; count: number }
    | { kind: 'person'; key: string; row: PersonRow }
  )[]
  /** SEV2 #7: indicators and custom fields alike, in the head's own column order -- so the three
   * facts a phone shows are the first three columns of the table, whichever kind they are. */
  specs: TableColumnSpec[]
  capacity: number
  locale: ReturnType<typeof useLocale>
  t: Translate
  canAssign: boolean
  onAssign: (row: PersonRow) => void
}): React.JSX.Element {
  const shown = specs.slice(0, 3)
  return (
    <Stagger className="flex flex-col gap-2">
      {renderRows.map((entry) => {
        return entry.kind === 'group' ? (
          <h2
            key={entry.key}
            className="mt-2 text-eyebrow uppercase tracking-(--text-eyebrow--letter-spacing) text-muted-foreground"
          >
            {entry.label}
            <span className="ml-1.5 normal-case tracking-normal">({entry.count})</span>
          </h2>
        ) : (
          <StaggerItem key={entry.key}>
            <article className="flex flex-col gap-2 rounded-md border border-border bg-card p-3">
              <PersonCell row={entry.row} t={t} />
              <TaskChips cards={entry.row.cards} t={t} />
              <dl className="flex flex-wrap gap-x-4 gap-y-1">
                {shown.map((spec) => (
                  <div key={spec.id} className="flex flex-col">
                    <dt className="text-caption text-muted-foreground">{columnLabel(spec, t)}</dt>
                    <dd className="text-small tabular-nums">
                      {spec.id === 'workloadPct' ? (
                        <WorkloadBar
                          pct={Number(entry.row.values['workloadPct'] ?? 0)}
                          label={workloadLabel(entry.row.values, capacity, t, locale)}
                        />
                      ) : spec.id === 'unit' &&
                        entry.row.member.membershipRole === 'head' &&
                        entry.row.values['unit'] == null ? (
                        t('headScope.departmentWide')
                      ) : (
                        formatIndicator(spec, entry.row.values[spec.id] ?? null, t, locale)
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
              {canAssign ? (
                <Button variant="secondary" size="sm" onClick={() => onAssign(entry.row)}>
                  <UserPlus aria-hidden="true" className="size-4" />
                  {t('people.table.action.assignShort')}
                </Button>
              ) : null}
            </article>
          </StaggerItem>
        )
      })}
    </Stagger>
  )
}
