// v1.1 SPEC §7 (A8) -- the multitask toolbar: select cards on the board or the table, then assign,
// label, set priority, set a due date, set an estimate, move (done/active) or archive the lot.
//
// One request, not one per card. The v1.0 table bar fired a PATCH per row through `Promise.all`:
// forty transactions, forty audit rows, forty independent chances of a partial result nobody can
// explain, and no way to undo the set *as a set*. `POST /cards/bulk` fixes all four and answers with
// the previous values of every card it touched, which is what the undo toast sends back -- undo over
// confirm (DESIGN.md), so the bar acts immediately and offers the way back.
import * as React from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Archive, Check, Tag, Timer, UserRound, X } from 'lucide-react'
import { parseEstimateMinutes } from '@devon/contracts'
import { useT, useLocale } from '@devon/i18n'
import {
  Button,
  DatePicker,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  springSettle,
  toast,
  toastWithUndo,
  useReducedMotion,
} from '@devon/ui'
import { useBulkPatchMutation, useBulkUndoMutation } from '../hooks-plus.js'
import { PRIORITY_LABEL_KEY } from '../lib/format.js'
import { fullName } from '../lib/format.js'
import type { BulkCardPatch, BulkCardResult } from '../api-plus.js'
import type { CardPriority, Label, MemberSummary } from '../api.js'

const PRIORITIES: readonly CardPriority[] = ['urgent', 'high', 'medium', 'low', 'none']

/** Keeps a selection honest as the underlying list changes: the board and the table both poll, so a
 * card can be archived by somebody else (or by an automation) while it sits selected. Pruning
 * against the ids currently on screen means the bar never acts on a row that is no longer there. */
