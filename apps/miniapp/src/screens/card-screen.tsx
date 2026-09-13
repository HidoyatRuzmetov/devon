// The card quick view: what a card is, whether it is done, and what people have said about it --
// with the two actions a phone is actually good for (mark it done, add a comment).
//
// Everything else a card has (reassigning, re-dating, labels, watchers, the activity timeline) is
// deliberately absent: those are decisions, and a decision belongs on the screen that shows the whole
// board. `canEdit` comes from the server, so the button is hidden for a card this person may not
// touch and the server refuses it anyway (I-6).
import * as React from 'react'
import { MessageSquare, Send } from 'lucide-react'
import { formatRelativeTime, useLocale, useT } from '@devon/i18n'
import {
  Badge,
  Button,
  Celebrate,
  cn,
  strikethroughClass,
  Textarea,
  toast,
  toastWithUndo,
} from '@devon/ui'
import { addCardComment, getCard, setCardStatus } from '../lib/api.js'
import { useQuery } from '../lib/use-query.js'
import { tg } from '../lib/telegram.js'
import {
  ListSkeleton,
  QueryState,
  ScreenBody,
  ScreenHeader,
  ScreenList,
} from '../components/screen.js'
import { DueChip, PriorityBadge, SectionLabel, rowSurface } from '../components/bits.js'

export function CardScreen({ cardId }: { cardId: string }): React.ReactElement {
  const t = useT()
  const locale = useLocale()
  const query = useQuery(() => getCard(cardId), [cardId])
  const [comment, setComment] = React.useState('')
  const [sending, setSending] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [celebrating, setCelebrating] = React.useState(false)

  const card = query.data

  const toggleDone = React.useCallback(() => {
    if (!card || busy) return
    const next = card.status === 'done' ? 'active' : 'done'
    setBusy(true)
    setCardStatus(card.id, next, card.version)
      .then((updated) => {
        query.set(updated)
        if (next === 'done') {
          setCelebrating(true)
          tg.haptic.success()
        }
        // Undo over confirm (I-11): the toast carries the reversal, and reversing it is one more
        // PATCH with the version the server just handed back.
        toastWithUndo({
          message: t(next === 'done' ? 'miniapp.card.markedDone' : 'miniapp.card.reopened'),
          undoLabel: t('miniapp.action.undo'),
          onUndo: () => {
            setCardStatus(updated.id, next === 'done' ? 'active' : 'done', updated.version)
              .then((reverted) => query.set(reverted))
              .catch(() => toast.error(t('miniapp.card.updateFailed')))
          },
        })
      })
      .catch(() => toast.error(t('miniapp.card.updateFailed')))
      .finally(() => setBusy(false))
  }, [card, busy, query, t])

  const onComment = React.useCallback(
    (event: React.FormEvent) => {
      event.preventDefault()
      const text = comment.trim()
      if (text === '' || sending || !card) return
      setSending(true)
      addCardComment(card.id, text)
        .then(() => {
          setComment('')
          tg.haptic.tap()
          toast.success(t('miniapp.card.commentAdded'))
          query.refetch()
        })
        .catch(() => toast.error(t('miniapp.card.commentFailed')))
        .finally(() => setSending(false))
    },
    [comment, sending, card, query, t],
  )

  return (
    <>
      <ScreenHeader
        title={card?.title ?? t('miniapp.card.title')}
        eyebrow={t('miniapp.card.eyebrow')}
        onBack="history"
      />
      <ScreenBody>
        {query.status === 'loading' && card === null ? (
          <ListSkeleton rows={3} />
        ) : card === null ? (
          <QueryState error={query.error} onRetry={query.refetch} />
        ) : (
          <>
            <div className="border-border bg-card shadow-1 mb-3 flex flex-col gap-3 rounded-md border p-3">
              <div className="flex flex-wrap items-center gap-1.5">
                {card.status === 'done' ? (
                  <Badge tone="success">{t('miniapp.card.done')}</Badge>
                ) : (
                  <Badge tone="neutral">{t('miniapp.card.open')}</Badge>
                )}
                <PriorityBadge priority={card.priority} />
                <DueChip dueAt={card.dueAt} risk={card.risk} />
              </div>
              {card.description?.text ? (
                <p className="text-foreground text-[14px] leading-6 whitespace-pre-wrap">
                  {card.description.text}
                </p>
              ) : (
                <p className="text-muted-foreground text-[13px] leading-5">
                  {t('miniapp.card.noDescription')}
                </p>
              )}
              {card.canEdit === false ? (
                <p className="text-muted-foreground text-[12px] leading-4">
                  {t('miniapp.card.readOnly')}
                </p>
              ) : (
                // `Celebrate` is an absolutely-positioned particle burst, not a wrapper: it needs a
                // positioned parent to fire from, and the button is that parent's only content.
                <span className="relative inline-flex w-full">
                  <Button
                    variant={card.status === 'done' ? 'secondary' : 'primary'}
                    size="md"
                    className="w-full"
                    loading={busy}
                    onClick={toggleDone}
                  >
                    {t(card.status === 'done' ? 'miniapp.card.reopen' : 'miniapp.card.markDone')}
                  </Button>
                  <Celebrate play={celebrating} onDone={() => setCelebrating(false)} />
                </span>
              )}
            </div>

            {card.checklist.length > 0 ? (
              <>
                <SectionLabel count={card.checklist.length}>
                  {t('miniapp.card.checklist')}
                </SectionLabel>
                <ul className="border-border bg-card mb-2 flex flex-col gap-1.5 rounded-md border p-3">
                  {card.checklist.map((item) => (
                    <li
                      key={item.id}
                      className={cn(
                        'flex items-start gap-2 text-[13px] leading-5 text-foreground',
                        strikethroughClass(item.doneAt !== null),
                      )}
                    >
                      <span
                        aria-hidden
                        className="mt-1.5 size-1.5 shrink-0 rounded-full bg-current"
                      />
                      {item.text}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}

            <SectionLabel count={card.comments.length}>{t('miniapp.card.comments')}</SectionLabel>
            {card.comments.length === 0 ? (
              <p className="text-muted-foreground mb-2 text-[13px] leading-5">
                {t('miniapp.card.noComments')}
              </p>
            ) : (
              <ScreenList className="mb-2">
                {card.comments.map((item) => (
                  <div key={item.id} className={cn(rowSurface, 'flex flex-col gap-1')}>
                    <span className="text-muted-foreground flex items-center gap-1 text-[11px]">
                      <MessageSquare className="size-3" aria-hidden />
                      {formatRelativeTime(new Date(item.createdAt), locale)}
                    </span>
                    <p className="text-foreground text-[13px] leading-5 whitespace-pre-wrap">
                      {item.body.text}
                    </p>
                  </div>
                ))}
              </ScreenList>
            )}

            <form onSubmit={onComment} className="flex flex-col gap-2">
              <Textarea
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                placeholder={t('miniapp.card.commentPlaceholder')}
                aria-label={t('miniapp.card.commentPlaceholder')}
                maxLength={10000}
                rows={3}
              />
              <Button type="submit" loading={sending} disabled={comment.trim() === ''}>
                <Send className="size-4" aria-hidden />
                {t('miniapp.card.send')}
              </Button>
            </form>
          </>
        )}
      </ScreenBody>
    </>
  )
}
