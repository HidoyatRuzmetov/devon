// Event discussion (TECH-SPEC §3.4 `event_comments`). Flat, newest-last, no threading -- matches the
// scale of a department-wide event thread, not a project's activity feed.
import * as React from 'react'
import { useT } from '@devon/i18n'
import { Avatar, Button, IconButton, Skeleton, StateView, initialsFromName, toast } from '@devon/ui'
import { Trash2 } from 'lucide-react'
import { useAddCommentMutation, useCommentsQuery, useDeleteCommentMutation } from '../hooks.js'
import { Textarea } from './form-controls.js'

export function CommentsPanel({ eventId }: { eventId: string }) {
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
