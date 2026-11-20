import type { ReactNode } from 'react'
import { formatDate, useLocale, useT } from '@devon/i18n'
import { Badge, cn, IconButton } from '@devon/ui'
import { Circle, CircleCheck, FolderKanban, Trash2, X } from 'lucide-react'
import type { CardDetail, MemberSummary } from '../api.js'
import { fullName, PRIORITY_LABEL_KEY } from '../lib/format.js'
import { CardAttachments } from './card-attachments.js'
import { CardLinkLabel } from './card-link-label.js'
import { RestoreCardButton } from './restore-card-button.js'

/** The same routed panel stays open when Restore changes this historical record back to a live card. */
export function DeletedCardDetail({
  card,
  members,
  projectTitle,
  presentation,
  onClose,
  children,
}: {
  card: CardDetail
  members: readonly MemberSummary[]
  projectTitle?: string | undefined
  presentation: 'drawer' | 'page'
  onClose?: (() => void) | undefined
  children: ReactNode
}) {
  const t = useT()
  const locale = useLocale()
  const names = new Map(members.map((m) => [m.userId, fullName(m)]))
  for (const person of card.history?.people ?? []) names.set(person.id, person.name)
  const group = card.history?.projectTitle ?? projectTitle
  const byParent = new Map<string | null, CardDetail['checklist']>()
  const itemIds = new Set(card.checklist.map((item) => item.id))
  for (const item of card.checklist) {
    const parent = item.parentItemId && itemIds.has(item.parentItemId) ? item.parentItemId : null
    const siblings = byParent.get(parent) ?? []
    siblings.push(item)
    byParent.set(parent, siblings)
  }
  const threads = new Map<string | null, CardDetail['comments']>()
  for (const comment of card.comments) {
    const key = comment.checklistItemId ?? null
    const thread = threads.get(key) ?? []
    thread.push(comment)
    threads.set(key, thread)
  }

  function discussion(itemId: string | null) {
    const comments = threads.get(itemId)
    if (!comments?.length) return null
    return (
      <details className="mt-1 text-small">
        <summary className="cursor-pointer font-medium text-muted-foreground">
          {t(itemId ? 'work.field.comments' : 'checklistDiscussion.taskDiscussion')} (
          {comments.length})
        </summary>
        <ul className="mt-2 space-y-2 border-l border-border pl-3">
          {comments.map((comment) => (
            <li key={comment.id} id={`comment-${comment.id}`}>
              <span className="text-caption text-muted-foreground">
                {names.get(comment.authorUserId) ?? t('work.activity.unknownActor')} ·{' '}
                {formatDate(new Date(comment.createdAt), locale)}
              </span>
              <p className="whitespace-pre-wrap break-words">{comment.body.text}</p>
            </li>
          ))}
        </ul>
      </details>
    )
  }
  function checklist(parent: string | null): ReactNode {
    const items = byParent.get(parent)
    if (!items?.length) return null
    return (
      <ul className={cn('space-y-2', parent && 'ml-2 mt-2 border-l border-border pl-3')}>
        {items.map((item) => (
          <li key={item.id}>
            <div className="flex items-start gap-2 text-small">
              {item.doneAt ? (
                <CircleCheck
                  className="mt-0.5 size-4 shrink-0 text-success"
                  aria-label={t('work.status.done')}
                />
              ) : (
                <Circle
                  className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                  aria-label={t('homeMember.toDo')}
                />
              )}
              <div className="min-w-0 flex-1">
                <span className="break-words">{item.text}</span>
                {discussion(item.id)}
              </div>
            </div>
            {checklist(item.id)}
          </li>
        ))}
      </ul>
    )
  }
  const properties = [
    [t('work.field.assignee'), card.assigneeUserId && names.get(card.assigneeUserId)],
    [t('work.field.giver'), card.giverUserId && names.get(card.giverUserId)],
    [t('work.field.priority'), t(PRIORITY_LABEL_KEY[card.priority])],
    [t('work.field.start'), card.startAt && formatDate(new Date(card.startAt), locale)],
    [t('work.field.due'), card.dueAt && formatDate(new Date(card.dueAt), locale)],
  ] as const
  return (
    <div
      data-card-detail
      className={cn('flex min-h-0 min-w-0 flex-col', presentation === 'drawer' && 'h-full')}
    >
      <header
        className={cn(
          'flex shrink-0 flex-col gap-2 border-b border-border bg-surface-3 pb-4',
          presentation === 'drawer' && 'px-4 pt-3 sm:px-5',
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-2 text-small text-muted-foreground">
            {group && <FolderKanban className="size-4 shrink-0" aria-hidden="true" />}
            <span className="truncate">{group ?? t('cardRefinement.cardLabel')}</span>
          </span>
          <div className="flex shrink-0 items-center gap-1">
            <RestoreCardButton card={card} canRestore={card.history?.canRestore} />
            {onClose && (
              <IconButton aria-label={t('shell.shortcuts.close')} onClick={onClose}>
                <X aria-hidden="true" />
              </IconButton>
            )}
          </div>
        </div>
        <h2 className="break-words font-display text-h3">{card.title}</h2>
        <Badge tone="neutral" className="self-start">
          <Trash2 className="size-3.5" aria-hidden="true" />
          {t('cardActions.deletedOn', { date: formatDate(new Date(card.deletedAt!), locale) })}
        </Badge>
      </header>
      <div
        data-card-detail-scroll
        className={cn(
          'flex min-h-0 flex-col gap-5 pt-4',
          presentation === 'drawer' &&
            'flex-1 overflow-y-auto overscroll-contain px-4 pb-6 sm:px-5',
        )}
      >
        <dl className="grid grid-cols-2 gap-3 rounded-md border border-border bg-muted/20 p-3">
          {properties.map(
            ([label, value]) =>
              value && (
                <div key={label}>
                  <dt className="text-caption text-muted-foreground">{label}</dt>
                  <dd className="break-words text-small">{value}</dd>
                </div>
              ),
          )}
        </dl>
        {card.description?.text && (
          <section>
            <h3 className="mb-1 text-small font-medium">{t('work.field.description')}</h3>
            <p className="whitespace-pre-wrap break-words text-small">{card.description.text}</p>
          </section>
        )}
        {card.checklist.length > 0 && (
          <section>
            <h3 className="mb-2 text-small font-medium">
              {t('work.field.checklist')} ({card.checklistDone}/{card.checklist.length})
            </h3>
            {checklist(null)}
          </section>
        )}
        {discussion(null)}
        {card.links.length > 0 && (
          <section>
            <h3 className="mb-1 text-small font-medium">{t('work.field.links')}</h3>
            {card.links.map((link) => (
              <div key={link.url} className="flex">
                <CardLinkLabel {...link} />
              </div>
            ))}
          </section>
        )}
        <CardAttachments cardId={card.id} historical canEdit={false} />
        {children}
      </div>
    </div>
  )
}
