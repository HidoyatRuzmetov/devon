// Event discussion (TECH-SPEC §3.4 `event_comments`). Flat, newest-last, no threading -- matches the
// scale of a department-wide event thread, not a project's activity feed.
//
// AI wiring (AI-AUDIT F7): `summarize_thread` over the visible comments, previewed as *decisions,
// open questions and commitments* rather than one paragraph -- a long event thread is read for
// exactly those three things. Accept drops the digest into the compose box so the person reviews it
// once more and posts it themselves (TECH-SPEC §8: "the user always sees a preview and accepts",
// never an auto-post).
//
// Two v1.1 fixes live here. The entry point is now gated on the department's AI flag and budget
// (AI-AUDIT §5 fix 12 -- v1.0 rendered the sparkle unconditionally and let the call 403), and Edit is
// no longer the same function as Accept (fix 11 -- both called the identical `onInsert`, which made
// one of the two buttons a lie).
import * as React from 'react'
import { useT, useLocale } from '@devon/i18n'
import {
  Avatar,
  Button,
  IconButton,
  initialsFromName,
  Skeleton,
  SparkleButton,
  StateView,
  Swap,
  Textarea,
  toast,
} from '@devon/ui'
import { Trash2 } from 'lucide-react'
import { useAiSettingsQuery, useRunAiFeatureMutation } from '../../ai/use-ai.js'
import { AiResultPanel } from '../../ai/components/ai-result-panel.js'
import { ThreadDigestPreview } from '../../ai/components/previews.js'
import { parseFeatureOutput, type SummarizeThreadOutput } from '../../ai/outputs.js'
import { useAddCommentMutation, useCommentsQuery, useDeleteCommentMutation } from '../hooks.js'
import { useSession } from '../../../lib/session.js'

function ThreadSummary({
  eventId,
  eventTitle,
  viewerName,
  comments,
  onInsert,
}: {
  eventId: string
  eventTitle: string
  viewerName: string
  comments: { id: string; author: string; body: string; createdAt: string }[]
  onInsert: (text: string) => void
}) {
  const t = useT()
  const locale = useLocale()
  const runMutation = useRunAiFeatureMutation('summarize_thread')
  const aiSettings = useAiSettingsQuery()
  const [open, setOpen] = React.useState(false)

  const digest = runMutation.data
    ? parseFeatureOutput<SummarizeThreadOutput>('summarize_thread', runMutation.data.data)
    : null

  // fix 12: the flag and the budget decide whether this affordance exists at all. A button that
  // always appears and sometimes 403s teaches people not to trust buttons.
  const aiEnabled =
    aiSettings.data !== undefined &&
    aiSettings.data.flags['summarize_thread'] === true &&
    aiSettings.data.budgetStatus !== 'hard_stop'

  if (comments.length < 2 || !aiEnabled) {
    return null
  }

  const handleRun = () => {
    setOpen(true)
    runMutation.mutate({
      locale,
      subject: { kind: 'event', id: eventId, title: eventTitle },
      viewerName,
      comments: comments.map((c) => ({
        id: c.id,
        author: c.author,
        text: c.body,
        createdAt: c.createdAt,
      })),
    })
  }

  /** The digest as text a person can post: every line the panel showed, nothing invented, nothing
   * dropped (SPEC §8 -- what the preview shows is what Accept applies). */
  const asText = (output: SummarizeThreadOutput): string => {
    const lines: string[] = []
    if (output.decisions.length > 0) {
      lines.push(`${t('ai.preview.thread.decisions')}:`)
      for (const decision of output.decisions) lines.push(`- ${decision.text}`)
    }
    if (output.openQuestions.length > 0) {
      lines.push(`${t('ai.preview.thread.openQuestions')}:`)
      for (const question of output.openQuestions) lines.push(`- ${question.text}`)
    }
    if (output.commitments.length > 0) {
      lines.push(`${t('ai.preview.thread.commitments')}:`)
      for (const c of output.commitments) lines.push(`- ${c.who}: ${c.what}`)
    }
    return lines.join('\n')
  }

  return (
    <div className="flex flex-col gap-2">
      <SparkleButton
        aria-label={t('events.comments.summarize')}
        label={t('events.comments.summarize')}
        size="sm"
        className="self-start"
        loading={runMutation.isPending}
        onClick={handleRun}
      />
      {open ? (
        <AiResultPanel
          title={t('events.comments.summarize')}
          status={runMutation.isPending ? 'pending' : runMutation.isError ? 'error' : 'ready'}
          errorMessage={t('events.comments.summaryFailed')}
          acceptLabel={t('events.comments.summaryAccept')}
          editLabel={t('events.comments.summaryEdit')}
          {...(runMutation.data ? { meta: runMutation.data.meta } : {})}
          onRetry={handleRun}
          onAccept={() => {
            if (digest) onInsert(asText(digest))
            setOpen(false)
          }}
          // fix 11: Edit fills the compose box and leaves the panel open, so the digest is still
          // there to check the edit against. Accept fills it and closes. Different things.
          onEdit={() => {
            if (digest) onInsert(asText(digest))
          }}
          onDiscard={() => setOpen(false)}
        >
          {digest ? <ThreadDigestPreview output={digest} /> : null}
        </AiResultPanel>
      ) : null}
    </div>
  )
}

export function CommentsPanel({ eventId, eventTitle }: { eventId: string; eventTitle: string }) {
  const t = useT()
  // The digest is written *for* the reader ("siz soʻragan savolga hali javob yoʻq"), which needs the
  // reader's name -- never invented, always the session's own.
  const { user } = useSession()
  const viewerName = user
    ? `${user.givenName} ${user.familyName}`.trim()
    : t('events.comments.viewerFallback')
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
    commentsBody = null
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
          eventId={eventId}
          eventTitle={eventTitle}
          viewerName={viewerName}
          comments={commentsQuery.data.items.map((c) => ({
            id: c.id,
            author: `${c.author.givenName} ${c.author.familyName}`,
            body: c.body,
            createdAt: c.createdAt,
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

      {/* DESIGN.md §10 "Skeleton → content": the two rows the thread is about to have, crossfading
          into the thread itself. `<Swap>` keeps both layers in one grid cell while they trade, so
          the composer above never shifts, and drops the skeleton once its fade is done, so a thread
          with a single comment settles to one row rather than holding a two-row gap. */}
      <Swap
        pending={commentsQuery.isPending}
        fallback={
          <div className="flex flex-col gap-3">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        }
      >
        {commentsBody}
      </Swap>
    </div>
  )
}
