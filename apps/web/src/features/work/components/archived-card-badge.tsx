import { Archive } from 'lucide-react'
import { useT } from '@devon/i18n'
import { cn } from '@devon/ui'
import { isCardCompleted, type CardCompletion } from '../lib/format.js'

/** A lifecycle cue, separate from completion and the card's project colour. */
export function ArchivedCardBadge({
  card,
  className,
}: {
  card: CardCompletion
  className?: string
}) {
  const t = useT()
  if (card.status !== 'archived') return null
  const description = t(
    card.doneAt === undefined
      ? 'work.status.archived'
      : isCardCompleted(card)
        ? 'work.archive.completedHint'
        : 'work.archive.unfinishedHint',
  )
  return (
    <span
      role="img"
      className={cn(
        'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-sm bg-muted px-1.5 py-0.5 text-caption font-medium text-muted-foreground',
        className,
      )}
      title={description}
      aria-label={description}
    >
      <Archive className="size-3" aria-hidden="true" />
      {t('work.status.archived')}
    </span>
  )
}
