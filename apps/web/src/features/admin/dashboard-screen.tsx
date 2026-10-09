// `/admin` -- overview + quick links. Supersedes `routes/admin.tsx`'s foundation placeholder (a
// smaller readyz-only health card): `app.tsx`'s route outlet matches this feature's exact-path route
// first (MODULE-GUIDE.md "Web features"), so this component now renders at `/admin` and the old
// `AdminRoute`/`routes/admin.tsx` file is unreachable dead code left for a follow-up cleanup pass
// (outside this module's own paths -- see this item's report).
import * as React from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { formatNumber, numberFlowLocale, useLocale, useT } from '@devon/i18n'
import { Badge, Button, Collapsible, CountFlow, DataList, DataRow, StateView, cn } from '@devon/ui'
import {
  Activity,
  AlertTriangle,
  Building2,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Users,
} from 'lucide-react'
import { Link, navigate } from '../../lib/router.js'
import { fetchAllRequests } from '../departments/api.js'
import {
  fetchAdminDepartments,
  fetchAdminHealth,
  fetchAdminInstanceDetail,
  fetchMaintenance,
} from './api.js'
import { AdminScreen } from './admin-screen.js'
import { StatTile, StatusDot } from './charts.js'

const QUICK_LINKS = [
  {
    to: '/departments/requests',
    icon: ClipboardCheck,
    titleKey: 'admin.console.dashboard.reviewRequests',
    descKey: 'admin.console.dashboard.reviewRequestsDesc',
  },
  {
    to: '/admin/departments',
    icon: Building2,
    titleKey: 'admin.console.dashboard.manageDepartments',
    descKey: 'admin.console.dashboard.manageDepartmentsDesc',
  },
  {
    to: '/admin/accounts',
    icon: Users,
    titleKey: 'admin.console.dashboard.manageAccounts',
    descKey: 'admin.console.dashboard.manageAccountsDesc',
  },
  {
    to: '/admin/health',
    icon: Activity,
    titleKey: 'admin.console.dashboard.checkHealth',
    descKey: 'admin.console.dashboard.checkHealthDesc',
  },
] as const

const HEALTH_ROWS = [
  { key: 'db', labelKey: 'admin.console.health.db' },
  { key: 'queue', labelKey: 'admin.console.health.queue' },
  { key: 'storage', labelKey: 'admin.console.health.storage' },
  { key: 'telegram', labelKey: 'admin.console.health.telegram' },
  { key: 'ai', labelKey: 'admin.console.health.ai' },
  { key: 'backups', labelKey: 'admin.console.health.backups' },
] as const

/** SEV2 #26: which status is a problem the super admin has to do something about. A grey
 * "not_configured" backup on a government instance is not neutral information. */
const STATUS_TONE: Record<
  'ok' | 'degraded' | 'down' | 'not_configured',
  'success' | 'warning' | 'destructive' | 'neutral'
> = {
  ok: 'success',
  degraded: 'warning',
  down: 'destructive',
  not_configured: 'warning',
}

/**
 * v1.1 critique SEV2 #26 -- "'Tizim holati' still conveys status by colour alone: six bare dots with
 * no text label and no legend, which DESIGN.md §6 explicitly forbids."
 *
 * Every dot now has its state written next to it, so the grid is readable with the colour removed
 * entirely -- which is the actual test §6 is asking for. "Zaxira nusxalar" being unconfigured is
 * rendered as a warning with a link to configure it rather than as a neutral grey dot: no backups on
 * a government instance is the single most important thing this card can say.
 */
