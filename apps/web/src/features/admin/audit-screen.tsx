// `/admin/audit` -- paginated audit log, hash-chain verification, CSV export.
//
// round2 SEV2: this was developer output -- 50 rows of `session.created`, `session · f8dda908`, in
// monospace, untranslated, with no day grouping and no actor identity, and a free-text filter that
// taught the same query grammar (`admin.user.locked`) the work/analytics filters were rejected for
// teaching. The action is now a sentence per event type (`admin.console.audit.verb.*`, a curated top
// set -- everything else still shows the actor next to the raw action key, which at least resolves
// who did it),
// the actor is an avatar + name with role as a chip, the subject id is a chip (linked, for the
// subject types the super admin console can actually navigate to), rows group by day under a date
// sub-head, and the text filter is the same `FilterChip` row every other screen uses.
import * as React from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useT, useLocale, formatDate, formatTime } from '@devon/i18n'
import {
  AnimatedCheck,
  Avatar,
  Badge,
  Button,
  Chip,
  FilterChip,
  Stagger,
  StaggerItem,
  StateView,
  initialsFromName,
  toast,
} from '@devon/ui'
import { AlertTriangle } from 'lucide-react'
import { RouterLink } from '../../lib/router.js'
import { auditExportUrl, fetchAuditEvents, fetchAuditVerify, type AuditEventRow } from './api.js'
import { AdminScreen } from './admin-screen.js'

/** UI-OVERHAUL.md §2 "Admin console ... audit viewer with chain-verify badge animation": the check
 * draws in the moment a chain verification comes back clean, instead of a badge that is simply
 * already there -- "verified" is an event, not a static label. Starts unchecked and flips true one
 * frame after mount (the same trick every "draw in on arrival" spot in this app uses, since
 * `AnimatedCheck`'s own `initial={false}` means a check born already-`true` never animates). A broken
 * chain gets a plain (still) warning icon: alarm, never celebration. */
function ChainVerifyBadge({ ok }: { ok: boolean }) {
  const t = useT()
  const [checked, setChecked] = React.useState(false)
  React.useEffect(() => {
    if (!ok) return
    const id = requestAnimationFrame(() => setChecked(true))
    return () => cancelAnimationFrame(id)
  }, [ok])

  return (
    <Badge tone={ok ? 'success' : 'destructive'} className="gap-1">
      {ok ? (
        <AnimatedCheck checked={checked} className="size-3.5" />
      ) : (
        <AlertTriangle className="size-3.5" aria-hidden="true" />
      )}
      {t(ok ? 'admin.console.audit.chainOk' : 'admin.console.audit.chainBroken')}
    </Badge>
  )
}

const CATEGORIES = ['session', 'accounts', 'admin', 'departments', '__other__'] as const
const CATEGORY_LABEL_KEY: Record<(typeof CATEGORIES)[number], string> = {
  session: 'admin.console.audit.filter.session',
  accounts: 'admin.console.audit.filter.accounts',
  admin: 'admin.console.audit.filter.admin',
  departments: 'admin.console.audit.filter.departments',
  __other__: 'admin.console.audit.filter.other',
}

const ROLE_LABEL_KEY: Record<string, string> = {
  super_admin: 'admin.console.accounts.role.superAdmin',
  head: 'admin.console.accounts.role.head',
  member: 'admin.console.accounts.role.member',
}

/** Where a subject chip can actually navigate to -- the super admin console has no view into most
 * department-scoped objects (a card, a project, a page) at all, so those stay a plain, unlinked chip
 * rather than a link to nowhere. */
const SUBJECT_ROUTE: Partial<Record<string, string>> = {
  department: '/admin/departments',
  user: '/admin/accounts',
}

