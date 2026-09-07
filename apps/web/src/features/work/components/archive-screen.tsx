// Archive page per person (TECH-SPEC §5: "archive page per person (department-readable, restore)").
// Defaults to the signed-in member's own archive; the member picker lets anyone in the department
// read anyone else's (RLS/`can()` already scope this to the department, not the person -- the
// server's `GET /api/v1/archive` has no special-case for "my own" vs "someone else's").
import * as React from 'react'
import { useT, useLocale, formatDate } from '@devon/i18n'
import { Badge, Button, Skeleton, Stagger, StaggerItem, StateView } from '@devon/ui'
import { useSession } from '../../../lib/session.js'
import { useArchiveQuery, useMembers, useRestoreCardMutation } from '../hooks.js'
import { PRIORITY_BADGE_TONE, PRIORITY_LABEL_KEY } from '../lib/format.js'
import { MemberPicker } from './member-picker.js'
import { CardPeekDialog, openCardPeek } from './card-peek-dialog.js'
import { WorkShell } from './work-shell.js'

export default function ArchiveScreen() {
  const t = useT()
  const locale = useLocale()
  const { user } = useSession()
  const members = useMembers()
  const [selected, setSelected] = React.useState<string | null>(null)
  const userId = selected ?? user?.id ?? null
  const archiveQuery = useArchiveQuery(userId)
  const restoreCard = useRestoreCardMutation()

  let body: React.ReactNode
  if (archiveQuery.isPending) {
    body = (
      <div className="flex flex-col gap-2">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    )
  } else if (archiveQuery.isError) {
    body = (
      <StateView
        kind="error"
        titleKey="state.error.title"
        bodyKey="state.error.body"
        action={{ labelKey: 'state.error.action', onAction: () => void archiveQuery.refetch() }}
      />
    )
  } else if (archiveQuery.data!.items.length === 0) {
    body = (
      <StateView kind="empty" titleKey="work.archive.emptyTitle" bodyKey="work.archive.emptyBody" />
    )
  } else {
    body = (
      <Stagger className="flex flex-col gap-2" animateKey={userId ?? ''}>
        {archiveQuery.data!.items.map((card) => (
          <StaggerItem
            key={card.id}
            className="flex items-center justify-between gap-3 rounded-md border border-border bg-card p-3"
          >
            <button
              type="button"
              onClick={() => openCardPeek(card.id)}
              className="min-w-0 flex-1 text-left"
            >
              <p className="truncate text-small text-foreground">{card.title}</p>
              <p className="text-caption text-muted-foreground">
                {card.archivedAt ? formatDate(new Date(card.archivedAt), locale) : ''}
              </p>
            </button>
            {card.priority !== 'none' ? (
              <Badge tone={PRIORITY_BADGE_TONE[card.priority]}>
                {t(PRIORITY_LABEL_KEY[card.priority])}
              </Badge>
            ) : null}
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void restoreCard.mutateAsync(card.id)}
            >
              {t('work.card.restore')}
            </Button>
          </StaggerItem>
        ))}
      </Stagger>
    )
  }

  return (
    <>
      <WorkShell showQuickAdd={false}>
        <div className="flex flex-col gap-4">
          <div className="max-w-72">
            <MemberPicker
              members={members}
              value={userId}
              onChange={setSelected}
              placeholderKey="work.field.unassigned"
              allowClear={false}
            />
          </div>
          {body}
        </div>
      </WorkShell>
      <CardPeekDialog />
    </>
  )
}