function HealthSnapshot() {
  const t = useT()
  const query = useQuery({ queryKey: ['admin', 'health'], queryFn: fetchAdminHealth })

  return (
    <section className="rounded-md border border-border bg-card p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-h3 text-foreground">{t('admin.console.dashboard.healthTitle')}</h2>
        <Link to="/admin/health" className="text-small text-primary hover:underline">
          {t('admin.console.dashboard.healthSeeAll')}
        </Link>
      </div>
      {renderBody()}
    </section>
  )

  function renderBody(): React.ReactNode {
    if (query.isPending) return <StateView kind="loading" titleKey="state.loading" />
    if (query.isError) {
      return (
        <p className="text-small text-muted-foreground">
          {t('admin.console.dashboard.healthUnavailable')}
        </p>
      )
    }
    const backups = query.data['backups']
    return (
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {HEALTH_ROWS.map((row) => {
            const status = query.data[row.key].status
            return (
              <div key={row.key} className="flex min-w-0 items-center gap-2">
                <StatusDot status={status} />
                <span className="min-w-0 flex-1 truncate text-small text-foreground">
                  {t(row.labelKey)}
                </span>
                {/* SEV2 #26: the state in words, beside the dot. Not a legend somewhere else on the
                    page -- the label a person needs is the one next to the thing. */}
                <Badge variant="subtle" tone={STATUS_TONE[status]} className="shrink-0">
                  {t(`admin.console.health.status.${status}`)}
                </Badge>
              </div>
            )
          })}
        </div>

        {/* SEV2 #26: an unconfigured backup is a warning with somewhere to go, not a grey dot. */}
        {backups && backups.status === 'not_configured' ? (
          <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-2 gap-y-3 rounded-md border border-warning/40 bg-warning/5 px-3 py-2 sm:flex sm:items-center">
            <AlertTriangle aria-hidden="true" className="size-4 shrink-0 text-warning" />
            <span className="min-w-0 flex-1 text-small text-foreground">
              {t('admin.console.dashboard.backupsUnconfigured')}
            </span>
            <Button
              asChild
              variant="secondary"
              size="sm"
              className="col-start-2 h-auto min-h-8 max-w-full justify-self-start whitespace-normal sm:shrink-0"
            >
              <Link to="/admin/health">{t('admin.console.dashboard.backupsConfigure')}</Link>
            </Button>
          </div>
        ) : null}
      </div>
    )
  }
}

/**
 * v1.1 critique SEV2 #26 -- "'FOYDALANUVCHILAR SONI 62' has no breakdown by department".
 *
 * A super admin's one instance-wide number, with the thing it is made of one click away. The
 * department list is already an endpoint this console owns; nothing new is computed here.
 */
