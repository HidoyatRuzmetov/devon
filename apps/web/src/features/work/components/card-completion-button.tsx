import { useT } from '@devon/i18n'
import { Button, Celebrate, useCelebrate } from '@devon/ui'
import { Check, Undo2 } from 'lucide-react'
import type { Card } from '../api.js'
import { useCardCompletion } from '../hooks.js'

/** The drawer's primary lifecycle control also serves as a quiet action in Home's Done list. */
export function CardCompletionButton({
  card,
  inline = false,
  disabled = false,
}: {
  card: Card
  inline?: boolean
  disabled?: boolean
}) {
  const t = useT()
  const completion = useCardCompletion(card.id)
  const celebration = useCelebrate()
  const done = card.status === 'done'
  const Icon = done ? Undo2 : Check
  return (
    <span className="relative inline-flex shrink-0">
      <Button
        size="sm"
        variant={inline ? 'ghost' : done ? 'secondary' : 'primary'}
        aria-label={inline && done ? t('homeMember.reopenTask', { title: card.title }) : undefined}
        disabled={disabled || card.canEdit === false}
        loading={completion.isPending}
        onClick={() => void completion.toggle(card, celebration.fire)}
      >
        <Icon className="size-4" aria-hidden="true" />
        {t(done ? 'work.card.reopen' : 'work.card.markDone')}
      </Button>
      {!inline ? <Celebrate play={celebration.play} onDone={celebration.onDone} /> : null}
    </span>
  )
}
