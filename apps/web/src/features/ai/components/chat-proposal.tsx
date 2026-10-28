import type { AiChatAttachment, AiChatProposal, AiChatSource } from '@devon/contracts'
import { useLocale, useT } from '@devon/i18n'
import { Button, Checkbox, IconButton, Textarea, cn } from '@devon/ui'
import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronUp,
  Circle,
  FileCheck2,
  LoaderCircle,
  Pencil,
} from 'lucide-react'
import * as React from 'react'
import { ApiError } from '../../../lib/api-client.js'
import { RouterLink } from '../../../lib/router.js'
import { chatSourceHref } from '../chat-source-href.js'
import {
  useConversationProposalMutation,
  useEditProposalMutation,
  useProposalBatchMutation,
} from '../conversations.js'

const fieldKeys = new Set([
  'id',
  'title',
  'description',
  'body',
  'blocks',
  'text',
  'assigneeUserId',
  'giverUserId',
  'ownerUserId',
  'members',
  'projectId',
  'projectScope',
  'status',
  'workStage',
  'priority',
  'startAt',
  'dueAt',
  'startOn',
  'targetOn',
  'dueOn',
  'done',
  'version',
  'attachmentIds',
  'targetType',
  'targetId',
  'itemId',
  'milestoneId',
  'milestones',
  'kind',
  'notes',
  'parentId',
  'parentItemId',
  'estimateMin',
  'linkedCardId',
  'sort',
  'orderKey',
  'afterTaskId',
  'startsAt',
  'endsAt',
  'goal',
  'pinned',
  'labels',
  'watchers',
  'links',
  'url',
  'name',
  'colour',
  'coverKey',
  'mentions',
  'existingCardId',
  'create',
  'checklist',
  'recipientUserIds',
  'cycleId',
  'entryId',
  'state',
  'phase',
  'remindAt',
  'allDay',
  'parentKey',
  'key',
])
// Catalog action names are stable backend identifiers; presentation keys follow our locale naming.
const personalKindKeys: Partial<Record<AiChatProposal['kind'], string>> = {
  'card.withChecklist': 'assistantBatch.kinds.card_withChecklist',
  'card.assignMany': 'assistantBatch.kinds.card_assignMany',
  'checkin.add': 'assistantBatch.kinds.checkin_add',
  'checkin.update': 'assistantBatch.kinds.checkin_update',
  'checkin.remove': 'assistantBatch.kinds.checkin_remove',
  'checkin.lock': 'assistantBatch.kinds.checkin_lock',
  'personal.calendar.create': 'assistantBatch.kinds.personal_calendar_create',
  'personal.calendar.update': 'assistantBatch.kinds.personal_calendar_update',
  'personal.calendar.delete': 'assistantBatch.kinds.personal_calendar_delete',
  'personal.task.create': 'assistantActions.kinds.personalTaskCreate',
  'personal.task.update': 'assistantActions.kinds.personalTaskUpdate',
}
function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

/** The approval body is rendered from the validated operation arguments, not the model's summary.
 * Page content stays inert; a link in a proposed page is shown with its URL without navigation. */
