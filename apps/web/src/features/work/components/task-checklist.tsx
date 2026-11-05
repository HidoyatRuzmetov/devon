import * as React from 'react'
import { useT } from '@devon/i18n'
import { Collapsible, IconButton, Input } from '@devon/ui'
import { ChevronDown, ListChecks, Plus } from 'lucide-react'
import type { Card, ChecklistItem } from '../api.js'
import {
  useAddChecklistItemMutation,
  useCardQuery,
  useDeleteChecklistItemMutation,
  usePatchChecklistItemMutation,
} from '../hooks.js'
import { useCheckinChange, useCheckins } from '../../analytics/checkins-api.js'
import { memberLock } from '../../analytics/checkin-locks.js'
import { ChecklistRow } from './checklist-row.js'

/** A compact canonical checklist, shared by project tasks and the person's task board.
 * Projects supply a batch of items; collapsed person cards do not fetch until opened. */
export function TaskChecklist({
  cardId,
  card,
  items,
  loading = false,
  defaultExpanded = true,
  total,
  done,
  compact = false,
}: {
  cardId: string
  card?: Card | undefined
  items?: ChecklistItem[] | undefined
  loading?: boolean
  defaultExpanded?: boolean
  total?: number
  done?: number
  compact?: boolean
}) {
  const t = useT()
  const [expanded, setExpanded] = React.useState(defaultExpanded)
  const regionId = React.useId()
  const query = useCardQuery(expanded && !items && !loading ? cardId : null)
  const source = query.data ?? card
  const checklist = items ?? query.data?.checklist
  const count = checklist?.length ?? total ?? card?.checklistTotal ?? 0
  const completed =
    checklist?.filter((item) => !!item.doneAt).length ?? done ?? card?.checklistDone ?? 0
  return (
    <div className={compact ? 'task-checklist min-w-0' : 'task-checklist min-w-0 pl-6'}>
      <button
        type="button"
        className="flex min-h-7 w-full items-center gap-1.5 rounded-sm py-1 text-left text-caption text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        aria-expanded={expanded}
        aria-controls={regionId}
        onClick={() => setExpanded((value) => !value)}
      >
        <ListChecks className="size-3.5" aria-hidden="true" />
        <span className="flex-1">{t('work.field.checklist')}</span>
        {count ? (
          <span className="tabular-nums">
            {completed}/{count}
          </span>
        ) : null}
        <ChevronDown
          className={`size-3.5 transition-transform motion-reduce:transition-none ${expanded ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>
      <Collapsible open={expanded} id={regionId}>
        {loading || (query.isPending && !checklist) ? (
          <div
            role="status"
            aria-label={t('state.loading')}
            className="space-y-2 py-2 motion-safe:animate-pulse"
          >
            {[0, 1].map((row) => (
              <div key={row} className="flex items-center gap-2">
                <div className="size-4 rounded border border-border bg-muted/50" />
                <div className={`h-3 rounded bg-muted ${row ? 'w-1/2' : 'w-3/4'}`} />
              </div>
            ))}
            <div className="h-8 rounded border border-border bg-muted/20" />
          </div>
        ) : query.isError ? (
          <button
            className="py-2 text-caption text-destructive"
            onClick={() => void query.refetch()}
          >
            {t('state.error.action')}
          </button>
        ) : source && checklist ? (
          <TaskChecklistContents key={cardId} card={source} items={checklist} />
        ) : null}
      </Collapsible>
    </div>
  )
}

function TaskChecklistContents({ card, items }: { card: Card; items: ChecklistItem[] }) {
  const t = useT()
  const [text, setText] = React.useState('')
  const add = useAddChecklistItemMutation(card.id)
  const patch = usePatchChecklistItemMutation(card.id)
  const remove = useDeleteChecklistItemMutation(card.id)
  const checkins = useCheckins()
  const changeCheckin = useCheckinChange()
  const cycle = checkins.data?.cycles.find((value) => value.id === checkins.data?.currentCycleId)
  const canEdit = card.canEdit !== false && !card.deletedAt
  const roots = items.filter(
    (item) => !item.parentItemId || !items.some((parent) => parent.id === item.parentItemId),
  )
  function render(item: ChecklistItem, ancestors: Set<string>): React.ReactNode {
    if (ancestors.has(item.id)) return null
    const nextAncestors = new Set([...ancestors, item.id])
    const entry = checkins.data?.entries.find(
      (value) => value.checklistItemId === item.id && value.cycleId === cycle?.id,
    )
    const assignee = entry?.memberUserId ?? card.assigneeUserId
    const lock =
      checkins.data && cycle && assignee ? memberLock(checkins.data, cycle, assignee) : undefined
    const children = items.filter((child) => child.parentItemId === item.id)
    const selected = !!entry
    const selectionReason =
      !cycle || lock?.checkoutLockedAt
        ? t('checklistDiscussion.cycleClosed')
        : selected && lock?.checkinLockedAt
          ? t('checklistDiscussion.selectionLocked')
          : !selected && (card.status !== 'active' || card.doneAt)
            ? t('checklistDiscussion.taskDone')
            : item.doneAt && !selected
              ? t('checklistDiscussion.alreadyDone')
              : undefined
    return (
      <div key={item.id}>
        <ChecklistRow
          cardId={card.id}
          item={item}
          canEdit={canEdit}
          onToggle={(value) => patch.mutate({ itemId: item.id, patch: { done: value } })}
          onSave={(value) => patch.mutateAsync({ itemId: item.id, patch: { text: value } })}
          onDelete={() => remove.mutate(item.id)}
          checkin={
            checkins.data?.members.some((member) => member.userId === assignee)
              ? {
                  selected,
                  disabled: !!selectionReason || changeCheckin.isPending,
                  reason: selectionReason,
                  toggle: () => {
                    if (entry) changeCheckin.mutate({ kind: 'remove', id: entry.id })
                    else if (cycle)
                      changeCheckin.mutate({ kind: 'add', cycleId: cycle.id, itemId: item.id })
                  },
                }
              : undefined
          }
        />
        {children.length ? (
          <div className="ml-5 border-l border-border/60 pl-2">
            {children.map((child) => render(child, nextAncestors))}
          </div>
        ) : null}
      </div>
    )
  }
  return (
    <div className="border-l border-border/70 pl-2 pb-1">
      {roots.map((item) => render(item, new Set()))}
      {canEdit ? (
        <form
          className="mt-1 flex items-center gap-1"
          onSubmit={(event) => {
            event.preventDefault()
            if (!text.trim() || add.isPending) return
            add.mutate({ text: text.trim() }, { onSuccess: () => setText('') })
          }}
        >
          <Input
            className="h-8 min-w-0 flex-1 bg-transparent text-small"
            aria-label={t('checklistDiscussion.addItem')}
            placeholder={t('checklistDiscussion.addItem')}
            maxLength={500}
            value={text}
            onChange={(event) => setText(event.target.value)}
            disabled={add.isPending}
          />
          <IconButton
            type="submit"
            className="size-8"
            aria-label={t('checklistDiscussion.addItem')}
            disabled={!text.trim() || add.isPending}
          >
            <Plus className="size-4" />
          </IconButton>
        </form>
      ) : null}
    </div>
  )
}
