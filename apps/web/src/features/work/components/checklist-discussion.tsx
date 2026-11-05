import * as React from 'react'
import { formatRelativeTime, useLocale, useT } from '@devon/i18n'
import { Avatar, Button, Collapsible, IconButton, initialsFromName, Textarea } from '@devon/ui'
import { Check, ChevronUp, MessageCircle, Pencil, Send, Trash2, X } from 'lucide-react'
import { avatarUrl } from '../../../lib/avatar.js'
import { useDepartment, useSession } from '../../../lib/session.js'
import { useChecklistCommentChange, useChecklistComments } from '../checklist-comments.js'
import { useMembers } from '../hooks.js'
import { fullName } from '../lib/format.js'
import { resolveQuickAddAssignee } from '../lib/quick-add.js'
import type { CardComment } from '../api.js'

export function ChecklistDiscussion({
  cardId,
  itemId,
  itemText,
  open,
  onClose,
}: {
  cardId: string
  itemId: string
  itemText: string
  open: boolean
  onClose: () => void
}) {
  const t = useT()
  const locale = useLocale()
  const { user } = useSession()
  const { department } = useDepartment()
  const members = useMembers()
  const comments = useChecklistComments(cardId, itemId, open)
  const change = useChecklistCommentChange(cardId, itemId)
  const [text, setText] = React.useState('')
  const [editing, setEditing] = React.useState<CardComment | null>(null)
  const [editText, setEditText] = React.useState('')
  const [deleting, setDeleting] = React.useState<string | null>(null)
  const inputRef = React.useRef<HTMLTextAreaElement>(null)
  const threadRef = React.useRef<HTMLElement>(null)
  const instanceId = React.useId()
  function mentionedUsers(value: string) {
    return [
      ...new Set(
        [...value.matchAll(/@([\p{L}]+)/gu)]
          .map((match) => resolveQuickAddAssignee(match[1]!, members)?.userId)
          .filter((id): id is string => Boolean(id)),
      ),
    ]
  }
  React.useEffect(() => {
    if (!open || window.location.hash.startsWith(`#checklist-${itemId}-comment-`)) return
    const frame = requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }))
    return () => cancelAnimationFrame(frame)
  }, [open, itemId])
  React.useEffect(() => {
    if (
      !open ||
      !comments.data ||
      !window.location.hash.startsWith(`#checklist-${itemId}-comment-`)
    )
      return
    const target = [
      ...(threadRef.current?.querySelectorAll<HTMLElement>('[data-comment-anchor]') ?? []),
    ].find((element) => element.dataset['commentAnchor'] === window.location.hash.slice(1))
    target?.scrollIntoView({ block: 'nearest' })
    target?.focus({ preventScroll: true })
  }, [open, comments.data, itemId])
  async function submit() {
    if (!text.trim() || change.isPending) return
    try {
      const mentions = mentionedUsers(text)
      await change.mutateAsync({
        kind: 'add',
        text: text.trim(),
        ...(mentions.length ? { mentions } : {}),
      })
      setText('')
      inputRef.current?.focus({ preventScroll: true })
    } catch {
      /* The mutation reports the error; preserve the draft. */
    }
  }
  function onKey(event: React.KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      if (editing) setEditing(null)
      else if (deleting) setDeleting(null)
      else onClose()
    }
  }
  return (
    <Collapsible open={open} className="checklist-discussion">
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Escape from any focused child closes this nested thread before the task drawer. */}
      <section
        ref={threadRef}
        aria-label={t('checklistDiscussion.threadFor', { item: itemText })}
        className="ml-6 mt-1 rounded-md border border-border bg-muted/25 p-2.5"
        onKeyDown={onKey}
      >
        <div className="mb-2 flex items-center gap-1.5 text-caption text-muted-foreground">
          <MessageCircle className="size-3.5" aria-hidden="true" />
          <span className="flex-1 font-medium">
            {t('checklistDiscussion.comments')}
            {comments.data ? ` (${comments.data.length})` : ''}
          </span>
          <IconButton
            className="size-6"
            aria-label={t('checklistDiscussion.collapse')}
            onClick={onClose}
          >
            <ChevronUp className="size-3.5" />
          </IconButton>
        </div>
        {comments.isPending ? (
          <div
            role="status"
            aria-label={t('state.loading')}
            className="space-y-2 motion-safe:animate-pulse"
          >
            {[0, 1].map((row) => (
              <div key={row} className="flex gap-2">
                <div className="size-6 rounded-full bg-muted" />
                <div className="flex-1 space-y-1">
                  <div className="h-2.5 w-24 rounded bg-muted" />
                  <div className="h-3 w-4/5 rounded bg-muted" />
                </div>
              </div>
            ))}
          </div>
        ) : comments.isError ? (
          <div className="flex items-center justify-between gap-2 text-caption text-destructive">
            {t('checklistDiscussion.loadError')}
            <Button size="sm" variant="ghost" onClick={() => void comments.refetch()}>
              {t('state.error.action')}
            </Button>
          </div>
        ) : (
          <ol className="space-y-3">
            {comments.data.map((comment) => {
              const author = members.find((member) => member.userId === comment.authorUserId)
              const canEdit =
                comment.canEdit ??
                (comment.authorUserId === user?.id || department?.role === 'head')
              const canDelete =
                comment.canDelete ??
                (comment.authorUserId === user?.id || department?.role === 'head')
              return (
                <li
                  key={comment.id}
                  id={`checklist-${itemId}-comment-${comment.id}-${instanceId}`}
                  data-comment-anchor={`checklist-${itemId}-comment-${comment.id}`}
                  tabIndex={-1}
                  className="flex gap-2 rounded-sm focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <Avatar
                    size="xs"
                    src={avatarUrl(author?.avatarKey, 64)}
                    alt={author ? fullName(author) : t('work.activity.system')}
                    initials={author ? initialsFromName(author.givenName, author.familyName) : '?'}
                    hueSeed={comment.authorUserId}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2 text-caption">
                      <span className="font-medium">
                        {author ? fullName(author) : t('work.activity.system')}
                      </span>
                      <time className="text-muted-foreground" dateTime={comment.createdAt}>
                        {formatRelativeTime(new Date(comment.createdAt), locale)}
                      </time>
                      {comment.editedAt ? (
                        <span className="text-muted-foreground">
                          {t('checklistDiscussion.edited')}
                        </span>
                      ) : null}
                    </div>
                    {editing?.id === comment.id ? (
                      <form
                        className="mt-1 space-y-1"
                        onSubmit={async (event) => {
                          event.preventDefault()
                          if (!editText.trim() || change.isPending) return
                          try {
                            await change.mutateAsync({
                              kind: 'edit',
                              id: comment.id,
                              text: editText.trim(),
                              editedAt: editing.editedAt,
                              mentions: mentionedUsers(editText),
                            })
                            setEditing(null)
                          } catch {
                            /* Keep the edited text and original revision for retry. */
                          }
                        }}
                      >
                        <Textarea
                          autoFocus
                          rows={2}
                          maxLength={10000}
                          aria-label={t('checklistDiscussion.editComment')}
                          value={editText}
                          onChange={(event) => setEditText(event.target.value)}
                        />
                        <div className="flex justify-end gap-1">
                          <IconButton
                            type="button"
                            className="size-6"
                            aria-label={t('common.cancel')}
                            onClick={() => setEditing(null)}
                            disabled={change.isPending}
                          >
                            <X className="size-3.5" />
                          </IconButton>
                          <IconButton
                            type="submit"
                            className="size-6"
                            aria-label={t('work.action.save')}
                            disabled={change.isPending || !editText.trim()}
                          >
                            <Check className="size-3.5" />
                          </IconButton>
                        </div>
                      </form>
                    ) : (
                      <div className="flex items-start gap-2">
                        <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-small leading-relaxed">
                          {comment.body.text}
                        </p>
                        {!editing && deleting !== comment.id && (canEdit || canDelete) ? (
                          <div className="-mt-0.5 flex shrink-0 items-start">
                            {canEdit ? (
                              <IconButton
                                className="size-6 text-muted-foreground max-md:size-8 [@media(pointer:coarse)]:size-11 [&_svg]:size-3.5"
                                aria-label={t('checklistDiscussion.editComment')}
                                tooltip={t('checklistDiscussion.editComment')}
                                onClick={() => {
                                  setEditing(comment)
                                  setEditText(comment.body.text)
                                }}
                              >
                                <Pencil aria-hidden="true" />
                              </IconButton>
                            ) : null}
                            {canDelete ? (
                              <IconButton
                                className="size-6 text-muted-foreground hover:text-destructive max-md:size-8 [@media(pointer:coarse)]:size-11 [&_svg]:size-3.5"
                                aria-label={t('work.action.delete')}
                                tooltip={t('work.action.delete')}
                                onClick={() => setDeleting(comment.id)}
                              >
                                <Trash2 aria-hidden="true" />
                              </IconButton>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    )}
                    {deleting === comment.id ? (
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-caption">
                        <span>{t('checklistDiscussion.deleteConfirm')}</span>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={change.isPending}
                          onClick={() => setDeleting(null)}
                        >
                          {t('common.cancel')}
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={change.isPending}
                          onClick={() =>
                            change.mutate(
                              { kind: 'delete', id: comment.id },
                              { onSuccess: () => setDeleting(null) },
                            )
                          }
                        >
                          {t('work.action.delete')}
                        </Button>
                      </div>
                    ) : null}
                  </div>
                </li>
              )
            })}
          </ol>
        )}
        <form
          className="mt-2 flex items-end gap-1.5"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <Textarea
            ref={inputRef}
            rows={2}
            maxLength={10000}
            className="min-h-14 resize-y text-small"
            placeholder={t('checklistDiscussion.placeholder')}
            aria-label={t('checklistDiscussion.addComment')}
            value={text}
            disabled={change.isPending}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                event.preventDefault()
                void submit()
              }
            }}
          />
          <IconButton
            type="submit"
            aria-label={t('checklistDiscussion.send')}
            tooltip={t('checklistDiscussion.sendHint')}
            disabled={!text.trim() || change.isPending}
            className="mb-1 size-8 bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Send className="size-4" />
          </IconButton>
        </form>
      </section>
    </Collapsible>
  )
}
