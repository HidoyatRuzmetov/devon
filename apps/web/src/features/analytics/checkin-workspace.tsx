import * as React from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'motion/react'
import type { CheckinBoard, CheckinMember } from '@devon/contracts'
import { useT } from '@devon/i18n'
import { Button, Checkbox, Dialog, DialogContent, IconButton, StateView } from '@devon/ui'
import {
  ArrowDownWideNarrow,
  Check,
  FolderKanban,
  GripVertical,
  LockKeyhole,
  Pencil,
  Plus,
  X,
} from 'lucide-react'
import { useDepartment, useSession } from '../../lib/session.js'
import { useCheckinCandidates, useCheckinChange } from './checkins-api.js'
import { memberLock } from './checkin-locks.js'
import { checkinGroups, checkinTasks } from './checkin-layout.js'
import { CheckinTaskView } from './checkin-task.js'
import { CheckinTimer } from './checkin-timer.js'
import { MemberAvatar, memberName } from './checkin-member.js'
import { CheckinCreateTask } from './checkin-create-task.js'

export function CheckinWorkspace({ data, member }: { data: CheckinBoard; member: CheckinMember }) {
  const t = useT(),
    { department, departmentId } = useDepartment(),
    session = useSession(),
    change = useCheckinChange()
  const reduced = useReducedMotion()
  const [creating, setCreating] = React.useState(false)
  const canCreateTask = department?.role === 'head' || session.user?.id === member.userId
  const cycle = data.cycles.find((c) => c.id === data.selectedCycleId)!
  const entries = data.entries.filter((e) => e.memberUserId === member.userId)
  const lock = memberLock(data, cycle, member.userId),
    closed = !!lock.checkoutLockedAt,
    locked = !!lock.checkinLockedAt
  const candidates = useCheckinCandidates(cycle.id, member.userId, !closed)
  const selectionKey = `devon.checkin.selection:${session.user?.id}:${departmentId}:${cycle.id}:${member.userId}`
  const [choices, setChoices] = React.useState<Record<string, boolean>>(() => {
    try {
      const value: unknown = JSON.parse(sessionStorage.getItem(selectionKey) ?? '{}')
      if (value && typeof value === 'object' && !Array.isArray(value))
        return Object.fromEntries(
          Object.entries(value).filter(
            ([id, selected]) => /^[0-9a-f-]{36}$/i.test(id) && typeof selected === 'boolean',
          ),
        )
    } catch {
      /* Keep the editor usable when storage is unavailable. */
    }
    return {}
  })
  const [editing, setEditing] = React.useState(
    !closed && (entries.length === 0 || Object.keys(choices).length > 0),
  )
  React.useEffect(() => {
    try {
      if (Object.keys(choices).length) sessionStorage.setItem(selectionKey, JSON.stringify(choices))
      else sessionStorage.removeItem(selectionKey)
    } catch {
      /* beforeunload still protects dirty choices in this mounted view. */
    }
  }, [choices, selectionKey])
  const committed = new Set(entries.map((e) => e.checklistItemId))
  const eligible = new Set(
    candidates.data?.flatMap((card) =>
      card.checklist.filter((item) => !item.doneAt).map((item) => item.id),
    ),
  )
  const selected = (id: string) =>
    (locked && committed.has(id)) || (choices[id] ?? committed.has(id))
  const [lockReview, setLockReview] = React.useState(false),
    [dontShow, setDontShow] = React.useState(false)
  const phase = locked ? 'checkout' : 'checkin'
  const preferenceKey = `devon_checkin_confirm:${session.user?.id}:${departmentId}:${phase}`
  const [dragging, setDragging] = React.useState<string | null>(null)
  const [dropTarget, setDropTarget] = React.useState<string | null>(null)
  const pointerDrag = React.useRef<{
    source: string
    x: number
    y: number
    active: boolean
  } | null>(null)
  const storedLayout = data.layouts.find(
    (l) => l.cycleId === cycle.id && l.memberUserId === member.userId,
  )
  const [pendingOrder, setPendingOrder] = React.useState<string[] | null>(null)
  const mode = pendingOrder ? 'manual' : (storedLayout?.mode ?? 'priority')
  const groups = checkinGroups(
    checkinTasks(entries, closed ? [] : (candidates.data ?? []), editing && !closed),
    mode,
    pendingOrder ?? storedLayout?.cardIds ?? [],
  )
  const dirty = Object.entries(choices).some(
    ([id, value]) => eligible.has(id) && value !== committed.has(id),
  )
  React.useEffect(() => {
    if (!dirty) return
    const beforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [dirty])
  function confirmLock(skipFuture = false) {
    change.mutate(
      { kind: 'lock', cycleId: cycle.id, memberUserId: member.userId, phase },
      {
        onSuccess: () => {
          if (skipFuture) {
            try {
              localStorage.setItem(preferenceKey, 'skip')
            } catch {
              /* Confirmation remains enabled. */
            }
          }
          setLockReview(false)
          setDontShow(false)
        },
      },
    )
  }
  function requestLock() {
    let skip = false
    try {
      skip = localStorage.getItem(preferenceKey) === 'skip'
    } catch {
      /* Safe default. */
    }
    if (skip) confirmLock()
    else {
      setDontShow(false)
      setLockReview(true)
    }
  }
  function save() {
    change.mutate(
      {
        kind: 'selection',
        cycleId: cycle.id,
        memberUserId: member.userId,
        body: {
          addItemIds: Object.entries(choices)
            .filter(([id, value]) => value && eligible.has(id) && !committed.has(id))
            .map(([id]) => id),
          removeEntryIds: entries
            .filter(
              (e) =>
                eligible.has(e.checklistItemId) && choices[e.checklistItemId] === false && !locked,
            )
            .map((e) => e.id),
        },
      },
      {
        onSuccess: () => {
          setChoices({})
          setEditing(false)
        },
      },
    )
  }
  function reorder(source: string, target: string) {
    if (source === target || change.isPending || closed) return
    const from = groups.findIndex((g) => g.id === source),
      to = groups.findIndex((g) => g.id === target)
    if (from < 0 || to < 0) return
    const next = [...groups]
    next.splice(to, 0, next.splice(from, 1)[0]!)
    const ids = next.flatMap((g) => g.cards.map((c) => c.id))
    setPendingOrder(ids)
    change.mutate(
      {
        kind: 'layout',
        cycleId: cycle.id,
        memberUserId: member.userId,
        body: { mode: 'manual', cardIds: ids, version: storedLayout?.version ?? 0 },
      },
      { onSettled: () => setPendingOrder(null) },
    )
  }
  const localDay = new Date(Date.now() + 5 * 3600000).toISOString().slice(0, 10)
  return (
    <section className="checkin-person" aria-label={memberName(member)}>
      {creating && !closed && canCreateTask ? (
        <CheckinCreateTask
          cycleId={cycle.id}
          memberUserId={member.userId}
          memberName={memberName(member)}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false)
            if (!dirty) setEditing(false)
          }}
        />
      ) : null}
      <Dialog open={lockReview} onOpenChange={setLockReview}>
        <DialogContent title={t(locked ? 'checkins.lockCheckout' : 'checkins.lockCheckin')}>
          <p className="my-4 text-small text-muted-foreground">
            {t(locked ? 'checkins.confirmCheckout' : 'checkins.confirmCheckin', {
              name: memberName(member),
            })}
          </p>
          <label className="mb-4 flex items-center gap-2 text-small">
            <Checkbox checked={dontShow} onCheckedChange={(v) => setDontShow(v === true)} />
            {t('checkins.dontShowAgain')}
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setLockReview(false)}>
              {t('checkins.cancel')}
            </Button>
            <Button disabled={change.isPending} onClick={() => confirmLock(dontShow)}>
              {t(locked ? 'checkins.lockCheckout' : 'checkins.lockCheckin')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <header className="checkin-person-header">
        <MemberAvatar member={member} large />
        <div className="min-w-0 flex-1">
          <h1 className="text-h2 font-semibold leading-tight">{memberName(member)}</h1>
          <div className="checkin-person-summary">
            <span>{t('checkins.total', { count: entries.length })}</span>
            <span>
              {t('checkins.doneCount', { count: entries.filter((e) => e.state === 'done').length })}
            </span>
            <span
              className="inline-flex items-center gap-1"
              // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Keyboard users can focus the lock explanation.
              tabIndex={0}
              title={t(
                closed
                  ? 'checkins.closedHint'
                  : locked
                    ? 'checkins.agreedHint'
                    : 'checkins.draftHint',
              )}
            >
              {locked ? <LockKeyhole className="size-3.5" /> : null}
              {t(closed ? 'checkins.closed' : locked ? 'checkins.agreed' : 'checkins.draft')}
            </span>
          </div>
        </div>
        <div className="checkin-header-actions">
          <CheckinTimer />
          <IconButton
            aria-label={t(mode === 'priority' ? 'checkins.sortPriority' : 'checkins.sortManual')}
            tooltip={t(mode === 'priority' ? 'checkins.sortPriority' : 'checkins.sortManual')}
            aria-pressed={mode === 'manual'}
            disabled={closed || change.isPending}
            onClick={() =>
              change.mutate({
                kind: 'layout',
                cycleId: cycle.id,
                memberUserId: member.userId,
                body: {
                  mode: mode === 'priority' ? 'manual' : 'priority',
                  cardIds: groups.flatMap((g) => g.cards.map((c) => c.id)),
                  version: storedLayout?.version ?? 0,
                },
              })
            }
          >
            {mode === 'priority' ? <ArrowDownWideNarrow /> : <GripVertical />}
          </IconButton>
          {department?.role === 'head' && !closed ? (
            <Button
              variant="secondary"
              size="sm"
              disabled={change.isPending || dirty || (locked && localDay < cycle.endsOn)}
              onClick={requestLock}
            >
              <LockKeyhole className="size-4" />
              {t(locked ? 'checkins.lockCheckout' : 'checkins.lockCheckin')}
            </Button>
          ) : null}
        </div>
      </header>
      <div className="checkin-task-scroll">
        {editing ? (
          <p className="checkin-selection-hint">
            {t(locked ? 'checkins.selectAddOnly' : 'checkins.selectHint')}
          </p>
        ) : null}
        {candidates.isPending && editing ? (
          <div className="checkin-task-columns" aria-busy="true">
            {[1, 2, 3].map((i) => (
              <div key={i} className="checkin-task-skeleton">
                <div />
                <span />
                <span />
                <span />
              </div>
            ))}
          </div>
        ) : candidates.isError && editing ? (
          <StateView
            kind="error"
            titleKey="state.error.title"
            action={{ labelKey: 'state.error.action', onAction: () => candidates.refetch() }}
          />
        ) : (
          <div className="checkin-task-columns" data-editing={editing}>
            <AnimatePresence initial={false} mode="popLayout">
              {groups.map((group, index) => (
                <motion.div
                  key={group.id}
                  layout="position"
                  initial={{ opacity: 0, y: reduced ? 0 : 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: reduced ? 0 : -8 }}
                  transition={
                    reduced ? { duration: 0 } : { type: 'spring', stiffness: 380, damping: 34 }
                  }
                  className="checkin-group"
                  data-checkin-group={group.id}
                  data-dragging={dragging === group.id}
                  data-drop-target={dropTarget === group.id && dragging !== group.id}
                >
                  <div className="checkin-group-bar">
                    {group.cards[0]!.projectId ? (
                      <h2>
                        <FolderKanban className="size-4 shrink-0" />
                        {group.cards[0]!.projectTitle}
                      </h2>
                    ) : (
                      <span className="text-caption text-muted-foreground">
                        {t('checkins.individual')}
                      </span>
                    )}
                    {!closed ? (
                      <button
                        className="checkin-drag-handle"
                        aria-label={t('checkins.reorder')}
                        title={t('checkins.reorderHint')}
                        type="button"
                        disabled={change.isPending}
                        onPointerDown={(event) => {
                          if (event.button !== 0 || change.isPending || closed) return
                          event.preventDefault()
                          event.currentTarget.focus({ preventScroll: true })
                          event.currentTarget.setPointerCapture(event.pointerId)
                          pointerDrag.current = {
                            source: group.id,
                            x: event.clientX,
                            y: event.clientY,
                            active: false,
                          }
                        }}
                        onPointerMove={(event) => {
                          const drag = pointerDrag.current
                          if (!drag) return
                          if (
                            !drag.active &&
                            Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 5
                          )
                            return
                          drag.active = true
                          setDragging(drag.source)
                          const target = document
                            .elementFromPoint(event.clientX, event.clientY)
                            ?.closest<HTMLElement>('[data-checkin-group]')
                          setDropTarget(target?.dataset['checkinGroup'] ?? null)
                        }}
                        onPointerUp={(event) => {
                          const drag = pointerDrag.current
                          const target = document
                            .elementFromPoint(event.clientX, event.clientY)
                            ?.closest<HTMLElement>('[data-checkin-group]')?.dataset['checkinGroup']
                          pointerDrag.current = null
                          setDragging(null)
                          setDropTarget(null)
                          if (drag?.active && target) reorder(drag.source, target)
                        }}
                        onLostPointerCapture={() => {
                          pointerDrag.current = null
                          setDragging(null)
                          setDropTarget(null)
                        }}
                        onPointerCancel={() => {
                          pointerDrag.current = null
                          setDragging(null)
                          setDropTarget(null)
                        }}
                        onKeyDown={(e) => {
                          if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key))
                            return
                          e.preventDefault()
                          e.stopPropagation()
                          const target =
                            groups[index + (e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 1)]
                          if (target) reorder(group.id, target.id)
                        }}
                      >
                        <GripVertical className="size-4" />
                      </button>
                    ) : null}
                  </div>
                  {group.cards.map((task) => (
                    <CheckinTaskView
                      key={task.id}
                      task={task}
                      editing={editing && !closed}
                      selected={selected}
                      locked={locked}
                      closed={closed}
                      choose={(id) =>
                        setChoices((current) => ({ ...current, [id]: !selected(id) }))
                      }
                    />
                  ))}
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
        {!groups.length && !candidates.isPending ? (
          <div className="checkin-empty">
            <p>{t(editing ? 'checkins.noSourceTasks' : 'checkins.empty')}</p>
          </div>
        ) : null}
      </div>
      {!closed ? (
        <div className="checkin-selection-actions">
          {canCreateTask ? (
            <Button
              variant="secondary"
              disabled={change.isPending}
              onClick={() => setCreating(true)}
            >
              <Plus className="size-4" />
              {t('checkinTask.create')}
            </Button>
          ) : null}
          {editing && entries.length > 0 ? (
            <IconButton
              aria-label={t('checkins.cancel')}
              disabled={change.isPending}
              onClick={() => {
                setChoices({})
                setEditing(false)
              }}
            >
              <X />
            </IconButton>
          ) : null}
          <Button
            className="checkin-selection-toggle"
            disabled={change.isPending || (editing && !candidates.data)}
            onClick={() => (editing ? save() : setEditing(true))}
          >
            {editing ? <Check /> : <Pencil />}
            {t(editing ? 'checkins.saveSelection' : 'checkins.editSelection')}
          </Button>
        </div>
      ) : null}
    </section>
  )
}
