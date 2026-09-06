// The card detail content (TECH-SPEC §5): title, description, giver/assignee, priority, dates with a
// risk badge, links with unfurl, a nested checklist, comments with @mentions, activity timeline,
// labels, watchers, archive/restore with undo. Shared, unstyled-of-container content component --
// `card-peek-dialog.tsx` wraps it in a `Dialog` for the side-peek, `card-page-screen.tsx` renders it
// directly as the full page (TECH-SPEC "card peek panel and full card page").
import * as React from 'react'
import { Link2, Plus, Trash2, X } from 'lucide-react'
import { useT, useLocale, formatDate, type Locale } from '@devon/i18n'
import {
  Avatar,
  Badge,
  Button,
  IconButton,
  Input,
  Skeleton,
  StateView,
  initialsFromName,
  toast,
  toastWithUndo,
} from '@devon/ui'
import { useSession } from '../../../lib/session.js'
import {
  nextDoneStatus,
  useAddChecklistItemMutation,
  useAddCommentMutation,
  useCardQuery,
  useCreateLabelMutation,
  useDeleteChecklistItemMutation,
  useLabelsQuery,
  useMembers,
  usePatchCardMutation,
  usePatchChecklistItemMutation,
  useRestoreCardMutation,
  useToggleWatcherMutation,
  useUnfurlMutation,
} from '../hooks.js'
import { resolveQuickAddAssignee } from '../lib/quick-add.js'
import {
  PRIORITY_BADGE_TONE,
  PRIORITY_LABEL_KEY,
  RISK_BADGE_TONE,
  RISK_LABEL_KEY,
  fullName,
} from '../lib/format.js'
import { MemberPicker } from './member-picker.js'
import type { CardPriority, MemberSummary } from '../api.js'

const PRIORITIES: readonly CardPriority[] = ['none', 'low', 'medium', 'high', 'urgent']

function toDateInputValue(iso: string | null): string {
  return iso ? iso.slice(0, 10) : ''
}

function dateInputToIso(value: string): string | null {
  return value ? new Date(`${value}T00:00:00.000Z`).toISOString() : null
}

