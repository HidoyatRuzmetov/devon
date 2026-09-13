// EPIC-017 -- the rule builder: "when X happens, do Y".
//
// One sentence, built left to right, because that is how a head describes the rule out loud. The
// trigger is chosen first and it *narrows the action list* -- `ACTIONS_FOR_TRIGGER` from
// `@devon/contracts` is the same table the API refuses a nonsense rule with, so the builder can
// never offer a combination the server then rejects. (The one excluded pair is "when the status
// changes → set the status", which would be a head starting a ping-pong with themselves; the loop
// guard would stop it, but refusing it up front is kinder than a rule that silently never runs
// twice.)
import * as React from 'react'
import { Plus, Trash2 } from 'lucide-react'
import {
  ACTIONS_FOR_TRIGGER,
  AUTOMATION_ACTION_KINDS,
  AUTOMATION_TRIGGERS,
  automationRuleBodySchema,
  type AutomationAction,
  type AutomationActionKind,
  type AutomationRuleBody,
  type AutomationTrigger,
  type AutomationTriggerConfig,
} from '@devon/contracts'
import { useT } from '@devon/i18n'
import { Button, Field, IconButton, Input, Select, Textarea, toast } from '@devon/ui'
import { PRIORITY_LABEL_KEY, STATUS_LABEL_KEY } from '../../work/lib/format.js'
import type { Label, MemberSummary } from '../../work/api.js'

export const TRIGGER_LABEL_KEY: Record<AutomationTrigger, string> = {
  card_created: 'automations.trigger.cardCreated',
  card_status_changed: 'automations.trigger.cardStatusChanged',
  card_assigned: 'automations.trigger.cardAssigned',
  card_due_soon: 'automations.trigger.cardDueSoon',
  card_overdue: 'automations.trigger.cardOverdue',
  card_field_changed: 'automations.trigger.cardFieldChanged',
}

export const ACTION_LABEL_KEY: Record<AutomationActionKind, string> = {
  assign: 'automations.action.assign',
  set_priority: 'automations.action.setPriority',
  add_label: 'automations.action.addLabel',
  notify_user: 'automations.action.notifyUser',
  notify_head: 'automations.action.notifyHead',
  set_status: 'automations.action.setStatus',
  add_checklist: 'automations.action.addChecklist',
  create_followup: 'automations.action.createFollowup',
}

const PRIORITIES = ['none', 'low', 'medium', 'high', 'urgent'] as const
const STATUSES = ['active', 'done', 'archived'] as const
const FIELDS = ['priority', 'labels', 'dueAt', 'estimate'] as const

/** Static, like every other label map here: `t()` has no fallback, so a key built by interpolation
 * renders as `<key>` on screen the day the enum grows. */
const FIELD_LABEL_KEY: Record<(typeof FIELDS)[number], string> = {
  priority: 'automations.builder.field.priority',
  labels: 'automations.builder.field.labels',
  dueAt: 'automations.builder.field.dueAt',
  estimate: 'automations.builder.field.estimate',
}

function defaultAction(kind: AutomationActionKind): AutomationAction {
  switch (kind) {
    case 'set_priority':
      return { kind, priority: 'high' }
    case 'set_status':
      return { kind, status: 'done' }
    case 'add_checklist':
      return { kind, checklist: [''] }
    case 'create_followup':
      return { kind, title: '', dueInDays: 7 }
    default:
      return { kind }
  }
}

