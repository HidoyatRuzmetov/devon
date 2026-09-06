// Table view (TECH-SPEC §5): every card the current `?q=` filter matches, one row each, with inline
// edit on title/assignee/priority/due -- the same `usePatchCardMutation` the card peek uses, so an
// edit here and an edit there are optimistic the same way.
import * as React from 'react'
import { useT, useLocale, formatDate } from '@devon/i18n'
import { Badge, Skeleton, StateView, Input } from '@devon/ui'
import { useSearchParams } from '../../../lib/router.js'
import { useCardsQuery, useMembers, usePatchCardMutation } from '../hooks.js'
import { PRIORITY_LABEL_KEY, RISK_BADGE_TONE, RISK_LABEL_KEY } from '../lib/format.js'
import { MemberPicker } from './member-picker.js'
import { CardPeekDialog, openCardPeek } from './card-peek-dialog.js'
import { WorkShell } from './work-shell.js'
import type { Card, CardPriority, MemberSummary } from '../api.js'

const PRIORITIES: readonly CardPriority[] = ['none', 'low', 'medium', 'high', 'urgent']

function TableRow({ card, members }: { card: Card; members: readonly MemberSummary[] }) {
  const t = useT()
  const locale = useLocale()
  const patchCard = usePatchCardMutation()
  const [title, setTitle] = React.useState(card.title)
  React.useEffect(() => setTitle(card.title), [card.title])

  return (
    <tr className="border-b border-border last:border-0 hover:bg-accent/50">
      <td className="p-2">
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() =>
            title.trim() &&
            title !== card.title &&
            patchCard.mutate({ id: card.id, patch: { title: title.trim() } })
          }
          className="h-9 border-transparent bg-transparent hover:border-border"
        />
      </td>
      <td className="p-2">
        <MemberPicker
          members={members}
          value={card.assigneeUserId}
          onChange={(userId) =>
            patchCard.mutate({ id: card.id, patch: { assigneeUserId: userId } })
          }
          placeholderKey="work.field.unassigned"
        />
      </td>
      <td className="p-2">
        <select
          value={card.priority}
          onChange={(e) =>
            patchCard.mutate({ id: card.id, patch: { priority: e.target.value as CardPriority } })
          }
          className="h-9 rounded-sm border border-transparent bg-transparent px-2 text-small hover:border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {t(PRIORITY_LABEL_KEY[p])}
            </option>
          ))}
        </select>
      </td>
      <td className="p-2 text-small text-foreground">
        <div className="flex items-center gap-2">
          {card.dueAt ? (
            formatDate(new Date(card.dueAt), locale)
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
          {card.risk !== 'none' ? (
            <Badge tone={RISK_BADGE_TONE[card.risk]}>{t(RISK_LABEL_KEY[card.risk])}</Badge>
          ) : null}
        </div>
      </td>
      <td className="p-2">
        <Badge tone="neutral">{t(`work.status.${card.status}`)}</Badge>
      </td>
      <td className="p-2">
        <button
          type="button"
          onClick={() => openCardPeek(card.id)}
          className="text-small text-primary underline underline-offset-2"
        >
          {t('work.table.open')}
        </button>
      </td>
    </tr>
  )
}

export default function TableScreen() {
  const t = useT()
  const search = useSearchParams()
  const q = search.get('q') ?? ''
  const cardsQuery = useCardsQuery({ q: q || undefined, limit: 100 })
  const members = useMembers()

  // Computed as a variable (not a chained JSX ternary) so each branch reads as its own statement --
  // also sidesteps `check-i18n.mjs`'s hard-coded-string heuristic, which mistakes the plain-text
  // `) : cardsQuery.isError ? (` branch separator of a multi-way ternary for a literal JSX text node.
  let body: React.ReactNode
  if (cardsQuery.isPending) {
    body = (
      <div className="flex flex-col gap-2">
        {[1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-10 w-full" />
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
  } else if (cardsQuery.data!.length === 0) {
    body = (
      <StateView kind="empty" titleKey="work.table.emptyTitle" bodyKey="work.table.emptyBody" />
    )
  } else {
    body = (
      <div className="overflow-x-auto">
        <table className="w-full min-w-180 border-collapse">
          <thead>
            <tr className="border-b border-border text-left text-caption uppercase tracking-(--text-eyebrow--letter-spacing) text-muted-foreground">
              <th className="p-2 font-medium">{t('work.field.title')}</th>
              <th className="p-2 font-medium">{t('work.field.assignee')}</th>
              <th className="p-2 font-medium">{t('work.field.priority')}</th>
              <th className="p-2 font-medium">{t('work.field.due')}</th>
              <th className="p-2 font-medium">{t('work.field.status')}</th>
              <th className="p-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {cardsQuery.data!.map((card) => (
              <TableRow key={card.id} card={card} members={members} />
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <>
      <WorkShell filterLayout="table">{body}</WorkShell>
      <CardPeekDialog />
    </>
  )
}
