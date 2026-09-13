// "Mine" view (TECH-SPEC §5): every card assigned to the signed-in user, across every project and
// standalone task, grouped by risk so what's overdue is never buried under what isn't.
import * as React from 'react'
import { AnimatePresence } from 'motion/react'
import { useT, useLocale, formatDate, type Locale } from '@devon/i18n'
import { AlertCircle, ChevronDown, Clock3 } from 'lucide-react'
import {
  Badge,
  Checkbox,
  cn,
  Collapsible,
  HoverLift,
  PressScale,
  Skeleton,
  Stagger,
  StaggerItem,
  StateView,
  strikethroughClass,
} from '@devon/ui'
import { useSearchParams } from '../../../lib/router.js'
import { useCardsQuery, usePatchCardMutation } from '../hooks.js'
import {
  PRIORITY_BADGE_TONE,
  PRIORITY_LABEL_KEY,
  RISK_BADGE_CLASSNAME,
  RISK_ICON_NAME,
  RISK_LABEL_KEY,
} from '../lib/format.js'

const RISK_ICON = { AlertCircle, Clock3 } as const
import { openCardPeek, CardPeekDialog } from './card-peek-dialog.js'
import { FocusList } from './focus-list.js'
import { WorkShell } from './work-shell.js'
import type { Card } from '../api.js'

function MineRow({ card, locale }: { card: Card; locale: Locale }) {
  const t = useT()
  const patchCard = usePatchCardMutation()
  const done = card.status === 'done'
  return (
    <HoverLift className="rounded-md">
      <PressScale>
        <div className="flex w-full items-center gap-3 rounded-md border border-border bg-card p-3 hover:border-ring/50">
          {/* round2 SEV3.5 "completing from this list has no celebration": a real checkbox, the
              same `TaskRow`/`Checkbox` shape used everywhere else a card can be marked done from a
              list -- `celebrate` gives it the coin-sized burst on check. */}
          <Checkbox
            checked={done}
            onCheckedChange={(v) =>
              patchCard.mutate({ id: card.id, patch: { status: v === true ? 'done' : 'active' } })
            }
            celebrate
            size="sm"
            aria-label={card.title}
          />
          <button
            type="button"
            onClick={() => openCardPeek(card.id)}
            className="flex min-w-0 flex-1 items-center justify-between gap-3 text-left"
          >
            <span
              className={cn(
                'min-w-0 flex-1 truncate text-small',
                done ? strikethroughClass(true) : 'text-foreground',
              )}
            >
              {card.title}
            </span>
            <span className="flex shrink-0 items-center gap-2">
              {card.priority !== 'none' ? (
                <Badge tone={PRIORITY_BADGE_TONE[card.priority]}>
                  {t(PRIORITY_LABEL_KEY[card.priority])}
                </Badge>
              ) : null}
              {card.risk !== 'none'
                ? (() => {
                    const RiskIcon = RISK_ICON[RISK_ICON_NAME[card.risk]!]
                    return (
                      <Badge tone="neutral" className={RISK_BADGE_CLASSNAME[card.risk]}>
                        <RiskIcon className="size-3" aria-hidden="true" />
                        {t(RISK_LABEL_KEY[card.risk])}
                      </Badge>
                    )
                  })()
                : null}
              {card.dueAt ? (
                <span className="text-caption text-muted-foreground">
                  {formatDate(new Date(card.dueAt), locale)}
                </span>
              ) : null}
            </span>
          </button>
        </div>
      </PressScale>
    </HoverLift>
  )
}

function Group({
  groupKey,
  titleKey,
  cards,
  locale,
  animateKey,
  collapsed,
  onToggleCollapsed,
}: {
  groupKey: string
  titleKey: string
  cards: Card[]
  locale: Locale
  animateKey: string
  collapsed: boolean
  onToggleCollapsed: (key: string) => void
}) {
  const t = useT()
  if (cards.length === 0) return null
  return (
    <div className="flex flex-col gap-2">
      {/* round2 SEV3.5 "groups do not collapse": each risk group can fold away once it has been
          triaged, the same real height animation `Collapsible` gives everywhere else. */}
      <button
        type="button"
        aria-expanded={!collapsed}
        onClick={() => onToggleCollapsed(groupKey)}
        className="flex items-center gap-1.5 text-small font-semibold uppercase tracking-(--text-eyebrow--letter-spacing) text-muted-foreground hover:text-foreground"
      >
        <ChevronDown
          className={cn(
            'size-3.5 shrink-0 transition-transform duration-(--dur-micro)',
            collapsed && '-rotate-90',
          )}
          aria-hidden="true"
        />
        {t(titleKey)} ({cards.length})
      </button>
      <Collapsible open={!collapsed}>
        <AnimatePresence initial={false}>
          <Stagger className="flex flex-col gap-1.5" animateKey={animateKey}>
            {cards.map((card) => (
              <StaggerItem key={card.id} exit="hidden" layout>
                <MineRow card={card} locale={locale} />
              </StaggerItem>
            ))}
          </Stagger>
        </AnimatePresence>
      </Collapsible>
    </div>
  )
}