export function CardDetailContent({ cardId, onClose }: { cardId: string; onClose?: () => void }) {
  const t = useT()
  const locale = useLocale()
  const query = useCardQuery(cardId)
  const members = useMembers()
  const labels = useLabelsQuery().data ?? []
  const { user } = useSession()
  const patchCard = usePatchCardMutation()
  const restoreCard = useRestoreCardMutation()
  const toggleWatcher = useToggleWatcherMutation()
  const createLabel = useCreateLabelMutation()
  const unfurl = useUnfurlMutation()

  const [titleDraft, setTitleDraft] = React.useState('')
  const [descDraft, setDescDraft] = React.useState('')
  const [linkInput, setLinkInput] = React.useState('')
  const [newLabelName, setNewLabelName] = React.useState('')

  const card = query.data
  React.useEffect(() => {
    if (card) {
      setTitleDraft(card.title)
      setDescDraft(card.description?.text ?? '')
    }
  }, [card?.id, card?.title, card?.description?.text]) // eslint-disable-line react-hooks/exhaustive-deps

  if (query.isPending) {
    return (
      <div className="flex flex-col gap-4 p-2">
        <Skeleton className="h-8 w-3/4" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }
  if (query.isError || !card) {
    return (
      <StateView
        kind="error"
        titleKey="state.error.title"
        bodyKey="state.error.body"
        action={{ labelKey: 'state.error.action', onAction: () => void query.refetch() }}
      />
    )
  }

  const isWatching = user ? card.watchers.includes(user.id) : false

  async function saveTitle() {
    if (titleDraft.trim().length === 0 || titleDraft === card!.title) return
    await patchCard.mutateAsync({ id: card!.id, patch: { title: titleDraft.trim() } })
  }
  async function saveDescription() {
    if (descDraft === (card!.description?.text ?? '')) return
    await patchCard.mutateAsync({ id: card!.id, patch: { description: descDraft || null } })
  }

  async function markDone() {
    const status = nextDoneStatus(card!)
    await patchCard.mutateAsync({ id: card!.id, patch: { status } })
    if (status === 'archived') {
      toastWithUndo({
        message: t('work.card.archived'),
        undoLabel: t('action.undo'),
        onUndo: () => void restoreCard.mutateAsync(card!.id),
      })
      onClose?.()
    }
  }

  async function archiveNow() {
    await patchCard.mutateAsync({ id: card!.id, patch: { status: 'archived' } })
    toastWithUndo({
      message: t('work.card.archived'),
      undoLabel: t('action.undo'),
      onUndo: () => void restoreCard.mutateAsync(card!.id),
    })
    onClose?.()
  }

  async function addLink() {
    const url = linkInput.trim()
    if (!url) return
    try {
      const result = await unfurl.mutateAsync(url)
      await patchCard.mutateAsync({
        id: card!.id,
        patch: {
          links: [
            ...card!.links,
            { url: result.url, title: result.title, favicon: result.favicon },
          ],
        },
      })
      setLinkInput('')
    } catch {
      toast(t('work.card.unfurlError'))
    }
  }

  async function removeLink(url: string) {
    await patchCard.mutateAsync({
      id: card!.id,
      patch: { links: card!.links.filter((l) => l.url !== url) },
    })
  }

  function toggleLabel(labelId: string) {
    const next = card!.labels.includes(labelId)
      ? card!.labels.filter((l) => l !== labelId)
      : [...card!.labels, labelId]
    void patchCard.mutateAsync({ id: card!.id, patch: { labels: next } })
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-2">
          <textarea
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={() => void saveTitle()}
            rows={1}
            aria-label={t('work.field.title')}
            className="w-full resize-none rounded-sm border border-transparent bg-transparent p-1 font-display text-h3 text-foreground outline-none hover:border-border focus-visible:border-border focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="neutral">{t(`work.status.${card.status}`)}</Badge>
          {card.priority !== 'none' ? (
            <Badge tone={PRIORITY_BADGE_TONE[card.priority]}>
              {t(PRIORITY_LABEL_KEY[card.priority])}
            </Badge>
          ) : null}
          {card.risk !== 'none' ? (
            <Badge tone={RISK_BADGE_TONE[card.risk]}>{t(RISK_LABEL_KEY[card.risk])}</Badge>
          ) : null}
        </div>
      </header>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={t('work.field.assignee')}>
          <MemberPicker
            members={members}
            value={card.assigneeUserId}
            onChange={(userId) =>
              void patchCard.mutateAsync({ id: card.id, patch: { assigneeUserId: userId } })
            }
            placeholderKey="work.field.unassigned"
          />
        </Field>
        <Field label={t('work.field.giver')}>
          <MemberPicker
            members={members}
            value={card.giverUserId}
            onChange={(userId) =>
              void patchCard.mutateAsync({ id: card.id, patch: { giverUserId: userId } })
            }
            placeholderKey="work.field.noGiver"
          />
        </Field>
        <Field label={t('work.field.priority')}>
          <select
            value={card.priority}
            onChange={(e) =>
              void patchCard.mutateAsync({
                id: card.id,
                patch: { priority: e.target.value as CardPriority },
              })
            }
            className="h-11 w-full rounded-sm border border-border bg-card px-3 text-body text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {t(PRIORITY_LABEL_KEY[p])}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('work.field.due')}>
          <Input
            type="date"
            value={toDateInputValue(card.dueAt)}
            onChange={(e) =>
              void patchCard.mutateAsync({
                id: card.id,
                patch: { dueAt: dateInputToIso(e.target.value) },
              })
            }
          />
        </Field>
        <Field label={t('work.field.start')}>
          <Input
            type="date"
            value={toDateInputValue(card.startAt)}
            onChange={(e) =>
              void patchCard.mutateAsync({
                id: card.id,
                patch: { startAt: dateInputToIso(e.target.value) },
              })
            }
          />
        </Field>
        <Field label={t('work.field.watchers')}>
          <Button
            size="sm"
            variant={isWatching ? 'secondary' : 'ghost'}
            onClick={() => void toggleWatcher.mutateAsync(card.id)}
          >
            {isWatching ? t('work.card.watching') : t('work.card.watch')} ({card.watchers.length})
          </Button>
        </Field>
      </section>

      <section className="flex flex-wrap gap-1.5">
        {labels.map((label) => {
          const active = card.labels.includes(label.id)
          return (
            <button
              key={label.id}
              type="button"
              onClick={() => toggleLabel(label.id)}
              className="rounded-sm px-2 py-0.5 text-caption font-medium transition-opacity"
              style={{
                backgroundColor: label.colour,
                color: 'white',
                opacity: active ? 1 : 0.35,
              }}
              aria-pressed={active}
            >
              {label.name}
            </button>
          )
        })}
        <div className="flex items-center gap-1">
          <Input
            value={newLabelName}
            onChange={(e) => setNewLabelName(e.target.value)}
            placeholder={t('work.card.newLabel')}
            className="h-7 w-32 px-2 text-caption"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newLabelName.trim()) {
                createLabel.mutate({ name: newLabelName.trim() })
                setNewLabelName('')
              }
            }}
          />
        </div>
      </section>

      <Field label={t('work.field.description')}>
        <textarea
          value={descDraft}
          onChange={(e) => setDescDraft(e.target.value)}
          onBlur={() => void saveDescription()}
          rows={5}
          placeholder={t('work.card.descriptionPlaceholder')}
          className="w-full resize-y rounded-sm border border-border bg-card p-3 text-body text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </Field>

      <Field label={t('work.field.links')}>
        <div className="flex flex-col gap-2">
          {card.links.map((link) => (
            <div
              key={link.url}
              className="flex items-center gap-2 rounded-sm border border-border p-2"
            >
              <Link2 className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <a
                href={link.url}
                target="_blank"
                rel="noreferrer"
                className="flex-1 truncate text-small text-primary underline"
              >
                {link.title}
              </a>
              <IconButton
                aria-label={t('work.action.delete')}
                onClick={() => void removeLink(link.url)}
              >
                <X className="size-3.5" />
              </IconButton>
            </div>
          ))}
          <div className="flex gap-2">
            <Input
              value={linkInput}
              onChange={(e) => setLinkInput(e.target.value)}
              placeholder={t('work.card.addLinkPlaceholder')}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void addLink()
              }}
            />
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void addLink()}
              loading={unfurl.isPending}
            >
              <Plus className="size-4" />
            </Button>
          </div>
        </div>
      </Field>

      <Checklist cardId={card.id} checklist={card.checklist} />

      <Comments cardId={card.id} comments={card.comments} members={members} />

      <ActivityTimeline activity={card.activity} members={members} locale={locale} />

      <footer className="flex flex-wrap gap-2 border-t border-border pt-4">
        {card.status === 'active' ? (
          <Button size="sm" onClick={() => void markDone()} loading={patchCard.isPending}>
            {t('work.card.markDone')}
          </Button>
        ) : null}
        {card.status !== 'archived' ? (
          <Button size="sm" variant="secondary" onClick={() => void archiveNow()}>
            {t('work.card.archive')}
          </Button>
        ) : (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void restoreCard.mutateAsync(card.id)}
          >
            {t('work.card.restore')}
          </Button>
        )}
      </footer>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-small">
      <span className="text-caption font-medium uppercase tracking-(--text-eyebrow--letter-spacing) text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  )
}