function DocumentNode({
  node,
  sources,
}: {
  node: unknown
  sources: AiChatSource[]
}): React.ReactNode {
  const t = useT()
  if (!isObject(node)) return null
  const content = Array.isArray(node['content'])
    ? node['content'].map((child, index) => (
        <DocumentNode key={index} node={child} sources={sources} />
      ))
    : null
  if (node['type'] === 'text') {
    let text: React.ReactNode = String(node['text'] ?? '')
    if (Array.isArray(node['marks']))
      for (const mark of node['marks']) {
        if (!isObject(mark)) continue
        if (mark['type'] === 'bold') text = <strong>{text}</strong>
        if (mark['type'] === 'italic') text = <em>{text}</em>
        if (mark['type'] === 'code') text = <code>{text}</code>
        if (mark['type'] === 'strike') text = <s>{text}</s>
        if (mark['type'] === 'underline') text = <u>{text}</u>
        if (mark['type'] === 'textSize' && isObject(mark['attrs'])) {
          const sizes: Record<string, string> = {
            small: 'text-caption',
            normal: 'text-small',
            large: 'text-body',
            xlarge: 'text-h3',
          }
          text = (
            <span className={sizes[String(mark['attrs']['size'])] ?? 'text-small'}>{text}</span>
          )
        }
        if (mark['type'] === 'link' && isObject(mark['attrs']))
          text = (
            <span>
              {text}{' '}
              <span className="text-caption text-muted-foreground">
                ({String(mark['attrs']['href'] ?? '')})
              </span>
            </span>
          )
      }
    return text
  }
  switch (node['type']) {
    case 'doc':
      return <div className="space-y-2">{content}</div>
    case 'paragraph':
      return <p>{content}</p>
    case 'heading':
      return <p className="text-body font-semibold">{content}</p>
    case 'bulletList':
    case 'taskList':
      return <ul className="list-disc space-y-1 pl-5">{content}</ul>
    case 'orderedList':
      return <ol className="list-decimal space-y-1 pl-5">{content}</ol>
    case 'listItem':
      return <li>{content}</li>
    case 'taskItem':
      return (
        <li className="list-none">
          <span
            role="img"
            aria-label={t(
              isObject(node['attrs']) && node['attrs']['checked'] === true
                ? 'assistantActions.values.done'
                : 'assistantActions.values.todo',
            )}
          >
            {isObject(node['attrs']) && node['attrs']['checked'] === true ? '☑ ' : '☐ '}
          </span>
          {content}
        </li>
      )
    case 'callout':
      return <div className="rounded-md border-l-2 border-primary bg-primary/5 p-2">{content}</div>
    case 'mention': {
      const attrs = isObject(node['attrs']) ? node['attrs'] : {}
      const id = String(attrs['id'] ?? '')
      const source = id ? sources.find((item) => item.ref.endsWith(`:${id}`)) : undefined
      return (
        <span className="rounded-sm bg-primary/10 px-1 text-primary">
          @{source?.title ?? String(attrs['label'] ?? id)}
          {!source && id ? ` (${id})` : ''}
        </span>
      )
    }
    case 'blockquote':
      return <blockquote className="border-l-2 border-primary/30 pl-3">{content}</blockquote>
    case 'codeBlock':
      return (
        <pre className="whitespace-pre-wrap rounded-sm bg-muted p-2 font-mono text-caption">
          {content}
        </pre>
      )
    case 'hardBreak':
      return <br />
    case 'horizontalRule':
      return <hr className="border-border" />
    default:
      return <>{content}</>
  }
}