export function useCardSelection(visibleIds: readonly string[]) {
  const [selected, setSelected] = React.useState<ReadonlySet<string>>(new Set())
  const visibleKey = visibleIds.join(',')

  React.useEffect(() => {
    const present = new Set(visibleIds)
    setSelected((prev) => {
      if (prev.size === 0) return prev
      const next = new Set([...prev].filter((id) => present.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [visibleKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = React.useCallback((id: string, on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  }, [])

  /** Shift-click range select, the behaviour every table in this class has (Jakob's Law). The caller
   * supplies the ordered ids it is rendering, so "the range" means what the user sees. */
  const selectRange = React.useCallback(
    (fromId: string, toId: string, ordered: readonly string[]) => {
      const a = ordered.indexOf(fromId)
      const b = ordered.indexOf(toId)
      if (a < 0 || b < 0) return
      const [start, end] = a <= b ? [a, b] : [b, a]
      setSelected((prev) => {
        const next = new Set(prev)
        for (let i = start; i <= end; i += 1) next.add(ordered[i]!)
        return next
      })
    },
    [],
  )

  const selectAll = React.useCallback((on: boolean, ids: readonly string[]) => {
    setSelected(on ? new Set(ids) : new Set())
  }, [])

  const clear = React.useCallback(() => setSelected(new Set()), [])

  return { selected, toggle, selectRange, selectAll, clear }
}

export interface MultitaskToolbarProps {
  ids: readonly string[]
  members: readonly MemberSummary[]
  labels: readonly Label[]
  onClear: () => void
  className?: string
}

export function MultitaskToolbar({
  ids,
  members,
  labels,
  onClear,
  className,
}: MultitaskToolbarProps): React.JSX.Element {
  const t = useT()
  const locale = useLocale()
  const bulkPatch = useBulkPatchMutation()
  const bulkUndo = useBulkUndoMutation()
  const [estimateDraft, setEstimateDraft] = React.useState('')
  const [estimateOpen, setEstimateOpen] = React.useState(false)

  /** Every action funnels through here, so the result message, the partial-refusal sentence and the
   * undo offer are written once rather than per button. */
  function apply(
    patch: BulkCardPatch,
    messageKey: string,
    extra?: Record<string, string | number>,
  ) {
    bulkPatch.mutate(
      { ids: [...ids], patch },
      {
        onSuccess: (result: BulkCardResult) => {
          const refused = result.forbidden.length + result.notFound.length
          if (result.updated.length === 0) {
            // Nothing moved -- say so plainly rather than showing a success toast for a no-op.
            toast.error(t('work.bulk.noneApplied'))
            return
          }
          onClear()
          const message =
            refused > 0
              ? `${t(messageKey, { count: result.updated.length, ...extra })} · ${t(
                  'work.bulk.partial',
                  { count: refused },
                )}`
              : t(messageKey, { count: result.updated.length, ...extra })
          toastWithUndo({
            message,
            undoLabel: t('action.undo'),
            onUndo: () =>
              bulkUndo.mutate(result.undo, {
                onSuccess: () => toast.success(t('work.bulk.undone')),
                onError: () => toast.error(t('work.bulk.undoFailed')),
              }),
          })
        },
        onError: () => toast.error(t('work.bulk.failed')),
      },
    )
  }

  const busy = bulkPatch.isPending || bulkUndo.isPending

  return (
    <div
      role="toolbar"
      aria-label={t('work.bulk.toolbarLabel')}
      className={
        'flex w-full flex-wrap items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-1.5 shadow-1 ' +
        (className ?? '')
      }
    >
      <span className="text-small font-medium text-foreground">
        {t('work.bulk.selectedCount', { count: ids.length })}
      </span>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="secondary" disabled={busy}>
            <UserRound className="size-3.5" aria-hidden="true" />
            {t('work.bulk.assign')}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
          <DropdownMenuItem onSelect={() => apply({ assigneeUserId: null }, 'work.bulk.assigned')}>
            {t('work.field.unassigned')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {members.map((m) => (
            <DropdownMenuItem
              key={m.userId}
              onSelect={() => apply({ assigneeUserId: m.userId }, 'work.bulk.assigned')}
            >
              {fullName(m)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="secondary" disabled={busy || labels.length === 0}>
            <Tag className="size-3.5" aria-hidden="true" />
            {t('work.bulk.label')}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
          <DropdownMenuLabel>{t('work.bulk.addLabel')}</DropdownMenuLabel>
          {labels.map((l) => (
            <DropdownMenuItem
              key={`add-${l.id}`}
              onSelect={() => apply({ addLabelIds: [l.id] }, 'work.bulk.labelAdded')}
            >
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: l.colour }}
                aria-hidden="true"
              />
              {l.name}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuLabel>{t('work.bulk.removeLabel')}</DropdownMenuLabel>
          {labels.map((l) => (
            <DropdownMenuItem
              key={`remove-${l.id}`}
              onSelect={() => apply({ removeLabelIds: [l.id] }, 'work.bulk.labelRemoved')}
            >
              <span
                className="size-2 shrink-0 rounded-full opacity-50"
                style={{ backgroundColor: l.colour }}
                aria-hidden="true"
              />
              {l.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="secondary" disabled={busy}>
            {t('work.bulk.priority')}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {PRIORITIES.map((priority) => (
            <DropdownMenuItem
              key={priority}
              onSelect={() => apply({ priority }, 'work.bulk.prioritySet')}
            >
              {t(PRIORITY_LABEL_KEY[priority])}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Left uncontrolled (`selected` always undefined): the bar sets a date on many cards at once,
          so there is no single "current" value it could show back. Picking a day applies it and the
          trigger returns to its placeholder. */}
      <DatePicker
        locale={locale}
        selected={undefined}
        onSelect={(date) => apply({ dueAt: date ? date.toISOString() : null }, 'work.bulk.dueSet')}
        label={t('work.bulk.due')}
        placeholder={t('work.bulk.due')}
        // `w-auto`: the picker trigger is `w-full` by default, which on a flex toolbar
        // claimed its own row and made the bar three rows tall (seen live on the board).
        triggerClassName="h-8 w-auto min-w-32"
      />

      <DropdownMenu open={estimateOpen} onOpenChange={setEstimateOpen}>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="secondary" disabled={busy}>
            <Timer className="size-3.5" aria-hidden="true" />
            {t('work.bulk.estimate')}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64 p-2">
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              const minutes = parseEstimateMinutes(estimateDraft.trim())
              if (minutes === null) {
                toast.error(t('work.estimate.unreadable'))
                return
              }
              setEstimateOpen(false)
              setEstimateDraft('')
              apply({ estimateMin: minutes }, 'work.bulk.estimateSet')
            }}
          >
            <label htmlFor="bulk-estimate" className="text-caption text-muted-foreground">
              {t('work.estimate.hint')}
            </label>
            <Input
              id="bulk-estimate"
              value={estimateDraft}
              onChange={(e) => setEstimateDraft(e.target.value)}
              placeholder={t('work.estimate.placeholder')}
              autoFocus
            />
            <div className="flex gap-2">
              <Button type="submit" size="sm">
                {t('common.save')}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setEstimateOpen(false)
                  setEstimateDraft('')
                  apply({ estimateMin: null }, 'work.bulk.estimateCleared')
                }}
              >
                {t('work.bulk.clearEstimate')}
              </Button>
            </div>
          </form>
        </DropdownMenuContent>
      </DropdownMenu>

      <Button
        size="sm"
        variant="secondary"
        disabled={busy}
        onClick={() => apply({ status: 'done' }, 'work.bulk.movedDone')}
      >
        <Check className="size-3.5" aria-hidden="true" />
        {t('work.bulk.markDone')}
      </Button>

      <Button
        size="sm"
        variant="secondary"
        disabled={busy}
        onClick={() => apply({ status: 'archived' }, 'work.bulk.archived')}
      >
        <Archive className="size-3.5" aria-hidden="true" />
        {t('work.card.archive')}
      </Button>

      <Button size="sm" variant="ghost" className="ml-auto" onClick={onClear} disabled={busy}>
        <X className="size-3.5" aria-hidden="true" />
        {t('work.bulk.clear')}
      </Button>
    </div>
  )
}

/** The toolbar's own entrance: it slides up from the header's bottom edge on the same spring the
 * app's sheets settle with, so it reads as "this appeared because you selected something" rather
 * than as a layout flicker. Shared by the board and the table so both animate identically. */
export function MultitaskToolbarSlot({
  show,
  children,
}: {
  show: boolean
  children: React.ReactNode
}): React.JSX.Element {
  const reduced = useReducedMotion()
  return (
    <AnimatePresence>
      {show ? (
        <motion.div
          key="multitask-toolbar"
          className="absolute inset-x-0 top-0 z-10"
          initial={reduced ? { opacity: 0 } : { y: 12, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={reduced ? { opacity: 0 } : { y: 12, opacity: 0 }}
          transition={reduced ? { duration: 0.15 } : springSettle}
        >
          {children}
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
