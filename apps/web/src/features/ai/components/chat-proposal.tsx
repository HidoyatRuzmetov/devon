import * as React from 'react'
import type { AiChatAttachment, AiChatProposal, AiChatSource } from '@devon/contracts'
import { useT, useLocale } from '@devon/i18n'
import { Button, cn } from '@devon/ui'
import {
  ArrowRight,
  Check,
  FileCheck2,
  LoaderCircle,
  Pencil,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react'
import { RouterLink } from '../../../lib/router.js'
import { useConversationProposalMutation } from '../conversations.js'
import { chatSourceHref } from '../chat-source-href.js'
import { ApiError } from '../../../lib/api-client.js'

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
  'sprintId',
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
])
// Catalog action names are stable backend identifiers; presentation keys follow our locale naming.
const personalKindKeys: Partial<Record<AiChatProposal['kind'], string>> = {
  'personal.task.create': 'assistantActions.kinds.personalTaskCreate',
  'personal.task.update': 'assistantActions.kinds.personalTaskUpdate',
  'personal.sprint.create': 'assistantActions.kinds.personalPeriodCreate',
  'personal.sprint.update': 'assistantActions.kinds.personalPeriodUpdate',
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
                  ? t(`assistantActions.fields.${key}`)
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

export function ChatProposal({
  proposal,
  conversationId,
  sources,
  attachments,
  onEdit,
  disabled,
}: {
  proposal: AiChatProposal
  conversationId: string
  sources: AiChatSource[]
  attachments: AiChatAttachment[]
  onEdit: (proposal: AiChatProposal) => void
  disabled: boolean
}) {
  const t = useT()
  const execute = useConversationProposalMutation('execute')
  const discard = useConversationProposalMutation('discard')
  const busy = execute.isPending || discard.isPending || proposal.status === 'executing'
  const pending = proposal.status === 'pending'
  const destructive = proposal.kind.endsWith('.delete')
  const kindKey = personalKindKeys[proposal.kind] ?? `assistantActions.kinds.${proposal.kind}`
  const kindLabel = t(kindKey)
  const resultHref = proposal.result && chatSourceHref(proposal.result.href, conversationId)
  const error = execute.error ?? discard.error
  const failureKey =
    error instanceof ApiError && error.status === 409
      ? 'assistantActions.conflict'
      : error instanceof ApiError && error.status === 403
        ? 'assistantActions.forbidden'
        : 'assistantActions.failed'
  async function revise() {
    try {
      await discard.mutateAsync({ conversationId, proposalId: proposal.id })
      onEdit(proposal)
    } catch {
      /* The persisted proposal remains pending; the visible mutation error explains it. */
    }
  }
  return (
    <section
      aria-label={proposal.title}
      className={cn(
        'mt-3 overflow-hidden rounded-lg border bg-background',
        destructive ? 'border-destructive/25' : 'border-primary/20',
      )}
    >
      <div className="flex items-start gap-2.5 border-b border-border px-3 py-3">
        <span
          className={cn(
            'mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md',
            destructive ? 'bg-destructive/10 text-destructive' : 'bg-primary/10 text-primary',
          )}
        >
          {proposal.status === 'executed' ? (
            <Check className="size-4" aria-hidden="true" />
          ) : destructive ? (
            <Trash2 className="size-4" aria-hidden="true" />
          ) : (
            <ShieldCheck className="size-4" aria-hidden="true" />
          )}
        </span>
        <div className="min-w-0">
          <p className="text-caption text-muted-foreground">
            {t(`assistantActions.status.${proposal.status}`)}
          </p>
          <p className="mt-1 text-caption font-medium text-primary">
            {kindLabel === kindKey ? proposal.kind : kindLabel}
          </p>
          <h3 className="mt-0.5 text-small font-semibold [overflow-wrap:anywhere]">
            {proposal.title}
          </h3>
          <p className="mt-1 text-small text-muted-foreground [overflow-wrap:anywhere]">
            {proposal.summary}
          </p>
        </div>
      </div>
      <div className="max-h-80 overflow-y-auto overscroll-contain p-3">
        <ProposalArguments
          value={proposal.arguments}
          sources={sources}
          attachments={attachments}
          conversationId={conversationId}
        />
      </div>
      {pending ? (
        <div className="border-t border-border px-3 py-2.5">
          <p
            className={cn(
              'mb-2 text-caption',
              destructive ? 'text-destructive' : 'text-muted-foreground',
            )}
          >
            {t(destructive ? 'assistantActions.deleteWarning' : 'assistantActions.confirmHint')}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant={destructive ? 'destructive' : 'primary'}
              disabled={disabled || busy}
              onClick={() => execute.mutate({ conversationId, proposalId: proposal.id })}
            >
              {busy ? (
                <LoaderCircle
                  className="mr-1.5 size-3.5 motion-safe:animate-spin"
                  aria-hidden="true"
                />
              ) : (
                <Check className="mr-1.5 size-3.5" aria-hidden="true" />
              )}
              {t(destructive ? 'assistantActions.confirmDelete' : 'assistantActions.execute')}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={disabled || busy}
              onClick={() => void revise()}
            >
              <Pencil className="mr-1.5 size-3.5" aria-hidden="true" />
              {t('assistantActions.edit')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={disabled || busy}
              onClick={() => discard.mutate({ conversationId, proposalId: proposal.id })}
            >
              <X className="mr-1.5 size-3.5" aria-hidden="true" />
              {t('assistantActions.discard')}
            </Button>
          </div>
        </div>
      ) : null}
      {proposal.status === 'failed' ? (
        <p role="status" className="px-3 pb-3 text-caption text-destructive">
          {t(
            proposal.error === 'attachment_failed'
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
          className="flex min-h-11 items-center gap-2 border-t border-border px-3 text-small font-medium text-primary"
        >
          {proposal.result!.label}
          <ArrowRight className="size-3.5" aria-hidden="true" />
        </RouterLink>
      ) : null}
      {error ? (
        <p role="alert" className="px-3 pb-3 text-caption text-destructive">
          {t(failureKey)}
        </p>
      ) : null}
    </section>
  )
}