export function ProposalArguments({
  value,
  sources,
  attachments,
  conversationId,
  field = '',
}: {
  value: unknown
  sources: AiChatSource[]
  attachments: AiChatAttachment[]
  conversationId: string
  field?: string
}): React.ReactNode {
  const t = useT(),
    locale = useLocale()
  if (value === null)
    return <span className="text-muted-foreground">{t('assistantActions.clearValue')}</span>
  if (typeof value === 'boolean')
    return <span>{t(value ? 'assistantActions.yes' : 'assistantActions.no')}</span>
  if (typeof value === 'number') return <span className="tabular-nums">{value}</span>
  if (typeof value === 'string') {
    const source = sources.find((item) => item.ref.endsWith(`:${value}`))
    const attachment = attachments.find((item) => item.id === value)
    const href = source && chatSourceHref(source.href, conversationId)
    if (source && href)
      return (
        <RouterLink href={href} className="text-primary underline underline-offset-2">
          {source.title}
        </RouterLink>
      )
    if (attachment)
      return (
        <span className="inline-flex items-center gap-1">
          <FileCheck2 className="size-3.5 shrink-0" aria-hidden="true" />
          {attachment.name}
        </span>
      )
    if (/^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)))
      return (
        <time dateTime={value} title={value}>
          {new Intl.DateTimeFormat(locale, {
            dateStyle: 'medium',
            timeStyle: 'short',
            timeZone: 'Asia/Tashkent',
          }).format(new Date(value))}{' '}
          <span className="text-caption text-muted-foreground">
            {t('assistantActions.timezone')}
          </span>
        </time>
      )
    const key = ['status', 'workStage', 'priority', 'projectScope', 'targetType'].includes(field)
      ? `assistantActions.values.${value}`
      : null
    return (
      <span className="whitespace-pre-wrap [overflow-wrap:anywhere]">
        {key && t(key) !== key ? t(key) : value || t('assistantActions.emptyValue')}
      </span>
    )
  }
  if (Array.isArray(value))
    return value.length ? (
      <ul className="space-y-1">
        {value.map((item, index) => (
          <li key={index} className="border-l-2 border-border pl-2">
            <ProposalArguments
              value={item}
              sources={sources}
              attachments={attachments}
              conversationId={conversationId}
              field={field}
            />
          </li>
        ))}
      </ul>
    ) : (
      <span className="text-muted-foreground">{t('assistantActions.emptyList')}</span>
    )
  if (isObject(value) && value['type'] === 'doc')
    return (
      <div className="rounded-md border border-border bg-background p-3 text-small [overflow-wrap:anywhere]">
        <DocumentNode node={value} sources={sources} />
      </div>
    )
  if (isObject(value))
    return (
      <dl className="space-y-2">
        {Object.entries(value).map(([key, item]) => (
          <div
            key={key}
            className={
              key === 'body'
                ? ''
                : 'grid min-w-0 gap-0.5 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-3'
            }
          >
            {key !== 'body' ? (
              <dt className="text-caption font-medium text-muted-foreground">
                {fieldKeys.has(key)
                  ? t(
                      `${['existingCardId', 'create', 'checklist', 'recipientUserIds', 'cycleId', 'entryId', 'state', 'phase', 'remindAt', 'allDay', 'parentKey', 'key'].includes(key) ? 'assistantBatch.fields' : 'assistantActions.fields'}.${key}`,
                    )
                  : key.replaceAll(/([a-z])([A-Z])/g, '$1 $2')}
              </dt>
            ) : null}
            <dd className="min-w-0 text-small">
              <ProposalArguments
                value={item}
                sources={sources}
                attachments={attachments}
                conversationId={conversationId}
                field={key}
              />
            </dd>
          </div>
        ))}
      </dl>
    )
  return null
}

const editableTextFields = new Set([
  'title',
  'text',
  'description',
  'notes',
  'goal',
  'question',
  'label',
  'name',
  'url',
  'startAt',
  'dueAt',
  'startOn',
  'targetOn',
  'dueOn',
  'startsAt',
  'endsAt',
  'place',
  'location',
  'remindAt',
])
function fieldLabelKey(field: string) {
  return `${['existingCardId', 'create', 'checklist', 'recipientUserIds', 'cycleId', 'entryId', 'state', 'phase', 'remindAt', 'allDay', 'parentKey', 'key'].includes(field) ? 'assistantBatch.fields' : 'assistantActions.fields'}.${field}`
}

function ProposalEditor({
  value,
  onChange,
  sources,
  attachments,
  conversationId,
  field = '',
}: {
  value: unknown
  onChange: (next: unknown) => void
  sources: AiChatSource[]
  attachments: AiChatAttachment[]
  conversationId: string
  field?: string
}): React.ReactNode {
  const t = useT()
  if (typeof value === 'string' && editableTextFields.has(field))
    return (
      <Textarea
        aria-label={t(fieldLabelKey(field))}
        value={value}
        rows={value.length > 120 ? 3 : 1}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-9"
      />
    )
  if (typeof value === 'boolean')
    return (
      <Checkbox
        aria-label={t(fieldLabelKey(field))}
        checked={value}
        onCheckedChange={(checked) => onChange(checked === true)}
      />
    )
  const enums: Record<string, string[]> = {
    priority: ['none', 'low', 'medium', 'high', 'urgent'],
    workStage: ['todo', 'in_progress'],
    status: ['active', 'done', 'archived'],
    state: ['pending', 'done', 'blocked'],
  }
  if (typeof value === 'string' && enums[field])
    return (
      <select
        className="min-h-9 rounded-md border border-border bg-background px-2 text-small"
        aria-label={t(fieldLabelKey(field))}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {enums[field].map((v) => (
          <option key={v} value={v}>
            {t(field === 'state' ? 'checkins.state.' + v : 'assistantActions.values.' + v)}
          </option>
        ))}
      </select>
    )
  if (Array.isArray(value))
    return (
      <div className="space-y-2">
        {value.map((item, index) => (
          <div key={index} className="border-l-2 border-border pl-3">
            <ProposalEditor
              value={item}
              field={field}
              sources={sources}
              attachments={attachments}
              conversationId={conversationId}
              onChange={(next) => onChange(value.map((old, i) => (i === index ? next : old)))}
            />
          </div>
        ))}
      </div>
    )
  if (isObject(value))
    return (
      <div className="space-y-2">
        {Object.entries(value)
          .filter(([key]) => !['key', 'parentKey', 'version', 'orderKey'].includes(key))
          .map(([key, item]) => (
            <div key={key} className="grid gap-1">
              {!['body', 'create', 'task'].includes(key) ? (
                <span className="text-caption text-muted-foreground">{t(fieldLabelKey(key))}</span>
              ) : null}
              <ProposalEditor
                value={item}
                field={key}
                sources={sources}
                attachments={attachments}
                conversationId={conversationId}
                onChange={(next) => onChange({ ...value, [key]: next })}
              />
            </div>
          ))}
      </div>
    )
  return (
    <ProposalArguments
      value={value}
      field={field}
      sources={sources}
      attachments={attachments}
      conversationId={conversationId}
    />
  )
}