function UserCountTile({ total }: { total: number }): React.JSX.Element {
  const t = useT()
  const locale = useLocale()
  const [open, setOpen] = React.useState(false)
  const departments = useInfiniteQuery({
    queryKey: ['admin', 'departments', 'breakdown'],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => fetchAdminDepartments({ cursor: pageParam }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    // Only fetched once the super admin actually asks for the breakdown.
    enabled: open,
  })

  const rows = [...(departments.data?.pages.flatMap((page) => page.departments) ?? [])].sort(
    (a, b) => b.memberCount - a.memberCount,
  )

  // A plain if/else rather than a nested ternary: `check-i18n.mjs`'s hard-coded-text heuristic reads
  // the `>...<` at a ternary branch point as JSX copy (the same workaround `people-screen.tsx` and
  // `filter-clause-chips.ts` document).
  function renderBreakdown(): React.ReactNode {
    if (departments.isPending) {
      return <p className="text-caption text-muted-foreground">{t('state.loading')}</p>
    }
    if (departments.isError && !departments.data) {
      return (
        <StateView
          kind="error"
          titleKey="state.error.title"
          action={{ labelKey: 'state.error.action', onAction: () => departments.refetch() }}
        />
      )
    }
    return (
      <div className="flex flex-col gap-2">
        <ul className="flex flex-col gap-1">
          {rows.map((department) => (
            <li key={department.id} className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 truncate text-small text-foreground">{department.name}</span>
              <span className="shrink-0 text-small tabular-nums text-muted-foreground">
                {formatNumber(department.memberCount, locale)}
              </span>
            </li>
          ))}
        </ul>
        {departments.hasNextPage ? (
          <Button
            variant="secondary"
            size="sm"
            loading={departments.isFetchingNextPage}
            onClick={() => departments.fetchNextPage()}
          >
            {t(
              departments.isFetchNextPageError
                ? 'state.error.action'
                : 'admin.console.dashboard.moreDepartments',
            )}
          </Button>
        ) : null}
      </div>
    )
  }

  return (
    // Same surface as the two `StatTile`s beside it (`charts.tsx`): `bg-surface-2`, `shadow-1`,
    // `font-display text-h1`. The three overview tiles are read as one row and were drawn as two
    // different things.
    <div className="flex flex-col gap-2 rounded-md border border-border bg-surface-2 p-4 shadow-1">
      <p className="text-eyebrow uppercase tracking-(--text-eyebrow--letter-spacing) text-muted-foreground">
        {t('admin.console.dashboard.userCount')}
      </p>
      {/* Motion verdict F11: this was the one counter in the product that did not tick. It is also
          the number a super admin watches while approving a department -- the single moment it
          changes -- so it changed without ever being seen changing. `CountFlow` is the same ticker
          the board columns and the inbox badge use, handed the app's locale (not the browser's, or a
          uz-Latn UI groups with commas), and `animated={false}` under reduced motion comes with it. */}
      <p className="font-display text-h1 tabular-nums text-foreground">
        <CountFlow value={total} locale={numberFlowLocale(locale)} />
      </p>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        className="flex items-center gap-1 self-start rounded-sm text-small text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronDown
          aria-hidden="true"
          className={cn(
            'size-4 transition-transform duration-(--dur-micro) ease-(--ease-standard)',
            open && 'rotate-180',
          )}
        />
        {t('admin.console.dashboard.userCountBreakdown')}
      </button>
      <Collapsible open={open}>
        <div className="pt-2">{renderBreakdown()}</div>
      </Collapsible>
    </div>
  )
}

function DashboardBody() {
  const t = useT()
  const locale = useLocale()
  const instanceQuery = useQuery({
    queryKey: ['admin', 'instance'],
    queryFn: fetchAdminInstanceDetail,
  })
  // SEV2 #26: how many department requests are actually waiting. A count that is wrong is worse than
  // no count, so a failed fetch simply shows none rather than a guess.
  const pendingQuery = useQuery({
    queryKey: ['departments', 'requests', 'pending'],
    queryFn: () => fetchAllRequests('pending'),
  })
  const pendingRequests = pendingQuery.data?.requests.length ?? 0
  const maintenanceQuery = useQuery({
    queryKey: ['admin', 'maintenance'],
    queryFn: fetchMaintenance,
  })

  if (instanceQuery.isPending) return <StateView kind="loading" titleKey="state.loading" />
  if (instanceQuery.isError) {
    return (
      <StateView
        kind="error"
        titleKey="state.error.title"
        bodyKey="state.error.body"
        action={{ labelKey: 'state.error.action', onAction: () => instanceQuery.refetch() }}
      />
    )
  }

  const instance = instanceQuery.data

  return (
    <div className="flex flex-col gap-6">
      {maintenanceQuery.data?.enabled ? (
        <div className="rounded-md border border-warning bg-warning/10 p-4 text-body text-foreground">
          {t('admin.console.dashboard.maintenanceActive')}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <UserCountTile total={instance.userCount} />
        <StatTile
          label={t('admin.console.dashboard.registration')}
          value={t(
            instance.registrationOpen
              ? 'admin.console.dashboard.registrationOpen'
              : 'admin.console.dashboard.registrationClosed',
          )}
        />
        <StatTile
          label={t('admin.console.dashboard.instanceKind')}
          value={t(
            instance.isDemo ? 'admin.console.dashboard.demo' : 'admin.console.dashboard.live',
          )}
        />
      </div>

      <HealthSnapshot />

      <section className="flex flex-col gap-3">
        <h2 className="text-h3 text-foreground">{t('admin.console.dashboard.quickLinks')}</h2>
        {/* round2 SEV3 #25: this used to be four plain underlined text links in a card -- the
            DataRow recipe every other dense list in the console already uses (icon, title,
            one-line description, a chevron that says "this goes somewhere"). */}
        <DataList label={t('admin.console.dashboard.quickLinks')}>
          {QUICK_LINKS.map((link) => (
            <DataRow
              key={link.to}
              interactive
              onClick={() => navigate(link.to)}
              leading={<link.icon className="size-5 text-muted-foreground" aria-hidden="true" />}
              trailing={
                <span className="flex items-center gap-2">
                  {/* SEV2 #26: "Boʻlim soʻrovlari -- the super admin's main job -- has no
                      pending-count badge". It is the one row on this screen that is ever waiting for
                      somebody, so it is the one row that says so. */}
                  {link.to === '/departments/requests' && pendingRequests > 0 ? (
                    <Badge tone="attention">{formatNumber(pendingRequests, locale)}</Badge>
                  ) : null}
                  <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
                </span>
              }
            >
              <div className="min-w-0">
                <p className="truncate text-body font-medium text-foreground">{t(link.titleKey)}</p>
                <p className="truncate text-small text-muted-foreground">{t(link.descKey)}</p>
              </div>
            </DataRow>
          ))}
        </DataList>
      </section>
    </div>
  )
}

export default function DashboardScreen() {
  return (
    <AdminScreen active="dashboard">
      <DashboardBody />
    </AdminScreen>
  )
}