function ActionRow({
  action,
  trigger,
  members,
  labels,
  onChange,
  onRemove,
  canRemove,
}: {
  action: AutomationAction
  trigger: AutomationTrigger
  members: readonly MemberSummary[]
  labels: readonly Label[]
  onChange: (next: AutomationAction) => void
  onRemove: () => void
  canRemove: boolean
}): React.JSX.Element {
  const t = useT()
  const id = React.useId()
  const allowed = ACTIONS_FOR_TRIGGER[trigger]

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border bg-muted/30 p-3">
      <div className="flex items-end gap-2">
        <Field
          label={t('automations.builder.actionLabel')}
          htmlFor={`${id}-kind`}
          className="flex-1"
        >
          <Select
            id={`${id}-kind`}
            value={action.kind}
            onChange={(e) => onChange(defaultAction(e.target.value as AutomationActionKind))}
            options={AUTOMATION_ACTION_KINDS.filter((kind) => allowed.includes(kind)).map(
              (kind) => ({ value: kind, label: t(ACTION_LABEL_KEY[kind]) }),
            )}
          />
        </Field>
        {canRemove ? (
          <IconButton aria-label={t('automations.builder.removeAction')} onClick={onRemove}>
            <Trash2 className="size-4" aria-hidden="true" />
          </IconButton>
        ) : null}
      </div>

      {action.kind === 'assign' || action.kind === 'notify_user' ? (
        <Field label={t('automations.builder.whoLabel')} htmlFor={`${id}-user`}>
          <Select
            id={`${id}-user`}
            value={action.userId ?? ''}
            onChange={(e) => onChange({ ...action, userId: e.target.value || null })}
            options={[
              { value: '', label: t('automations.builder.choosePerson') },
              ...members.map((m) => ({
                value: m.userId,
                label: `${m.givenName} ${m.familyName}`,
              })),
            ]}
          />
        </Field>
      ) : null}

      {action.kind === 'set_priority' ? (
        <Field label={t('automations.builder.priorityLabel')} htmlFor={`${id}-priority`}>
          <Select
            id={`${id}-priority`}
            value={action.priority ?? 'high'}
            onChange={(e) =>
              onChange({ ...action, priority: e.target.value as (typeof PRIORITIES)[number] })
            }
            options={PRIORITIES.map((p) => ({ value: p, label: t(PRIORITY_LABEL_KEY[p]) }))}
          />
        </Field>
      ) : null}

      {action.kind === 'add_label' ? (
        <Field label={t('automations.builder.labelLabel')} htmlFor={`${id}-label`}>
          <Select
            id={`${id}-label`}
            value={action.labelId ?? ''}
            onChange={(e) => onChange({ ...action, labelId: e.target.value || null })}
            options={[
              { value: '', label: t('automations.builder.chooseLabel') },
              ...labels.map((l) => ({ value: l.id, label: l.name })),
            ]}
          />
        </Field>
      ) : null}

      {action.kind === 'set_status' ? (
        <Field label={t('automations.builder.statusLabel')} htmlFor={`${id}-status`}>
          <Select
            id={`${id}-status`}
            value={action.status ?? 'done'}
            onChange={(e) =>
              onChange({ ...action, status: e.target.value as (typeof STATUSES)[number] })
            }
            options={STATUSES.map((s) => ({ value: s, label: t(STATUS_LABEL_KEY[s]) }))}
          />
        </Field>
      ) : null}

      {action.kind === 'add_checklist' ? (
        <Field
          label={t('automations.builder.checklistLabel')}
          htmlFor={`${id}-checklist`}
          hint={t('automations.builder.checklistHint')}
        >
          <Textarea
            id={`${id}-checklist`}
            rows={3}
            value={(action.checklist ?? []).join('\n')}
            onChange={(e) =>
              onChange({
                ...action,
                checklist: e.target.value.split('\n').map((line) => line.trim()),
              })
            }
          />
        </Field>
      ) : null}

      {action.kind === 'create_followup' ? (
        <div className="flex flex-wrap items-end gap-3">
          <Field
            label={t('automations.builder.followupTitle')}
            htmlFor={`${id}-title`}
            className="min-w-[12rem] flex-1"
          >
            <Input
              id={`${id}-title`}
              value={action.title ?? ''}
              maxLength={300}
              onChange={(e) => onChange({ ...action, title: e.target.value })}
            />
          </Field>
          <Field label={t('automations.builder.followupDueInDays')} htmlFor={`${id}-due`}>
            <Input
              id={`${id}-due`}
              type="number"
              min={0}
              max={365}
              inputMode="numeric"
              className="w-24"
              value={action.dueInDays ?? 7}
              onChange={(e) => onChange({ ...action, dueInDays: Number(e.target.value) || 0 })}
            />
          </Field>
        </div>
      ) : null}
    </div>
  )
}

export interface RuleBuilderProps {
  members: readonly MemberSummary[]
  labels: readonly Label[]
  /** Pre-fills the form for an edit; omit to build a new rule. */
  initial?: AutomationRuleBody
  submitLabel: string
  busy?: boolean
  onSubmit: (body: AutomationRuleBody) => void
  onCancel: () => void
}