type ProposalDisplayProps = {
  proposal: AiChatProposal
  conversationId: string
  sources: AiChatSource[]
  attachments: AiChatAttachment[]
  dependencies: string[]
  dependencyBlocked: boolean
  disabled: boolean
  selected: boolean
  onSelected: (selected: boolean) => void
  onEditing: (editing: boolean) => void
  onEdit: (proposal: AiChatProposal) => void
}
function ProposalRow({
  proposal,
  conversationId,
  sources,
  attachments,
  dependencies,
  dependencyBlocked,
  disabled,
  selected,
  onSelected,
  onEditing,
  onEdit,
}: ProposalDisplayProps) {
  const t = useT(),
    edit = useEditProposalMutation(),
    discard = useConversationProposalMutation('discard')
  const [expanded, setExpanded] = React.useState(false),
    [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(proposal.arguments)
  const pending = proposal.status === 'pending',
    destructive = proposal.kind.endsWith('.delete')
  const body = isObject(proposal.arguments['body']) ? proposal.arguments['body'] : {}
  const nested = isObject(body['create'])
    ? body['create']
    : isObject(body['task'])
      ? body['task']
      : body
  const targetId = String(proposal.arguments['id'] ?? body['existingCardId'] ?? '')
  const target = sources.find((source) => targetId && source.ref.endsWith(':' + targetId))
  const primary = String(nested['title'] ?? body['text'] ?? target?.title ?? proposal.title)
  const kindKey = personalKindKeys[proposal.kind] ?? 'assistantActions.kinds.' + proposal.kind
  const kindLabel = t(kindKey)
  const changes = ['status', 'state', 'workStage', 'priority', 'done']
    .filter((key) => body[key] !== undefined)
    .map((key) =>
      key === 'done'
        ? t(body[key] ? 'assistantActions.values.done' : 'checkins.state.pending')
        : t((key === 'state' ? 'checkins.state.' : 'assistantActions.values.') + String(body[key])),
    )
  const resultHref = proposal.result && chatSourceHref(proposal.result.href, conversationId)
  function setEdit(value: boolean) {
    setEditing(value)
    onEditing(value)
  }
  return (
    <section
      className={cn('border-b border-border last:border-b-0', !selected && pending && 'opacity-65')}
    >
      <div className="flex items-start gap-2.5 px-3 py-2.5">
        <div className="pt-1">
          {pending ? (
            <Checkbox
              checked={selected}
              aria-label={t('assistantBatch.select', { title: proposal.title })}
              disabled={disabled || editing || dependencyBlocked}
              onCheckedChange={(v) => onSelected(v === true)}
            />
          ) : proposal.status === 'executing' ? (
            <LoaderCircle className="size-4 motion-safe:animate-spin text-primary" />
          ) : proposal.status === 'executed' ? (
            <Check className="size-4 text-success-text" />
          ) : (
            <Circle className="size-4 text-muted-foreground" />
          )}
        </div>
        <div className="min-w-0 flex-1 text-left">
          {target ? (
            <RouterLink
              href={chatSourceHref(target.href, conversationId)!}
              className="block text-small font-medium text-primary [overflow-wrap:anywhere]"
            >
              {primary}
            </RouterLink>
          ) : (
            <span
              className={cn(
                'block text-small font-medium [overflow-wrap:anywhere]',
                destructive && 'text-destructive',
              )}
            >
              {primary}
            </span>
          )}
          <span className="mt-0.5 block text-caption text-muted-foreground">
            {kindLabel === kindKey ? t('assistantBatch.change') : kindLabel}
            {' · '}
            {t(`assistantActions.status.${proposal.status}`)}
            {destructive ? ' · ' + t('assistantActions.deleteWarning') : ''}
          </span>
          {dependencies.length ? (
            <span className="mt-1 block text-caption text-muted-foreground">
              {t('assistantBatch.dependsOn', { title: dependencies.join(' · ') })}
            </span>
          ) : null}
          {changes.length ? (
            <span className="mt-1 block text-caption font-medium text-primary">
              {changes.join(' · ')}
            </span>
          ) : null}
          {Array.isArray(body['checklist']) && body['checklist'].length ? (
            <span className="mt-1 block text-caption text-muted-foreground">
              {t('assistantBatch.checklistCount', { count: body['checklist'].length })}
            </span>
          ) : null}
        </div>
        {pending ? (
          <IconButton
            aria-label={t('assistantActions.edit')}
            tooltip={t('assistantActions.edit')}
            disabled={disabled || edit.isPending}
            onClick={() => {
              setDraft(proposal.arguments)
              setExpanded(true)
              setEdit(!editing)
            }}
          >
            <Pencil />
          </IconButton>
        ) : null}
        <IconButton
          aria-label={t(expanded ? 'assistantBatch.hideDetails' : 'assistantBatch.details')}
          tooltip={t(expanded ? 'assistantBatch.hideDetails' : 'assistantBatch.details')}
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? <ChevronUp /> : <ChevronDown />}
        </IconButton>
      </div>
      {expanded ? (
        <div className="border-t border-border bg-muted/25 px-3 py-3 sm:pl-10">
          {editing ? (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                edit.mutate(
                  {
                    conversationId,
                    proposalId: proposal.id,
                    revision: proposal.revision ?? 0,
                    arguments: draft,
                  },
                  { onSuccess: () => setEdit(false) },
                )
              }}
            >
              <ProposalEditor
                value={draft}
                onChange={(v) => setDraft(v as Record<string, unknown>)}
                sources={sources}
                attachments={attachments}
                conversationId={conversationId}
              />
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" type="submit" disabled={edit.isPending}>
                  {t('assistantBatch.save')}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setEdit(false)}
                  disabled={edit.isPending}
                >
                  {t('assistantBatch.cancel')}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={edit.isPending || discard.isPending}
                  onClick={() =>
                    discard.mutate(
                      { conversationId, proposalId: proposal.id },
                      {
                        onSuccess: () => {
                          setEdit(false)
                          onEdit(proposal)
                        },
                      },
                    )
                  }
                >
                  {t('assistantBatch.askChange')}
                </Button>
              </div>
              {edit.isError ? (
                <p className="mt-2 text-caption text-destructive" role="alert">
                  {t('assistantBatch.editError')}
                </p>
              ) : null}
            </form>
          ) : (
            <ProposalArguments
              value={proposal.arguments}
              sources={sources}
              attachments={attachments}
              conversationId={conversationId}
            />
          )}
        </div>
      ) : null}
      {proposal.status === 'failed' ? (
        <p role="status" className="px-3 pb-2 text-caption text-destructive">
          {t(
            proposal.error === 'dependency_unavailable'
              ? 'assistantBatch.dependencyFailed'
              : proposal.error === 'attachment_failed'
                ? 'assistantActions.filePartial'
                : proposal.error === 'interrupted_action'
                  ? 'assistantActions.interruptedAction'
                  : 'assistantActions.persistedFailure',
          )}
        </p>
      ) : null}
      {resultHref ? (
        <RouterLink
          href={resultHref}
          className="mb-2 ml-10 inline-flex min-h-8 items-center gap-1.5 text-caption font-medium text-primary"
        >
          {t('assistantBatch.openResult')}
          <ArrowRight className="size-3.5" />
        </RouterLink>
      ) : null}
    </section>
  )
}

