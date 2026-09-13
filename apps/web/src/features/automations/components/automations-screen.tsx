// EPIC-017 -- `/automations`: the head's rule list, the builder, the kill switch and the run log.
//
// Head-only. A member who reaches the route sees the designed no-permission state, not a 403 they
// can do nothing about -- and the server refuses every one of these endpoints for them anyway, so
// the client here is only hiding what it already cannot do.
//
// The run log is the feature that makes the rest trustworthy. CLICKUP-RESEARCH §7.3's finding is
// that people turn automations off not because they misfire but because they cannot tell a rule that
// did nothing from a rule that is broken. So every run -- applied, skipped *and* failed -- is listed
// with what it did, and a rule's last error rides on the rule card itself.
import * as React from 'react'
import { AnimatePresence } from 'motion/react'
import {
  AlertTriangle,
  Check,
  ChevronRight,
  CircleSlash,
  Copy,
  Pause,
  Pencil,
  Plus,
  Trash2,
  Zap,
} from 'lucide-react'
import { AUTOMATION_MAX_RULES, type AutomationRuleBody } from '@devon/contracts'
import { useT, useLocale, formatDateTime } from '@devon/i18n'
import {
  Badge,
  Button,
  Chip,
  Dialog,
  DialogContent,
  IconButton,
  PageHeader,
  SectionCard,
  Skeleton,
  Stagger,
  StaggerItem,
  StateView,
  Switch,
  cn,
  toast,
  toastWithUndo,
} from '@devon/ui'
import { navigate, replaceSearchParam } from '../../../lib/router.js'
import { useDepartment } from '../../../lib/session.js'
import { useLabelsQuery, useMembers } from '../../work/hooks.js'
import {
  useAutomationRulesQuery,
  useAutomationRunsQuery,
  useCreateRuleMutation,
  useDeleteRuleMutation,
  usePatchRuleMutation,
  usePauseAllMutation,
} from '../hooks.js'
import { ACTION_LABEL_KEY, RuleBuilder, TRIGGER_LABEL_KEY } from './rule-builder.js'
import type { AutomationRule, AutomationRun } from '../api.js'

/** SEV2 #9: how many grouped batches one page of the run log shows. */
const RUN_PAGE_SIZE = 20

const RUN_STATUSES = ['applied', 'skipped', 'failed'] as const

const RUN_FILTER_CLASS =
  'h-9 rounded-sm border border-border bg-card px-2 text-small text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

const RUN_STATUS_ICON = {
  applied: Check,
  skipped: CircleSlash,
  failed: AlertTriangle,
} as const

/** Tinted, not solid -- the same shape `work/lib/format.ts`'s `RISK_BADGE_CLASSNAME` uses, and for
 * the same reason: a run log is a dense list where most rows are "applied", and a wall of solid
 * green reads as decoration rather than as information. Colour is never the only signal here either:
 * every row carries its own glyph and its status word. */
const RUN_STATUS_CLASS: Record<AutomationRun['status'], string> = {
  applied: 'bg-success/10 text-success',
  skipped: 'bg-muted text-muted-foreground',
  failed: 'bg-destructive/10 text-destructive',
}

/** Every reason `engine.ts` can skip a run for, mapped to a sentence. Enumerated rather than
 * interpolated into the key: `t()` has no fallback -- an unknown key renders as `<key>` on screen --
 * so a reason this build does not know about must degrade to a generic line, not to a raw token in
 * front of a department head. */
const RUN_STATUS_LABEL_KEY: Record<AutomationRun['status'], string> = {
  applied: 'automations.run.status.applied',
  skipped: 'automations.run.status.skipped',
  failed: 'automations.run.status.failed',
}

const RUN_REASON_KEY: Record<string, string> = {
  chain_depth: 'automations.run.reason.chainDepth',
  loop_guard: 'automations.run.reason.loopGuard',
  no_valid_actions: 'automations.run.reason.noValidActions',
  status_did_not_match: 'automations.run.reason.statusDidNotMatch',
  filter_did_not_match: 'automations.run.reason.filterDidNotMatch',
  already_applied_today: 'automations.run.reason.alreadyAppliedToday',
}