export function RuleBuilder({
  members,
  labels,
  initial,
  submitLabel,
  busy = false,
  onSubmit,
  onCancel,
}: RuleBuilderProps): React.JSX.Element {
  const t = useT()
  const [name, setName] = React.useState(initial?.name ?? '')
  const [trigger, setTrigger] = React.useState<AutomationTrigger>(
    initial?.trigger ?? 'card_created',
  )
  const [config, setConfig] = React.useState<AutomationTriggerConfig>(initial?.triggerConfig ?? {})
  const [actions, setActions] = React.useState<AutomationAction[]>(
    initial?.actions ? [...initial.actions] : [defaultAction('assign')],
  )

  /** Changing the trigger can make an already-chosen action illegal, so the list is filtered the
   * moment the trigger changes rather than at submit time -- the form never sits in a state the
   * server would refuse. */
  function changeTrigger(next: AutomationTrigger): void {
    setTrigger(next)
    setConfig({})
    setActions((prev) => {
      const kept = prev.filter((a) => ACTIONS_FOR_TRIGGER[next].includes(a.kind))
      return kept.length > 0 ? kept : [defaultAction(ACTIONS_FOR_TRIGGER[next][0]!)]
    })
  }

  function submit(e: React.FormEvent): void {
    e.preventDefault()
    const cleaned = actions.map((action) =>
      action.kind === 'add_checklist'
        ? { ...action, checklist: (action.checklist ?? []).filter((line) => line.length > 0) }
        : action,
    )
    const parsed = automationRuleBodySchema.safeParse({
      name: name.trim(),
      trigger,
      triggerConfig: config,
      actions: cleaned,
      enabled: true,
    })
    if (!parsed.success) {
      toast.error(t('automations.builder.invalid'))
      return
    }
    onSubmit(parsed.data)
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Field label={t('automations.builder.nameLabel')} htmlFor="rule-name">
        <Input
          id="rule-name"
          value={name}
          maxLength={120}
          required
          onChange={(e) => setName(e.target.value)}
          placeholder={t('automations.builder.namePlaceholder')}
        />
      </Field>

      <fieldset className="flex flex-col gap-3 rounded-md border border-border p-3">
        <legend className="px-1 text-caption font-semibold uppercase tracking-(--text-eyebrow--letter-spacing) text-muted-foreground">
          {t('automations.builder.whenLegend')}
        </legend>
        <Field label={t('automations.builder.triggerLabel')} htmlFor="rule-trigger">
          <Select
            id="rule-trigger"
            value={trigger}
            onChange={(e) => changeTrigger(e.target.value as AutomationTrigger)}
            options={AUTOMATION_TRIGGERS.map((tr) => ({
              value: tr,
              label: t(TRIGGER_LABEL_KEY[tr]),
            }))}
          />
        </Field>

        {trigger === 'card_status_changed' ? (
          <Field label={t('automations.builder.toStatusLabel')} htmlFor="rule-to-status">
            <Select
              id="rule-to-status"
              value={config.toStatus ?? ''}
              onChange={(e) =>
                setConfig((c) => ({
                  ...c,
                  toStatus: (e.target.value || null) as AutomationTriggerConfig['toStatus'],
                }))
              }
              options={[
                { value: '', label: t('automations.builder.anyStatus') },
                ...STATUSES.map((s) => ({ value: s, label: t(STATUS_LABEL_KEY[s]) })),
              ]}
            />
          </Field>
        ) : null}

        {trigger === 'card_due_soon' ? (
          <Field
            label={t('automations.builder.daysAheadLabel')}
            htmlFor="rule-days-ahead"
            hint={t('automations.builder.daysAheadHint')}
          >
            <Input
              id="rule-days-ahead"
              type="number"
              min={1}
              max={14}
              inputMode="numeric"
              className="w-24"
              value={config.daysAhead ?? 2}
              onChange={(e) =>
                setConfig((c) => ({
                  ...c,
                  daysAhead: Math.min(14, Math.max(1, Number(e.target.value) || 1)),
                }))
              }
            />
          </Field>
        ) : null}

        {trigger === 'card_field_changed' ? (
          <Field label={t('automations.builder.fieldLabel')} htmlFor="rule-field">
            <Select
              id="rule-field"
              value={config.field ?? 'priority'}
              onChange={(e) =>
                setConfig((c) => ({
                  ...c,
                  field: e.target.value as (typeof FIELDS)[number],
                }))
              }
              options={FIELDS.map((f) => ({ value: f, label: t(FIELD_LABEL_KEY[f]) }))}
            />
          </Field>
        ) : null}

        <Field
          label={t('automations.builder.filterLabel')}
          htmlFor="rule-filter"
          hint={t('automations.builder.filterHint')}
        >
          <Input
            id="rule-filter"
            value={config.filter ?? ''}
            maxLength={500}
            onChange={(e) => setConfig((c) => ({ ...c, filter: e.target.value || null }))}
            placeholder={t('automations.builder.filterPlaceholder')}
          />
        </Field>
      </fieldset>

      <fieldset className="flex flex-col gap-3 rounded-md border border-border p-3">
        <legend className="px-1 text-caption font-semibold uppercase tracking-(--text-eyebrow--letter-spacing) text-muted-foreground">
          {t('automations.builder.thenLegend')}
        </legend>
        {actions.map((action, index) => (
          <ActionRow
            key={index}
            action={action}
            trigger={trigger}
            members={members}
            labels={labels}
            canRemove={actions.length > 1}
            onChange={(next) => setActions((prev) => prev.map((a, i) => (i === index ? next : a)))}
            onRemove={() => setActions((prev) => prev.filter((_, i) => i !== index))}
          />
        ))}
        {/* Five is the ceiling the contract states; the button says so instead of silently
            vanishing. */}
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="self-start"
          disabled={actions.length >= 5}
          onClick={() =>
            setActions((prev) => [...prev, defaultAction(ACTIONS_FOR_TRIGGER[trigger][0]!)])
          }
        >
          <Plus className="size-4" aria-hidden="true" />
          {actions.length >= 5
            ? t('automations.builder.actionLimit')
            : t('automations.builder.addAction')}
        </Button>
      </fieldset>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" loading={busy} disabled={name.trim().length === 0}>
          {submitLabel}
        </Button>
      </div>
    </form>
  )
}
