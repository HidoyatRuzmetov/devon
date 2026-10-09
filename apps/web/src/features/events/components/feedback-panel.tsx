// Feedback (TECH-SPEC §3.4: "rating + comment, anonymous option"). Shown once the event is `done`
// (the caller only mounts this tab then) -- one rating per person, resubmitting updates it.
import * as React from 'react'
import { useT } from '@devon/i18n'
import { Button, Checkbox, Field, Skeleton, StateView, Textarea, toast } from '@devon/ui'
import { Star } from 'lucide-react'
import { useFeedbackQuery, useSubmitFeedbackMutation } from '../hooks.js'

function StarRating({
  value,
  label,
  onChange,
}: {
  value: number
  label: string
  onChange: (v: number) => void
}) {
  const buttons = React.useRef<Array<HTMLButtonElement | null>>([])
  return (
    <div id="feedback-rating" className="flex gap-1" role="radiogroup" aria-label={label}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={String(n)}
          ref={(button) => {
            buttons.current[n - 1] = button
          }}
          tabIndex={n === (value || 1) ? 0 : -1}
          onClick={() => onChange(n)}
          onKeyDown={(event) => {
            const direction =
              event.key === 'ArrowRight' || event.key === 'ArrowDown'
                ? 1
                : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
                  ? -1
                  : 0
            if (!direction) return
            event.preventDefault()
            const next = ((n - 1 + direction + 5) % 5) + 1
            onChange(next)
            buttons.current[next - 1]?.focus()
          }}
          className="rounded-sm p-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <Star
            className={
              n <= value ? 'size-6 fill-warning text-warning' : 'size-6 text-muted-foreground'
            }
            aria-hidden="true"
          />
        </button>
      ))}
    </div>
  )
}

export function FeedbackPanel({ eventId }: { eventId: string }) {
  const t = useT()
  const feedbackQuery = useFeedbackQuery(eventId, true)
  const submitMutation = useSubmitFeedbackMutation(eventId)
  const [rating, setRating] = React.useState(0)
  const [comment, setComment] = React.useState('')
  const [anonymous, setAnonymous] = React.useState(false)
  const draft = React.useRef({
    revision: { rating: 0, comment: 0, anonymous: 0 },
    dirty: { rating: false, comment: false, anonymous: false },
  })

  React.useEffect(() => {
    if (feedbackQuery.data?.myFeedback) {
      if (!draft.current.dirty.rating) setRating(feedbackQuery.data.myFeedback.rating)
      if (!draft.current.dirty.comment) setComment(feedbackQuery.data.myFeedback.comment ?? '')
      // The DTO intentionally hides anonymous authors. Rehydrate the caller's own choice before
      // an update; defaulting this to false would publish a previously anonymous response.
      if (!draft.current.dirty.anonymous)
        setAnonymous(feedbackQuery.data.myFeedback.author === null)
    }
  }, [feedbackQuery.data?.myFeedback])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (rating === 0) return
    const submittedRevision = { ...draft.current.revision }
    try {
      await submitMutation.mutateAsync({ rating, comment: comment.trim() || undefined, anonymous })
      for (const field of ['rating', 'comment', 'anonymous'] as const) {
        if (submittedRevision[field] === draft.current.revision[field])
          draft.current.dirty[field] = false
      }
      toast(t('events.feedback.thankYou'))
    } catch {
      toast(t('events.error.title'))
    }
  }

  if (feedbackQuery.isPending) return <Skeleton className="h-40 w-full" />
  if (feedbackQuery.isError) {
    return (
      <StateView
        kind="error"
        titleKey="events.error.title"
        bodyKey="events.error.body"
        action={{ labelKey: 'events.actions.retry', onAction: () => void feedbackQuery.refetch() }}
      />
    )
  }

  const { items, averageRating, myFeedback } = feedbackQuery.data

  return (
    <div className="flex flex-col gap-6">
      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-3 rounded-md border border-border p-4"
      >
        <Field label={t('events.feedback.ratingLabel')} htmlFor="feedback-rating">
          <StarRating
            value={rating}
            label={t('events.feedback.ratingLabel')}
            onChange={(value) => {
              draft.current.revision.rating += 1
              draft.current.dirty.rating = true
              setRating(value)
            }}
          />
        </Field>
        <Field label={t('events.feedback.commentLabel')} htmlFor="feedback-comment">
          <Textarea
            id="feedback-comment"
            rows={2}
            value={comment}
            onChange={(e) => {
              draft.current.revision.comment += 1
              draft.current.dirty.comment = true
              setComment(e.target.value)
            }}
            maxLength={2000}
          />
        </Field>
        <div className="flex items-center gap-2">
          <Checkbox
            checked={anonymous}
            onCheckedChange={(v) => {
              draft.current.revision.anonymous += 1
              draft.current.dirty.anonymous = true
              setAnonymous(v === true)
            }}
            id="feedback-anonymous"
          />
          <label htmlFor="feedback-anonymous" className="text-small text-foreground">
            {t('events.feedback.anonymousLabel')}
          </label>
        </div>
        <div className="flex justify-end">
          <Button type="submit" loading={submitMutation.isPending} disabled={rating === 0}>
            {t(myFeedback ? 'events.feedback.update' : 'events.feedback.submit')}
          </Button>
        </div>
      </form>

      {averageRating !== null ? (
        <p className="text-small font-medium text-foreground">
          {t('events.feedback.average', { rating: averageRating })}
        </p>
      ) : null}

      {items.length === 0 ? (
        <p className="text-small text-muted-foreground">{t('events.feedback.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((item) => (
            <li key={item.id} className="rounded-md border border-border p-3 wrap-anywhere">
              <div className="flex items-center justify-between">
                <span className="text-small font-medium text-foreground">
                  {item.author
                    ? `${item.author.givenName} ${item.author.familyName}`
                    : t('events.feedback.anonymousAuthor')}
                </span>
                <span className="flex items-center gap-1 text-caption text-muted-foreground">
                  <Star className="size-3.5 fill-warning text-warning" aria-hidden="true" />
                  {item.rating}
                </span>
              </div>
              {item.comment ? (
                <p className="mt-1 text-body text-foreground">{item.comment}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