export default function MineScreen() {
  const locale = useLocale()
  const search = useSearchParams()
  const q = search.get('q') ?? ''
  const combinedQuery = q ? `${q} assignee:@me` : 'assignee:@me'
  const [collapsedGroups, setCollapsedGroups] = React.useState<ReadonlySet<string>>(new Set())
  function toggleGroupCollapsed(key: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }
  // 100 is `GET /api/v1/cards`'s own hard cap (`work/schemas.ts`'s `limit: z.coerce.number()...
  // max(100)`) -- 200 always got a flat 422 (H1: confirmed live, "Mening vazifalarim" errored for
  // every signed-in user instead of showing their cards).
  const cardsQuery = useCardsQuery({ q: combinedQuery, limit: 100 })

  const cards = cardsQuery.data ?? []
  // WALKTHROUGH-FINDINGS: "QOLGANLARI (14)" mixed struck-through completed cards in with work that
  // is simply not due yet -- two opposite states under one heading, and the count told you nothing.
  // Completed work now has its own group, and it comes last: the three groups above it are the ones
  // that need a decision today.
  const open = cards.filter((c) => c.status === 'active')
  const overdue = open.filter((c) => c.risk === 'overdue')
  const atRisk = open.filter((c) => c.risk === 'at_risk')
  const rest = open.filter((c) => c.risk === 'none')
  const completed = cards.filter((c) => c.status !== 'active')

  let body: React.ReactNode
  if (cardsQuery.isPending) {
    body = (
      <div className="flex flex-col gap-2">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    )
  } else if (cardsQuery.isError) {
    body = (
      <StateView
        kind="error"
        titleKey="state.error.title"
        bodyKey="state.error.body"
        action={{ labelKey: 'state.error.action', onAction: () => void cardsQuery.refetch() }}
      />
    )
  } else if (cards.length === 0) {
    body = <StateView kind="empty" titleKey="work.mine.emptyTitle" bodyKey="work.mine.emptyBody" />
  } else {
    body = (
      <div className="flex flex-col gap-6">
        <Group
          groupKey="overdue"
          titleKey="work.mine.overdue"
          cards={overdue}
          locale={locale}
          animateKey={combinedQuery}
          collapsed={collapsedGroups.has('overdue')}
          onToggleCollapsed={toggleGroupCollapsed}
        />
        <Group
          groupKey="atRisk"
          titleKey="work.mine.atRisk"
          cards={atRisk}
          locale={locale}
          animateKey={combinedQuery}
          collapsed={collapsedGroups.has('atRisk')}
          onToggleCollapsed={toggleGroupCollapsed}
        />
        <Group
          groupKey="rest"
          titleKey="work.mine.rest"
          cards={rest}
          locale={locale}
          animateKey={combinedQuery}
          collapsed={collapsedGroups.has('rest')}
          onToggleCollapsed={toggleGroupCollapsed}
        />
        <Group
          groupKey="completed"
          titleKey="work.mine.completed"
          cards={completed}
          locale={locale}
          animateKey={combinedQuery}
          // Collapsed on arrival: finished work is reassurance, not a to-do list.
          collapsed={!collapsedGroups.has('completed')}
          onToggleCollapsed={toggleGroupCollapsed}
        />
      </div>
    )
  }

  return (
    <>
      <WorkShell filterLayout="mine">
        <div className="flex flex-col gap-6">
          {/* A9: the pinned five come first -- a focus list that sits below three other groups is
              not a focus list. */}
          <FocusList variant="bare" />
          {body}
        </div>
      </WorkShell>
      <CardPeekDialog />
    </>
  )
}
