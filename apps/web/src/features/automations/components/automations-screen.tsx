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
import { AlertTriangle, Check, CircleSlash, Pause, Plus, Trash2, Zap } from 'lucide-react'
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
import { replaceSearchParam } from '../../../lib/router.js'
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

function RuleCard({
  rule,
  onToggle,
  onDelete,
  busy,
}: {
  rule: AutomationRule
  onToggle: (enabled: boolean) => void
  onDelete: () => void
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
          aria-label={t('automations.rule.delete', { name: rule.name })}
          onClick={onDelete}
          disabled={busy}
        >
          <Trash2 className="size-4" aria-hidden="true" />
        </IconButton>
      </div>

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

  // SPEC §2.2: a member has no business here, and the server agrees -- so they get the designed
  // no-permission state rather than an empty list or a raw 403.
  if (!isHead) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader
          eyebrow={t('automations.eyebrow')}
          title={t('automations.title')}
          description={t('automations.description')}
        />
        <StateView
          kind="forbidden"
          titleKey="automations.forbiddenTitle"
          bodyKey="automations.forbiddenBody"
        />
      </div>
    )
  }

  const rules = rulesQuery.data ?? []
  const atLimit = rules.filter((r) => r.enabled).length >= AUTOMATION_MAX_RULES

  function create(body: AutomationRuleBody): void {
    createRule.mutate(body, {
      onSuccess: () => {
        setBuilderOpen(false)
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
            <StaggerItem key={rule.id} exit="hidden" layout className="h-full">
              <RuleCard
                rule={rule}
                busy={pending === rule.id}
                onToggle={(enabled) => toggle(rule, enabled)}
                onDelete={() => remove(rule)}
              />
            </StaggerItem>
          ))}
        </Stagger>
      </AnimatePresence>
    )
  }

  const runs = runsQuery.data?.items ?? []
  let runsBody: React.ReactNode
  if (runsQuery.isPending) {
    runsBody = (
      <div className="flex flex-col gap-1" aria-busy="true">
        {[1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-10 w-full" />
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
  } else {
    runsBody = (
      <div className="flex flex-col gap-0.5">
        {runs.map((run) => (
          <RunRow key={run.id} run={run} />
        ))}
      </div>
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
        {runsBody}
      </SectionCard>

      <Dialog open={builderOpen} onOpenChange={setBuilderOpen}>
        <DialogContent title={t('automations.newTitle')} className="max-w-2xl">
          <RuleBuilder
            members={members}
            labels={labels}
            submitLabel={t('automations.create')}
            busy={createRule.isPending}
            onSubmit={create}
            onCancel={() => setBuilderOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </div>
  )
}
