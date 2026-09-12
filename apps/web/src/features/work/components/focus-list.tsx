// v1.1 SPEC §7 (A9) -- "Diqqat markazi": up to five cards pinned to the top of My tasks and Home.
//
// ClickUp calls this LineUp. The point is not another list -- the department already has several --
// but a *short* one with a hard ceiling: five is small enough that re-reading it every morning is
// free, and a ceiling is what stops it becoming a second backlog. The server owns the number and
// returns it (`max`), so the sentence that explains a refused sixth pin and the rule that refuses it
// can never disagree.
//
// Personal by design: nobody else's pins ever appear here, and pinning somebody else's card to your
// own five is exactly the intended use.
import * as React from 'react'
import { AnimatePresence } from 'motion/react'
import { ArrowDown, ArrowUp, Pin, PinOff } from 'lucide-react'
import { useT, useLocale, formatDate } from '@devon/i18n'
import {
  Badge,
  HoverLift,
  IconButton,
  SectionCard,
  Skeleton,
  Stagger,
  StaggerItem,
  StateView,
  cn,
  toast,
} from '@devon/ui'
import { replaceSearchParam } from '../../../lib/router.js'
import {
  useFocusListQuery,
  useRemoveFocusMutation,
  useReorderFocusMutation,
} from '../hooks-plus.js'
import { RISK_BADGE_CLASSNAME, RISK_LABEL_KEY } from '../lib/format.js'
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
            'min-w-0 flex-1 truncate text-left text-small hover:underline',
            card.status === 'active' ? 'text-foreground' : 'text-muted-foreground line-through',
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
          <span className="shrink-0 text-caption tabular-nums text-muted-foreground">
            {formatDate(new Date(card.dueAt), locale)}
          </span>
        ) : null}
        {/* Reorder by button, not only by drag: five rows is exactly the size where two arrows beat
            a drag handle, and they work from the keyboard without any extra machinery. */}
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
  const max = query.data?.max ?? 5
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
    body = (
      <div className="flex flex-col gap-1.5" aria-busy="true">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    )
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
      <AnimatePresence initial={false}>
        <Stagger
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
      </AnimatePresence>
    )
  }

  if (variant === 'bare') {
    return (
      <section className={cn('flex flex-col gap-2', className)} aria-label={t('work.focus.title')}>
        <h3 className="flex items-center gap-1.5 text-small font-semibold uppercase tracking-(--text-eyebrow--letter-spacing) text-muted-foreground">
          <Pin className="size-3.5" aria-hidden="true" />
          {t('work.focus.title')}
          <span className="font-normal normal-case tabular-nums">
            {t('work.focus.count', { count: items.length, max })}
          </span>
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
