// Event discussion (TECH-SPEC §3.4 `event_comments`). Flat, newest-last, no threading -- matches the
// scale of a department-wide event thread, not a project's activity feed.
//
// AI wiring (UI-OVERHAUL.md "AI helpers ... thread summary"): a `SparkleButton` runs the AI module's
// `summarize_thread` feature over the visible comments and previews the result in an `AiPreviewPanel`
// -- Accept drops the summary into the compose box so the person can review it once more and post it
// themselves (TECH-SPEC §8: "the user always sees a preview and accepts", never an auto-post).
import * as React from 'react'
import { useT, useLocale } from '@devon/i18n'
import {
  AiPreviewPanel,
  Avatar,
  Button,
  IconButton,
  Skeleton,
  SparkleButton,
  StateView,
  Textarea,
  initialsFromName,
  toast,
} from '@devon/ui'
import { Trash2 } from 'lucide-react'
import { useRunAiFeatureMutation } from '../../ai/use-ai.js'
import { useAddCommentMutation, useCommentsQuery, useDeleteCommentMutation } from '../hooks.js'

function ThreadSummary({
  eventTitle,
  comments,
  onInsert,
}: {
  eventTitle: string
  comments: { id: string; author: string; body: string }[]
  onInsert: (text: string) => void
}) {
  const t = useT()
  const locale = useLocale()
  const runMutation = useRunAiFeatureMutation('summarize_thread')
  const [open, setOpen] = React.useState(false)

  if (comments.length < 2) return null

  const handleRun = () => {
    setOpen(true)
    runMutation.mutate({
      cardTitle: eventTitle,
      comments: comments.map((c) => ({ id: c.id, author: c.author, text: c.body })),
      locale,
    })
  }

  const summary =
    runMutation.data && typeof runMutation.data.data === 'object' && runMutation.data.data
      ? ((runMutation.data.data as Record<string, unknown>)['summary'] as string | undefined)
      : undefined

  return (
    <div className="flex flex-col gap-2">
      <SparkleButton
        aria-label={t('events.comments.summarize')}
        label={t('events.comments.summarize')}
        size="sm"
        className="self-start"
        onClick={handleRun}
      />
      {open ? (
        <AiPreviewPanel
          title={t('events.comments.summarize')}
          status={runMutation.isPending ? 'pending' : runMutation.isError ? 'error' : 'ready'}
          pendingLabel={t('events.comments.summaryPending')}
          errorMessage={t('events.comments.summaryFailed')}
          acceptLabel={t('events.comments.summaryAccept')}
          editLabel={t('events.comments.summaryEdit')}
          discardLabel={t('events.comments.summaryDiscard')}
          retryLabel={t('events.actions.retry')}
          onRetry={handleRun}
          onAccept={() => {
            if (summary) onInsert(summary)
            setOpen(false)
          }}
          onEdit={() => {
            if (summary) onInsert(summary)
            setOpen(false)
          }}
          onDiscard={() => setOpen(false)}
          {...(runMutation.data
            ? { costLine: t('ai.result.tokens', { count: runMutation.data.meta.totalTokens }) }
            : {})}
        >
          {summary}
        </AiPreviewPanel>
      ) : null}
    </div>
  )
}

export function CommentsPanel({ eventId, eventTitle }: { eventId: string; eventTitle: string }) {
  const t = useT()
  const commentsQuery = useCommentsQuery(eventId, true)
  const addMutation = useAddCommentMutation(eventId)
  const deleteMutation = useDeleteCommentMutation(eventId)
  const [body, setBody] = React.useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!body.trim()) return
    try {
      await addMutation.mutateAsync(body.trim())
      setBody('')
    } catch {
      toast(t('events.error.title'))
    }
  }

  const handleDelete = async (commentId: string) => {
    if (!window.confirm(t('events.comments.deleteConfirm'))) return
    try {
      await deleteMutation.mutateAsync(commentId)
    } catch {
      toast(t('events.error.title'))
    }
  }

  let commentsBody: React.ReactNode
  if (commentsQuery.isPending) {
    commentsBody = (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    )
  } else if (commentsQuery.isError) {
    commentsBody = (
      <StateView kind="error" titleKey="events.error.title" bodyKey="events.error.body" />
    )
  } else if (commentsQuery.data.items.length === 0) {
    commentsBody = <p className="text-small text-muted-foreground">{t('events.comments.empty')}</p>
  } else {
    commentsBody = (
      <ul className="flex flex-col gap-3">
        {commentsQuery.data.items.map((comment) => (
          <li key={comment.id} className="flex gap-3">
            <Avatar
              alt={`${comment.author.givenName} ${comment.author.familyName}`}
              initials={initialsFromName(comment.author.givenName, comment.author.familyName)}
              hueSeed={comment.author.id}
              size="sm"
            />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-small font-medium text-foreground">
                  {comment.author.givenName} {comment.author.familyName}
                </span>
                {comment.canDelete ? (
                  <IconButton
                    aria-label={t('events.comments.delete')}
                    onClick={() => handleDelete(comment.id)}
                  >
                    <Trash2 aria-hidden="true" />
                  </IconButton>
                ) : null}
              </div>
              <p className="whitespace-pre-wrap text-body text-foreground">{comment.body}</p>
            </div>
          </li>
        ))}
      </ul>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {commentsQuery.data ? (
        <ThreadSummary
          eventTitle={eventTitle}
          comments={commentsQuery.data.items.map((c) => ({
            id: c.id,
            author: `${c.author.givenName} ${c.author.familyName}`,
            body: c.body,
          }))}
          onInsert={(text) => setBody((prev) => (prev ? `${prev}\n\n${text}` : text))}
        />
      ) : null}
      <form onSubmit={handleSubmit} className="flex flex-col gap-2">
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={t('events.comments.placeholder')}
          rows={2}
          maxLength={2000}
        />
        <div className="flex justify-end">
          <Button type="submit" size="sm" loading={addMutation.isPending} disabled={!body.trim()}>
            {t('events.comments.submit')}
          </Button>
        </div>
      </form>

      {commentsBody}
    </div>
  )
}