function Checklist({
  cardId,
  checklist,
}: {
  cardId: string
  checklist: Array<{ id: string; parentItemId: string | null; text: string; doneAt: string | null }>
}) {
  const t = useT()
  const [text, setText] = React.useState('')
  const addItem = useAddChecklistItemMutation(cardId)
  const patchItem = usePatchChecklistItemMutation(cardId)
  const deleteItem = useDeleteChecklistItemMutation(cardId)
  const topLevel = checklist.filter((i) => i.parentItemId === null)
  const childrenOf = (id: string) => checklist.filter((i) => i.parentItemId === id)
  const done = checklist.filter((i) => i.doneAt !== null).length

  return (
    <Field label={`${t('work.field.checklist')} (${done}/${checklist.length})`}>
      <div className="flex flex-col gap-1">
        {topLevel.map((item) => (
          <div key={item.id} className="flex flex-col gap-1">
            <ChecklistRow
              item={item}
              onToggle={(done_) => patchItem.mutate({ itemId: item.id, patch: { done: done_ } })}
              onDelete={() => deleteItem.mutate(item.id)}
            />
            {childrenOf(item.id).map((child) => (
              <div key={child.id} className="pl-6">
                <ChecklistRow
                  item={child}
                  onToggle={(done_) =>
                    patchItem.mutate({ itemId: child.id, patch: { done: done_ } })
                  }
                  onDelete={() => deleteItem.mutate(child.id)}
                />
              </div>
            ))}
          </div>
        ))}
        <div className="flex gap-2 pt-1">
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t('work.card.addChecklistItem')}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && text.trim()) {
                addItem.mutate({ text: text.trim() })
                setText('')
              }
            }}
          />
        </div>
      </div>
    </Field>
  )
}