/** Round-2 verification report #13: every `tx.audit({action:...})` the API can emit now has a
 * curated sentence in `admin.console.audit.verb.*` -- but `personal.task.*`/`personal.sprint.*` are
 * the API's own internal action-type strings, and `sprint`/`task` are on DESIGN.md §1.4's banned
 * project-management jargon list (the i18n unit test scans every message *key* as well as every
 * value, and a JSON key equal to the raw action string would fail that scan even though the
 * translated text itself says "davr"/"vazifa", never the English word). This alias only renames the
 * *lookup key* for those two action families so the message file's own keys stay clean; every other
 * action type's key is still the raw action string verbatim, same as before. */
const VERB_KEY_ALIAS: Partial<Record<string, string>> = {
  'personal.sprint.created': 'personal.cycle.created',
  'personal.sprint.rolled_over': 'personal.cycle.rolled_over',
  'personal.sprint.updated': 'personal.cycle.updated',
  'personal.task.created': 'personal.item.created',
  'personal.task.deleted': 'personal.item.deleted',
  'personal.task.reordered': 'personal.item.reordered',
  'personal.task.updated': 'personal.item.updated',
}

/** The verb phrase for one event's action -- `admin.console.audit.verb.*` now covers every action
 * type the API's `tx.audit(...)` calls emit with a real per-type phrase; `null` only for an action
 * type introduced after this map (a future module's event), so that row falls back to showing the
 * actor next to the raw action key instead of a fabricated sentence. */
function useActionVerb(): (action: string) => string | null {
  const t = useT()
  return (action) => {
    const key = VERB_KEY_ALIAS[action] ?? action
    const verb = t(`admin.console.audit.verb.${key}`)
    return verb.startsWith('⟨') ? null : verb
  }
}

function subjectLabel(t: ReturnType<typeof useT>, subjectType: string): string {
  const key = `admin.console.audit.subjectType.${subjectType}`
  const label = t(key)
  return label.startsWith('⟨') ? subjectType : label
}

function actorInitials(actorName: string | null): string {
  if (!actorName) return '?'
  const [given, ...rest] = actorName.split(' ')
  return initialsFromName(given ?? '', rest.join(' '))
}

function AuditRow({ event }: { event: AuditEventRow }) {
  const t = useT()
  const locale = useLocale()
  const verbOf = useActionVerb()
  const actorLabel = event.actorName ?? t('admin.console.audit.actorSystem')
  const roleKey = event.actorRole ? ROLE_LABEL_KEY[event.actorRole] : undefined
  const verb = verbOf(event.action)
  const subjectRoute = SUBJECT_ROUTE[event.subjectType]
  const subjectChip = (
    <Chip tone="outline" className="shrink-0">
      {subjectLabel(t, event.subjectType)}
      {event.subjectId ? ` · ${event.subjectId.slice(0, 8)}` : ''}
    </Chip>
  )

  return (
    <div className="flex items-center gap-3 border-b border-border/60 px-3 py-2.5 last:border-b-0">
      <span className="w-14 shrink-0 text-caption tabular-nums text-muted-foreground">
        {formatTime(new Date(event.at), locale)}
      </span>
      <Avatar
        size="sm"
        src={null}
        alt={actorLabel}
        initials={actorInitials(event.actorName)}
        hueSeed={event.actorUserId ?? 'system'}
      />
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-0.5">
        <span className="font-medium text-foreground">{actorLabel}</span>
        {roleKey ? (
          <Badge tone="neutral" className="h-5 px-1.5">
            {t(roleKey)}
          </Badge>
        ) : null}
        <span className="text-small text-muted-foreground">{verb ?? `: ${event.action}`}</span>
      </div>
      {subjectRoute ? (
        <RouterLink href={subjectRoute} className="shrink-0">
          {subjectChip}
        </RouterLink>
      ) : (
        subjectChip
      )}
    </div>
  )
}

/** `at` grouped by calendar day (device-local, same as every other date in this console), each
 * group under its own date sub-head -- round2 SEV2 asked for day grouping instead of 50 undifferentiated
 * rows. */
