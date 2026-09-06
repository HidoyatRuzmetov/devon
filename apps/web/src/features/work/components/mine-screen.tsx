// "Mine" view (TECH-SPEC §5): every card assigned to the signed-in user, across every project and
// standalone task, grouped by risk so what's overdue is never buried under what isn't.
import * as React from 'react'
import { useT, useLocale, formatDate, type Locale } from '@devon/i18n'
import { Badge, Skeleton, StateView } from '@devon/ui'
import { useSearchParams } from '../../../lib/router.js'
import { useCardsQuery } from '../hooks.js'
import {
  PRIORITY_BADGE_TONE,
  PRIORITY_LABEL_KEY,
  RISK_BADGE_TONE,
  RISK_LABEL_KEY,
} from '../lib/format.js'
import { openCardPeek, CardPeekDialog } from './card-peek-dialog.js'
import { WorkShell } from './work-shell.js'
import type { Card } from '../api.js'

function Group({ titleKey, cards, locale }: { titleKey: string; cards: Card[]; locale: Locale }) {
  const t = useT()
  if (cards.length === 0) return null
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-small font-semibold uppercase tracking-(--text-eyebrow--letter-spacing) text-muted-foreground">
        {t(titleKey)} ({cards.length})
      </h3>
      <div className="flex flex-col gap-1.5">
        {cards.map((card) => (
          <button
            key={card.id}
            type="button"
            onClick={() => openCardPeek(card.id)}
            className="flex items-center justify-between gap-3 rounded-md border border-border bg-card p-3 text-left hover:border-ring/50"
          >
            <span className="truncate text-small text-foreground">{card.title}</span>
            <span className="flex shrink-0 items-center gap-2">
              {card.priority !== 'none' ? (
                <Badge tone={PRIORITY_BADGE_TONE[card.priority]}>
                  {t(PRIORITY_LABEL_KEY[card.priority])}
                </Badge>
              ) : null}
              {card.risk !== 'none' ? (
                <Badge tone={RISK_BADGE_TONE[card.risk]}>{t(RISK_LABEL_KEY[card.risk])}</Badge>
              ) : null}
              {card.dueAt ? (
                <span className="text-caption text-muted-foreground">
                  {formatDate(new Date(card.dueAt), locale)}
                </span>
              ) : null}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

export default function MineScreen() {
  const locale = useLocale()
  const search = useSearchParams()
  const q = search.get('q') ?? ''
  const combinedQuery = q ? `${q} assignee:@me` : 'assignee:@me'
  // 100 is `GET /api/v1/cards`'s own hard cap (`work/schemas.ts`'s `limit: z.coerce.number()...
  // max(100)`) -- 200 always got a flat 422 (H1: confirmed live, "Mening vazifalarim" errored for
  // every signed-in user instead of showing their cards).
  const cardsQuery = useCardsQuery({ q: combinedQuery, limit: 100 })

  const cards = cardsQuery.data ?? []
  const overdue = cards.filter((c) => c.risk === 'overdue')
  const atRisk = cards.filter((c) => c.risk === 'at_risk')
  const rest = cards.filter((c) => c.risk === 'none')

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
        <Group titleKey="work.mine.overdue" cards={overdue} locale={locale} />
        <Group titleKey="work.mine.atRisk" cards={atRisk} locale={locale} />
        <Group titleKey="work.mine.rest" cards={rest} locale={locale} />
      </div>
    )
  }

  return (
    <>
      <WorkShell filterLayout="mine">{body}</WorkShell>
      <CardPeekDialog />
    </>
  )
}