/**
 * v1.1 critique SEV2 #9: "each rule card offers only a toggle and a delete icon: you cannot change a
 * rule you wrote, only delete it and retype it." Edit and Duplicate now sit beside the toggle --
 * Duplicate because the second rule a head writes is almost always a variation on the first, and
 * retyping a trigger, a filter and three actions to change one field is how an automations feature
 * stops being used.
 *
 * The card also says out loud when its history and its switch disagree. The demo's own log showed
 * 79 runs from a rule that is currently OFF while the inbox showed 4 items, and nothing on screen
 * reconciled the two. A disabled rule with a run history now says that those runs happened while it
 * was on and that nothing new will fire.
 */
function RuleCard({
  rule,
  onToggle,
  onDelete,
  onEdit,
  onDuplicate,
  busy,
}: {
  rule: AutomationRule
  onToggle: (enabled: boolean) => void
  onDelete: () => void
  onEdit: () => void
  onDuplicate: () => void
  busy: boolean
}): React.JSX.Element {
  const t = useT()
  const locale = useLocale()
  return (
    <article
      className={cn(
        'flex flex-col gap-3 rounded-md border bg-card p-4',
        rule.enabled ? 'border-border' : 'border-dashed border-border opacity-70',
      )}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className={cn(
            'inline-flex size-8 shrink-0 items-center justify-center rounded-md',
            rule.enabled ? 'bg-accent text-accent-foreground' : 'bg-muted text-muted-foreground',
          )}
        >
          <Zap className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-body font-medium text-foreground">{rule.name}</h3>
          <p className="text-caption text-muted-foreground">
            {t('automations.rule.sentence', {
              trigger: t(TRIGGER_LABEL_KEY[rule.trigger]),
              actions: rule.actions.map((a) => t(ACTION_LABEL_KEY[a.kind])).join(', '),
            })}
          </p>
        </div>
        <Switch
          checked={rule.enabled}
          onCheckedChange={onToggle}
          disabled={busy}
          aria-label={t('automations.rule.toggle', { name: rule.name })}
        />
        <IconButton
          aria-label={t('automations.rule.edit', { name: rule.name })}
          onClick={onEdit}
          disabled={busy}
        >
          <Pencil className="size-4" aria-hidden="true" />
        </IconButton>
        <IconButton
          aria-label={t('automations.rule.duplicate', { name: rule.name })}
          onClick={onDuplicate}
          disabled={busy}
        >
          <Copy className="size-4" aria-hidden="true" />
        </IconButton>
        <IconButton
          aria-label={t('automations.rule.delete', { name: rule.name })}
          onClick={onDelete}
          disabled={busy}
        >
          <Trash2 className="size-4" aria-hidden="true" />
        </IconButton>
      </div>

      {/* SEV2 #9: the log and the switch, reconciled. A rule that is off but has a history is not a
          rule that is running quietly -- and a head looking at 79 log rows under a grey toggle
          deserves that sentence rather than having to infer it. */}
      {!rule.enabled && rule.runCount > 0 ? (
        <p className="flex items-start gap-1.5 rounded-sm bg-muted px-2 py-1.5 text-caption text-muted-foreground">
          <Pause className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          {t('automations.rule.suppressed', { count: rule.runCount })}
        </p>
      ) : null}

      {/* A broken rule announces itself rather than quietly doing nothing. */}
      {rule.lastError ? (
        <p className="flex items-start gap-1.5 rounded-sm bg-destructive/10 px-2 py-1.5 text-caption text-destructive">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          {t('automations.rule.lastError', { error: rule.lastError })}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 text-caption text-muted-foreground">
        <Chip tone="outline">{t('automations.rule.runCount', { count: rule.runCount })}</Chip>
        {rule.lastRunAt ? (
          <span>
            {t('automations.rule.lastRun', {
              at: formatDateTime(new Date(rule.lastRunAt), locale),
            })}
          </span>
        ) : (
          <span>{t('automations.rule.neverRun')}</span>
        )}
        {rule.triggerConfig.filter ? <Chip tone="outline">{rule.triggerConfig.filter}</Chip> : null}
      </div>
    </article>
  )
}

/**
 * v1.1 critique SEV2 #9 -- "79 consecutive identical rows: same rule, same minute, different card,
 * unpaginated, ungrouped, unfilterable".
 *
 * A rule that fires over a batch of cards produces one log entry per card, which is correct data and
 * useless reading. Runs are grouped by (rule, outcome, minute): a batch collapses to one row saying
 * what it was -- "79 ta karta · 13.09 11:00" -- and expands to the individual cards on demand. A
 * genuine one-off run is a group of one and renders exactly as it did before.
 *
 * The minute is the grain because that is what a trigger batch looks like from the outside: the
 * engine processes a sweep in one pass, and every row in the demo's 79 carried the same
 * `13.09.2026 11:00`.
 */
type RunGroup = {
  key: string
  ruleId: string
  ruleName: string
  status: AutomationRun['status']
  at: string
  runs: AutomationRun[]
}

function groupRuns(runs: readonly AutomationRun[]): RunGroup[] {
  const groups: RunGroup[] = []
  for (const run of runs) {
    // `YYYY-MM-DDTHH:MM` -- the minute the engine's sweep ran.
    const minute = run.at.slice(0, 16)
    const key = `${run.ruleId}|${run.status}|${minute}`
    const last = groups[groups.length - 1]
    if (last && last.key === key) {
      last.runs.push(run)
      continue
    }
    groups.push({
      key,
      ruleId: run.ruleId,
      ruleName: run.ruleName,
      status: run.status,
      at: run.at,
      runs: [run],
    })
  }
  return groups
}

function RunGroupRow({ group }: { group: RunGroup }): React.JSX.Element {
  const t = useT()
  const locale = useLocale()
  const [open, setOpen] = React.useState(false)
  const Icon = RUN_STATUS_ICON[group.status]

  if (group.runs.length === 1) {
    return <RunRow run={group.runs[0]!} />
  }

  return (
    <div className="rounded-md border border-border">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-small transition-colors duration-(--dur-micro) hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronRight
          aria-hidden="true"
          className={cn(
            'size-4 shrink-0 text-muted-foreground transition-transform duration-(--dur-micro) ease-(--ease-standard)',
            open && 'rotate-90',
          )}
        />
        <Badge tone="neutral" className={cn('shrink-0', RUN_STATUS_CLASS[group.status])}>
          <Icon className="size-3" aria-hidden="true" />
          {t(RUN_STATUS_LABEL_KEY[group.status])}
        </Badge>
        <span className="min-w-0 flex-1 truncate text-foreground">{group.ruleName}</span>
        <span className="shrink-0 text-caption text-muted-foreground">
          {t('automations.run.batch', { count: group.runs.length })}
        </span>
        <span className="shrink-0 text-caption tabular-nums text-muted-foreground">
          {formatDateTime(new Date(group.at), locale)}
        </span>
      </button>
      {open ? (
        <div className="flex flex-col gap-0.5 border-t border-border p-1">
          {group.runs.map((run) => (
            <RunRow key={run.id} run={run} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function RunRow({ run }: { run: AutomationRun }): React.JSX.Element {
  const t = useT()
  const locale = useLocale()
  const Icon = RUN_STATUS_ICON[run.status]
  return (
    <div className="flex items-start gap-2 rounded-md px-2 py-1.5 text-small hover:bg-muted/60">
      <Badge tone="neutral" className={cn('shrink-0', RUN_STATUS_CLASS[run.status])}>
        <Icon className="size-3" aria-hidden="true" />
        {t(RUN_STATUS_LABEL_KEY[run.status])}
      </Badge>
      <div className="min-w-0 flex-1">
        <p className="truncate text-foreground">
          {run.ruleName}
          {run.cardTitle ? (
            <>
              {' · '}
              {run.cardId ? (
                <button
                  type="button"
                  onClick={() => replaceSearchParam('card', run.cardId!)}
                  className="hover:underline"
                >
                  {run.cardTitle}
                </button>
              ) : (
                run.cardTitle
              )}
            </>
          ) : null}
        </p>
        {/* The detail arrives machine-readable (action keys, a reason key) and is translated here --
            never prose the server wrote in one language. */}
        <p className="truncate text-caption text-muted-foreground">
          {run.detail.error
            ? run.detail.error
            : run.detail.reason
              ? t(RUN_REASON_KEY[run.detail.reason] ?? 'automations.run.reason.other')
              : (run.detail.actions ?? [])
                  .map((kind) => {
                    const key = ACTION_LABEL_KEY[kind as keyof typeof ACTION_LABEL_KEY]
                    return key ? t(key) : kind
                  })
                  .join(', ')}
        </p>
      </div>
      <span className="shrink-0 text-caption tabular-nums text-muted-foreground">
        {formatDateTime(new Date(run.at), locale)}
      </span>
    </div>
  )
}

export default function AutomationsScreen(): React.JSX.Element {
  const t = useT()
  const { department } = useDepartment()
  const isHead = department?.role === 'head'

  const rulesQuery = useAutomationRulesQuery(isHead)
  const runsQuery = useAutomationRunsQuery({ limit: 50 }, isHead)
  const members = useMembers()
  const labels = useLabelsQuery().data ?? []
  const createRule = useCreateRuleMutation()
  const patchRule = usePatchRuleMutation()
  const deleteRule = useDeleteRuleMutation()
  const pauseAll = usePauseAllMutation()

  const [builderOpen, setBuilderOpen] = React.useState(false)
  const [pending, setPending] = React.useState<string | null>(null)
  // SEV2 #9: `null` = create; a rule = edit it; a `{ draft }` = duplicate it (a new rule, seeded).
  const [builderRule, setBuilderRule] = React.useState<AutomationRule | null>(null)
  const [builderSeed, setBuilderSeed] = React.useState<AutomationRuleBody | null>(null)
  // SEV2 #9: the run log's own filters and paging.
  const [runRuleFilter, setRunRuleFilter] = React.useState<'all' | string>('all')
  const [runStatusFilter, setRunStatusFilter] = React.useState<'all' | AutomationRun['status']>(
    'all',
  )
  const [runPage, setRunPage] = React.useState(0)
  React.useEffect(() => setRunPage(0), [runRuleFilter, runStatusFilter])

  // SPEC §2.2: a member has no business here, and the server agrees -- so they get the designed
  // no-permission state rather than an empty list or a raw 403.
  if (!isHead) {
    // SEV2 #17: the /people/table treatment -- no page header pretending this screen is theirs,
    // what it is, who to ask, and one alternative worth taking.
    return (
      <StateView
        kind="forbidden"
        titleKey="state.denied.title"
        bodyKey="automations.forbiddenBody"
        action={{ labelKey: 'automations.forbiddenAction', onAction: () => navigate('/work') }}
      />
    )
  }

  const rules = rulesQuery.data ?? []
  const atLimit = rules.filter((r) => r.enabled).length >= AUTOMATION_MAX_RULES

  function closeBuilder(): void {
    setBuilderOpen(false)
    setBuilderRule(null)
    setBuilderSeed(null)
  }

  /** SEV2 #9: one submit handler for all three ways into the builder. Editing patches the rule in
   * place (keeping its id, and therefore its run history); creating and duplicating both create. */
  function submitRule(body: AutomationRuleBody): void {
    if (builderRule) {
      patchRule.mutate(
        {
          id: builderRule.id,
          patch: {
            name: body.name,
            triggerConfig: body.triggerConfig,
            actions: body.actions,
            enabled: body.enabled,
            version: builderRule.version,
          },
        },
        {
          onSuccess: () => {
            closeBuilder()
            toast.success(t('automations.saved'))
          },
          onError: () => toast.error(t('automations.saveFailed')),
        },
      )
      return
    }
    createRule.mutate(body, {
      onSuccess: () => {
        closeBuilder()
        toast.success(t('automations.created'))
      },
      onError: () => toast.error(t('automations.createFailed')),
    })
  }

  function toggle(rule: AutomationRule, enabled: boolean): void {
    setPending(rule.id)
    patchRule.mutate(
      { id: rule.id, patch: { enabled, version: rule.version } },
      {
        onSettled: () => setPending(null),
        onError: () => toast.error(t('automations.toggleFailed')),
      },
    )
  }

  function remove(rule: AutomationRule): void {
    setPending(rule.id)
    deleteRule.mutate(rule.id, {
      onSettled: () => setPending(null),
      onSuccess: () => {
        // Undo over confirm: the rule's whole body is still in hand, so putting it back is one
        // create away. The recreated rule gets a new id and an empty run history, which is honest.
        toastWithUndo({
          message: t('automations.deleted', { name: rule.name }),
          undoLabel: t('action.undo'),
          onUndo: () =>
            createRule.mutate({
              name: rule.name,
              trigger: rule.trigger,
              triggerConfig: rule.triggerConfig,
              actions: rule.actions,
              enabled: rule.enabled,
            }),
        })
      },
      onError: () => toast.error(t('automations.deleteFailed')),
    })
  }

  let rulesBody: React.ReactNode
  if (rulesQuery.isPending) {
    rulesBody = (
      <div className="grid gap-3 lg:grid-cols-2" aria-busy="true">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-36 w-full" />
        ))}
      </div>
    )
  } else if (rulesQuery.isError) {
    rulesBody = (
      <StateView
        kind="error"
        titleKey="state.error.title"
        bodyKey="state.error.body"
        action={{ labelKey: 'state.error.action', onAction: () => void rulesQuery.refetch() }}
      />
    )
  } else if (rules.length === 0) {
    rulesBody = (
      <StateView
        kind="empty"
        titleKey="automations.emptyTitle"
        bodyKey="automations.emptyBody"
        action={{ labelKey: 'automations.create', onAction: () => setBuilderOpen(true) }}
      />
    )
  } else {
    rulesBody = (
      <AnimatePresence initial={false}>
        <Stagger className="grid gap-3 lg:grid-cols-2" animateKey={`rules-${rules.length}`}>
          {rules.map((rule) => (
            <StaggerItem key={rule.id} exit="hidden" layout className="h-full min-w-0">
              <RuleCard
                rule={rule}
                busy={pending === rule.id}
                onToggle={(enabled) => toggle(rule, enabled)}
                onDelete={() => remove(rule)}
                onEdit={() => {
                  setBuilderRule(rule)
                  setBuilderSeed(null)
                  setBuilderOpen(true)
                }}
                onDuplicate={() => {
                  setBuilderRule(null)
                  setBuilderSeed({
                    name: t('automations.rule.copyOf', { name: rule.name }),
                    trigger: rule.trigger,
                    triggerConfig: rule.triggerConfig,
                    actions: rule.actions,
                    // A copy starts switched off: a rule that began firing the moment it was
                    // duplicated would be the automations feature's worst first impression.
                    enabled: false,
                  })
                  setBuilderOpen(true)
                }}
              />
            </StaggerItem>
          ))}
        </Stagger>
      </AnimatePresence>
    )
  }

  const runs = runsQuery.data?.items ?? []
  // The filter's real total, from the server -- see the count line below.
  const runTotal = runsQuery.data?.total ?? runs.length
  // SEV2 #9: filter, then group, then page. Grouping after filtering is what makes "show me only the
  // failures" collapse to the handful of batches that actually failed instead of to nothing.
  const filteredRuns = runs.filter((run) => {
    if (runRuleFilter !== 'all' && run.ruleId !== runRuleFilter) return false
    if (runStatusFilter !== 'all' && run.status !== runStatusFilter) return false
    return true
  })
  const runGroups = groupRuns(filteredRuns)
  const runPageCount = Math.max(1, Math.ceil(runGroups.length / RUN_PAGE_SIZE))
  const safeRunPage = Math.min(runPage, runPageCount - 1)
  const shownGroups = runGroups.slice(
    safeRunPage * RUN_PAGE_SIZE,
    safeRunPage * RUN_PAGE_SIZE + RUN_PAGE_SIZE,
  )

  let runsBody: React.ReactNode
  if (runsQuery.isPending) {
    runsBody = (
      // SEV2 #12: the run log had no skeleton of its own shape at all. Badge, line, timestamp.
      <div className="flex flex-col gap-1" aria-busy="true">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="flex items-center gap-2 px-2 py-1.5">
            <Skeleton className="h-5 w-20 shrink-0 rounded-full" />
            <Skeleton className="h-4 flex-1 rounded-sm" />
            <Skeleton className="h-4 w-24 shrink-0 rounded-sm" />
          </div>
        ))}
      </div>
    )
  } else if (runsQuery.isError) {
    runsBody = (
      <StateView
        kind="error"
        compact
        titleKey="state.error.title"
        bodyKey="state.error.body"
        action={{ labelKey: 'state.error.action', onAction: () => void runsQuery.refetch() }}
      />
    )
  } else if (runs.length === 0) {
    runsBody = (
      <StateView
        kind="empty"
        compact
        titleKey="automations.runsEmptyTitle"
        bodyKey="automations.runsEmptyBody"
      />
    )
  } else if (runGroups.length === 0) {
    runsBody = (
      <StateView
        kind="empty"
        compact
        titleKey="automations.runsFilteredTitle"
        bodyKey="automations.runsFilteredBody"
        action={{
          labelKey: 'automations.runsClearFilters',
          onAction: () => {
            setRunRuleFilter('all')
            setRunStatusFilter('all')
          },
        }}
      />
    )
  } else {
    runsBody = (
      // SEV2 #12: the 79-row log had no motion at all. Stagger, re-keyed on the filter so a
      // narrowed list visibly re-enters rather than silently swapping underneath the reader.
      <Stagger
        className="flex flex-col gap-0.5"
        animateKey={`${runRuleFilter}|${runStatusFilter}|${safeRunPage}`}
      >
        {shownGroups.map((group) => (
          <StaggerItem key={group.key}>
            <RunGroupRow group={group} />
          </StaggerItem>
        ))}
      </Stagger>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        eyebrow={t('automations.eyebrow')}
        title={t('automations.title')}
        description={t('automations.description')}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {/* The kill switch. One click, every rule off -- the control a head needs before they
                will trust any of this with a department's work. */}
            <Button
              variant="secondary"
              loading={pauseAll.isPending}
              onClick={() =>
                pauseAll.mutate(undefined, {
                  onSuccess: (result) =>
                    toast.success(t('automations.pausedAll', { count: result.changed })),
                  onError: () => toast.error(t('automations.pauseFailed')),
                })
              }
            >
              <Pause className="size-4" aria-hidden="true" />
              {t('automations.pauseAll')}
            </Button>
            <Button onClick={() => setBuilderOpen(true)} disabled={atLimit}>
              <Plus className="size-4" aria-hidden="true" />
              {t('automations.create')}
            </Button>
          </div>
        }
      />

      {atLimit ? (
        <p
          role="status"
          className="rounded-md border border-border bg-muted/40 px-3 py-2 text-small text-muted-foreground"
        >
          {t('automations.atLimit', { max: AUTOMATION_MAX_RULES })}
        </p>
      ) : null}

      {rulesBody}

      <SectionCard
        title={t('automations.runsTitle')}
        description={t('automations.runsDescription')}
      >
        <div className="flex flex-col gap-3">
          {/* SEV2 #9: filters by rule and by outcome, above the list. Client-side over the loaded
              window -- the endpoint already returns the department's recent runs, and narrowing them
              here is instant and costs no request. */}
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label htmlFor="runs-rule" className="text-caption text-muted-foreground">
                {t('automations.runsFilter.rule')}
              </label>
              <select
                id="runs-rule"
                className={RUN_FILTER_CLASS}
                value={runRuleFilter}
                onChange={(e) => setRunRuleFilter(e.target.value)}
              >
                <option value="all">{t('automations.runsFilter.allRules')}</option>
                {rules.map((rule) => (
                  <option key={rule.id} value={rule.id}>
                    {rule.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="runs-status" className="text-caption text-muted-foreground">
                {t('automations.runsFilter.status')}
              </label>
              <select
                id="runs-status"
                className={RUN_FILTER_CLASS}
                value={runStatusFilter}
                onChange={(e) =>
                  setRunStatusFilter(e.target.value as 'all' | AutomationRun['status'])
                }
              >
                <option value="all">{t('automations.runsFilter.allStatuses')}</option>
                {RUN_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {t(RUN_STATUS_LABEL_KEY[status])}
                  </option>
                ))}
              </select>
            </div>
            <p
              className="ml-auto pb-2 text-caption tabular-nums text-muted-foreground"
              role="status"
            >
              {/* v1.1 recapture §1a #9. This line used to read "1 ta guruh · 50 ta ishga tushish"
                  under a rule card that said "79 marta ishlagan" -- it was counting the rows the
                  page had been handed. The server now returns the filter's real total, so the log
                  says how much of it is on screen when that is less than all of it, and says the
                  plain count when the whole log fits. A number a head can check against the card
                  above it, either way. */}
              {runTotal > filteredRuns.length &&
              runRuleFilter === 'all' &&
              runStatusFilter === 'all'
                ? t('automations.runsFilter.countOf', {
                    groups: runGroups.length,
                    runs: filteredRuns.length,
                    total: runTotal,
                  })
                : t('automations.runsFilter.count', {
                    groups: runGroups.length,
                    runs: filteredRuns.length,
                  })}
            </p>
          </div>

          {runsBody}

          {runPageCount > 1 ? (
            <div className="flex items-center justify-between gap-3">
              <Button
                variant="ghost"
                size="sm"
                disabled={safeRunPage === 0}
                onClick={() => setRunPage((prev) => Math.max(0, prev - 1))}
              >
                {t('automations.runsPage.previous')}
              </Button>
              <p className="text-caption tabular-nums text-muted-foreground" role="status">
                {t('automations.runsPage.of', {
                  page: safeRunPage + 1,
                  pages: runPageCount,
                })}
              </p>
              <Button
                variant="ghost"
                size="sm"
                disabled={safeRunPage >= runPageCount - 1}
                onClick={() => setRunPage((prev) => Math.min(runPageCount - 1, prev + 1))}
              >
                {t('automations.runsPage.next')}
              </Button>
            </div>
          ) : null}
        </div>
      </SectionCard>

      <Dialog
        open={builderOpen}
        onOpenChange={(next) => {
          if (next) setBuilderOpen(true)
          else closeBuilder()
        }}
      >
        <DialogContent
          title={builderRule ? t('automations.editTitle') : t('automations.newTitle')}
          className="max-w-2xl"
        >
          <RuleBuilder
            // Remounts when the rule being edited changes, so the form is seeded from that rule
            // rather than keeping whatever the previous one left in its state.
            key={builderRule?.id ?? (builderSeed ? `copy-${builderSeed.name}` : 'new')}
            members={members}
            labels={labels}
            {...(builderRule
              ? {
                  initial: {
                    name: builderRule.name,
                    trigger: builderRule.trigger,
                    triggerConfig: builderRule.triggerConfig,
                    actions: builderRule.actions,
                    enabled: builderRule.enabled,
                  },
                }
              : builderSeed
                ? { initial: builderSeed }
                : {})}
            submitLabel={builderRule ? t('automations.save') : t('automations.create')}
            busy={builderRule ? patchRule.isPending : createRule.isPending}
            onSubmit={submitRule}
            onCancel={closeBuilder}
          />
        </DialogContent>
      </Dialog>
    </div>
  )
}