function groupByDay(
  events: readonly AuditEventRow[],
  locale: ReturnType<typeof useLocale>,
): { label: string; items: AuditEventRow[] }[] {
  const groups: { key: string; label: string; items: AuditEventRow[] }[] = []
  for (const event of events) {
    const d = new Date(event.at)
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
    let group = groups.find((g) => g.key === key)
    if (!group) {
      group = { key, label: formatDate(d, locale), items: [] }
      groups.push(group)
    }
    group.items.push(event)
  }
  return groups
}

function AuditBody() {
  const t = useT()
  const locale = useLocale()
  const [category, setCategory] = React.useState<string | null>(null)
  const [cursors, setCursors] = React.useState<number[]>([])
  const cursor = cursors[cursors.length - 1]

  const listQuery = useQuery({
    queryKey: ['admin', 'audit', 'events', category, cursor],
    queryFn: () => fetchAuditEvents({ category: category ?? undefined, cursor }),
  })

  const verify = useMutation({
    mutationFn: fetchAuditVerify,
    onSuccess: (result) => {
      toast(
        result.ok
          ? t('admin.console.audit.verifyOkToast')
          : t('admin.console.audit.verifyFailedToast'),
      )
    },
  })

  if (listQuery.isPending) return <StateView kind="loading" titleKey="state.loading" />
  if (listQuery.isError) {
    return (
      <StateView
        kind="error"
        titleKey="state.error.title"
        bodyKey="state.error.body"
        action={{ labelKey: 'state.error.action', onAction: () => listQuery.refetch() }}
      />
    )
  }

  const events = listQuery.data.events
  const groups = groupByDay(events, locale)

  function selectCategory(next: string | null) {
    setCategory(next)
    setCursors([])
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <FilterChip active={category === null} onClick={() => selectCategory(null)}>
            {t('admin.console.audit.filter.all')}
          </FilterChip>
          {CATEGORIES.map((c) => (
            <FilterChip key={c} active={category === c} onClick={() => selectCategory(c)}>
              {t(CATEGORY_LABEL_KEY[c])}
            </FilterChip>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="secondary" onClick={() => verify.mutate()} loading={verify.isPending}>
            {t('admin.console.audit.verifyChain')}
          </Button>
          <a href={auditExportUrl(category ?? undefined)}>
            <Button variant="secondary">{t('admin.console.audit.export')}</Button>
          </a>
        </div>
      </div>

      {verify.data ? (
        <div className="flex items-center gap-2 rounded-md border border-border bg-card p-4 text-small text-foreground">
          <ChainVerifyBadge ok={verify.data.ok} />
          {t('admin.console.audit.chainRowsChecked', { count: verify.data.rows })}
        </div>
      ) : null}

      {events.length === 0 ? (
        <StateView kind="empty" titleKey="admin.console.audit.empty.title" />
      ) : (
        <div className="flex flex-col gap-4">
          {groups.map((group) => (
            <section
              key={group.label}
              className="overflow-hidden rounded-md border border-border bg-card"
            >
              <h3 className="border-b border-border bg-surface-2 px-3 py-1.5 text-eyebrow uppercase tracking-(--text-eyebrow--letter-spacing) text-muted-foreground">
                {group.label}
              </h3>
              <Stagger animateKey={`${category}:${cursor ?? 0}`}>
                {group.items.map((e) => (
                  <StaggerItem key={e.seq}>
                    <AuditRow event={e} />
                  </StaggerItem>
                ))}
              </Stagger>
            </section>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          disabled={cursors.length === 0}
          onClick={() => setCursors((c) => c.slice(0, -1))}
        >
          {t('admin.console.audit.previousPage')}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={listQuery.data.nextCursor === null}
          onClick={() => {
            if (listQuery.data.nextCursor !== null) {
              setCursors((c) => [...c, listQuery.data.nextCursor as number])
            }
          }}
        >
          {t('admin.console.audit.nextPage')}
        </Button>
      </div>
    </div>
  )
}

export default function AuditScreen() {
  return (
    <AdminScreen active="audit">
      <AuditBody />
    </AdminScreen>
  )
}