function ChecklistRow({
  item,
  onToggle,
  onDelete,
}: {
  item: { id: string; text: string; doneAt: string | null }
  onToggle: (done: boolean) => void
  onDelete: () => void
}) {
  const t = useT()
  return (
    <div className="flex items-center gap-2 rounded-sm px-1 py-1 hover:bg-accent">
      <input
        type="checkbox"
        checked={item.doneAt !== null}
        onChange={(e) => onToggle(e.target.checked)}
        aria-label={item.text}
        className="size-4"
      />
      <span
        className={
          item.doneAt !== null
            ? 'flex-1 text-small text-muted-foreground line-through'
            : 'flex-1 text-small text-foreground'
        }
      >
        {item.text}
      </span>
      <IconButton aria-label={t('work.action.delete')} onClick={onDelete}>
        <Trash2 className="size-3.5" />
      </IconButton>
    </div>
  )
}

function Comments({
  cardId,
  comments,
  members,
}: {
  cardId: string
  comments: Array<{ id: string; authorUserId: string; body: { text: string }; createdAt: string }>
  members: readonly MemberSummary[]
}) {
  const t = useT()
  const locale = useLocale()
  const [text, setText] = React.useState('')
  const addComment = useAddCommentMutation(cardId)

  async function submit() {
    if (!text.trim()) return
    const mentionMatches = [...text.matchAll(/@([\p{L}]+)/gu)].map((m) => m[1]!)
    const mentions = mentionMatches
      .map((token) => resolveQuickAddAssignee(token, members)?.userId)
      .filter((id): id is string => Boolean(id))
    await addComment.mutateAsync({ text: text.trim(), mentions })
    setText('')
  }

  return (
    <Field label={`${t('work.field.comments')} (${comments.length})`}>
      <div className="flex flex-col gap-3">
        {comments.map((c) => {
          const author = members.find((m) => m.userId === c.authorUserId)
          return (
            <div key={c.id} className="flex gap-2">
              <Avatar
                size="sm"
                src={null}
                alt={author ? fullName(author) : ''}
                initials={author ? initialsFromName(author.givenName, author.familyName) : '?'}
                hueSeed={c.authorUserId}
              />
              <div className="flex-1 rounded-sm bg-muted p-2">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-small font-medium text-foreground">
                    {author ? fullName(author) : ''}
                  </span>
                  <span className="text-caption text-muted-foreground">
                    {formatDate(new Date(c.createdAt), locale)}
                  </span>
                </div>
                <p className="whitespace-pre-wrap text-small text-foreground">{c.body.text}</p>
              </div>
            </div>
          )
        })}
        <div className="flex gap-2">
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t('work.card.addCommentPlaceholder')}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit()
            }}
          />
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void submit()}
            loading={addComment.isPending}
          >
            {t('work.action.send')}
          </Button>
        </div>
      </div>
    </Field>
  )
}

function ActivityTimeline({
  activity,
  members,
  locale,
}: {
  activity: Array<{
    id: string
    actorUserId: string | null
    kind: string
    data: Record<string, unknown>
    at: string
  }>
  members: readonly MemberSummary[]
  locale: Locale
}) {
  const t = useT()
  if (activity.length === 0) return null
  return (
    <Field label={t('work.field.activity')}>
      <ol className="flex flex-col gap-2 border-l border-border pl-3">
        {activity.map((event) => {
          const actor = members.find((m) => m.userId === event.actorUserId)
          return (
            <li key={event.id} className="text-caption text-muted-foreground">
              <span className="text-foreground">
                {actor ? fullName(actor) : t('work.activity.system')}
              </span>{' '}
              {t(`work.activity.${event.kind}`)} · {formatDate(new Date(event.at), locale)}
            </li>
          )
        })}
      </ol>
    </Field>
  )
}