export function ChatProposalBatch({
  proposals,
  messageId,
  conversationId,
  sources,
  attachments,
  onEdit,
  disabled,
}: {
  proposals: AiChatProposal[]
  messageId: string
  conversationId: string
  sources: AiChatSource[]
  attachments: AiChatAttachment[]
  onEdit: (proposal: AiChatProposal) => void
  disabled: boolean
}) {
  const t = useT(),
    batch = useProposalBatchMutation()
  const [excluded, setExcluded] = React.useState<Set<string>>(new Set()),
    [editingIds, setEditingIds] = React.useState<Set<string>>(new Set())
  const pending = proposals.filter((p) => p.status === 'pending')
  const selectedIds = new Set<string>(),
    availableKeys = new Set<string>(),
    blockedIds = new Set<string>()
  const byKey = new Map(proposals.filter((p) => p.key).map((p) => [p.key!, p]))
  for (const proposal of proposals) {
    const depsReady = (proposal.bindings ?? []).every((b) => availableKeys.has(b.from))
    if (!depsReady) blockedIds.add(proposal.id)
    if (
      proposal.status === 'executed' ||
      (proposal.status === 'pending' && !excluded.has(proposal.id) && depsReady)
    ) {
      if (proposal.key) availableKeys.add(proposal.key)
      if (proposal.status === 'pending') selectedIds.add(proposal.id)
    }
  }
  const selected = pending.filter((p) => selectedIds.has(p.id))
  const busy = disabled || batch.isPending || proposals.some((p) => p.status === 'executing')
  function mark(
    setter: React.Dispatch<React.SetStateAction<Set<string>>>,
    id: string,
    on: boolean,
  ) {
    setter((old) => {
      const next = new Set(old)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  }
  return (
    <div
      className="mt-3 overflow-hidden rounded-lg border border-primary/20 bg-background"
      aria-label={t('assistantBatch.review')}
    >
      {proposals.map((proposal) => (
        <ProposalRow
          key={`${proposal.id}:${proposal.revision ?? 0}:${proposal.status}`}
          proposal={proposal}
          conversationId={conversationId}
          sources={sources}
          attachments={attachments}
          disabled={busy}
          dependencies={[
            ...new Set((proposal.bindings ?? []).map((b) => byKey.get(b.from)?.title ?? b.from)),
          ]}
          dependencyBlocked={blockedIds.has(proposal.id)}
          selected={selectedIds.has(proposal.id)}
          onSelected={(value) => mark(setExcluded, proposal.id, !value)}
          onEditing={(value) =>
            mark(setEditingIds, `${proposal.id}:${proposal.revision ?? 0}`, value)
          }
          onEdit={onEdit}
        />
      ))}
      {pending.length ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-3">
          <p className="text-caption text-muted-foreground">
            {t('assistantBatch.selected', { selected: selected.length, total: pending.length })}
          </p>
          <Button
            size="sm"
            disabled={busy || pending.some((p) => editingIds.has(`${p.id}:${p.revision ?? 0}`))}
            onClick={() =>
              batch.mutate({
                conversationId,
                messageId,
                proposals: pending.map((p) => ({
                  id: p.id,
                  revision: p.revision ?? 0,
                  selected: selectedIds.has(p.id),
                })),
              })
            }
          >
            {batch.isPending ? (
              <LoaderCircle className="size-4 motion-safe:animate-spin" />
            ) : (
              <Check className="size-4" />
            )}
            {t(selected.length ? 'assistantBatch.confirm' : 'assistantBatch.discardAll')}
          </Button>
          <p className="w-full text-caption text-muted-foreground">
            {t('assistantBatch.unselected')}
          </p>
        </div>
      ) : null}
      {batch.isError ? (
        <p role="alert" className="px-3 pb-3 text-caption text-destructive">
          {t(
            batch.error instanceof ApiError && batch.error.status === 409
              ? 'assistantActions.conflict'
              : 'assistantActions.failed',
          )}
        </p>
      ) : null}
    </div>
  )
}
