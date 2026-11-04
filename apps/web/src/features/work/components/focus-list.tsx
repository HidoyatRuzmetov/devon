import { ViewSkeleton } from '../../../lib/view-skeleton.js'
// Personal pins have no artificial limit and never affect another person’s ordering.
import * as React from 'react'
import { ArrowDown, ArrowUp, Pin, PinOff } from 'lucide-react'
import { useT, useLocale, formatDate } from '@devon/i18n'
import {
  Badge,
  cn,
  HoverLift,
  IconButton,
  SectionCard,
  Stagger,
  StaggerItem,
  StateView,
  strikethroughClass,
  toast,
} from '@devon/ui'
import { replaceSearchParam } from '../../../lib/router.js'
import {
  useFocusListQuery,
  useRemoveFocusMutation,
  useReorderFocusMutation,
} from '../hooks-plus.js'
import { RISK_BADGE_CLASSNAME, RISK_LABEL_KEY, isCardCompleted } from '../lib/format.js'
import type { FocusPin } from '../api-plus.js'

function PinRow({
  pin,
  index,
  total,
  onMove,
  onUnpin,
  busy,
}: {
  pin: FocusPin
  index: number
  total: number
  onMove: (from: number, to: number) => void
  onUnpin: () => void
  busy: boolean
}): React.JSX.Element {
  const t = useT()
  const locale = useLocale()
  const card = pin.card
  return (
    <HoverLift className="rounded-md">
      <div className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2">
        <span
          aria-hidden="true"
          className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-accent text-caption font-semibold text-accent-foreground tabular-nums"
        >
          {index + 1}
        </span>
        <button
          type="button"
          onClick={() => replaceSearchParam('card', card.id)}
          className={cn(
            'min-w-0 flex-1 text-left text-small hover:underline',
            // Two lines rather than one hard truncation: at 390 the five trailing controls left
            // "Hafta yaku..." on screen, which is not a task anybody can recognise.
            'line-clamp-2 break-words',
            // The strike arrives over `--dur-standard` rather than on the next frame, so a card
            // ticked off in the focus list reads as finishing rather than as a re-render.
            isCardCompleted(card) ? strikethroughClass(true) : 'text-foreground',
          )}
        >
          {card.title}
        </button>
        {card.risk !== 'none' ? (
          <Badge tone="neutral" className={RISK_BADGE_CLASSNAME[card.risk]}>
            {t(RISK_LABEL_KEY[card.risk])}
          </Badge>
        ) : null}
        {card.dueAt ? (
          <span className="hidden shrink-0 text-caption tabular-nums text-muted-foreground sm:inline">
            {formatDate(new Date(card.dueAt), locale)}
          </span>
        ) : null}
        {/* Personal pin ordering is also available from the keyboard. */}
        <IconButton
          aria-label={t('work.focus.moveUp', { title: card.title })}
          disabled={index === 0 || busy}
          onClick={() => onMove(index, index - 1)}
          className="shrink-0"
        >
          <ArrowUp className="size-4" aria-hidden="true" />
        </IconButton>
        <IconButton
          aria-label={t('work.focus.moveDown', { title: card.title })}
          disabled={index === total - 1 || busy}
          onClick={() => onMove(index, index + 1)}
          className="shrink-0"
        >
          <ArrowDown className="size-4" aria-hidden="true" />
        </IconButton>
        <IconButton
          aria-label={t('work.focus.unpinCard', { title: card.title })}
          disabled={busy}
          onClick={onUnpin}
          className="shrink-0"
        >
          <PinOff className="size-4" aria-hidden="true" />
        </IconButton>
      </div>
    </HoverLift>
  )
}

export interface FocusListProps {
  /** `card` renders the list inside a `SectionCard` (Home); `bare` renders just the rows, for a
   * screen that already supplies its own heading (My tasks). */
  variant?: 'card' | 'bare'
  className?: string
}

export function FocusList({
  variant = 'card',
  className,
}: FocusListProps): React.JSX.Element | null {
  const t = useT()
  const query = useFocusListQuery()
  const removeFocus = useRemoveFocusMutation()
  const reorder = useReorderFocusMutation()

  const items = query.data?.items ?? []
  const busy = removeFocus.isPending || reorder.isPending

  function move(from: number, to: number): void {
    if (to < 0 || to >= items.length) return
    const ids = items.map((pin) => pin.cardId)
    const [moved] = ids.splice(from, 1)
    if (!moved) return
    ids.splice(to, 0, moved)
    reorder.mutate(ids, { onError: () => toast.error(t('work.focus.failed')) })
  }

  let body: React.ReactNode
  if (query.isPending) {
    body = <ViewSkeleton view="focus" />
  } else if (query.isError) {
    body = (
      <StateView
        kind="error"
        compact
        titleKey="state.error.title"
        bodyKey="state.error.body"
        action={{ labelKey: 'state.error.action', onAction: () => void query.refetch() }}
      />
    )
  } else if (items.length === 0) {
    body = (
      <StateView
        kind="empty"
        compact
        titleKey="work.focus.emptyTitle"
        bodyKey="work.focus.emptyBody"
      />
    )
  } else {
    body = (
      <Stagger
        presence
        className="flex flex-col gap-1.5"
        animateKey={items.map((p) => p.cardId).join(',')}
      >
        {items.map((pin, index) => (
          <StaggerItem key={pin.cardId} exit="hidden" layout>
            <PinRow
              pin={pin}
              index={index}
              total={items.length}
              busy={busy}
              onMove={move}
              onUnpin={() =>
                removeFocus.mutate(pin.cardId, {
                  onSuccess: () => toast.success(t('work.focus.unpinned')),
                  onError: () => toast.error(t('work.focus.failed')),
                })
              }
            />
          </StaggerItem>
        ))}
      </Stagger>
    )
  }

  if (variant === 'bare') {
    return (
      <section className={cn('flex flex-col gap-2', className)} aria-label={t('work.focus.title')}>
        <h3 className="flex items-center gap-1.5 text-small font-semibold uppercase tracking-(--text-eyebrow--letter-spacing) text-muted-foreground">
          <Pin className="size-3.5" aria-hidden="true" />
          {t('work.focus.title')}
          <span className="font-normal normal-case tabular-nums">{items.length}</span>
        </h3>
        {body}
      </section>
    )
  }

  return (
    <SectionCard
      title={t('work.focus.title')}
      description={t('work.focus.description')}
      className={className}
    >
      {body}
    </SectionCard>
  )
}
