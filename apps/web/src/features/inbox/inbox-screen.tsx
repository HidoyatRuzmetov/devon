// `/inbox` (this module's task: "inbox drawer + page with mark read/archive"). A department table's
// usual `department_child` permission does not apply here -- every route reads/writes only the signed
// -in user's own notifications (`{ kind: 'personal', ownerUserId }`, `apps/api/src/modules/
// notifications/index.ts`), so the only gate this screen needs is "is anyone signed in at all",
// exactly like `HomeRoute`.
//
// UI-OVERHAUL.md "Inbox to Linear quality": list + detail split at >=768 (the list stays mounted and
// keeps its scroll position while the right pane swaps -- Linear/Gmail's own shape), stacking to a
// bottom sheet at 390; unread dot and coloured reason chips; j/k to move the selection, Enter to
// open, `e` to archive (Gmail's own keys); grouped by reason; an empty inbox that actually celebrates
// zero instead of showing the same blank illustration as every other empty list.
import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import { useT } from '@devon/i18n'
import {
  AllDoneIllustration,
  Badge,
  Button,
  Celebrate,
  Chip,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyInboxIllustration,
  PageHeader,
  Stagger,
  StaggerItem,
  StateView,
  cn,
  toast,
  toastWithUndo,
  useCelebrate,
  useReducedMotion,
} from '@devon/ui'
import { CalendarDays, Check, CheckCheck, SlidersHorizontal, View } from 'lucide-react'
import { useForcedState } from '../../lib/forced-state.js'
import { useMediaQuery } from '../../lib/use-media-query.js'
import { useMeQuery } from '../../lib/session.js'
import { useOnline } from '../../lib/use-online.js'
import { navigate } from '../../lib/router.js'
import { ForcedStateBlock } from '../../shell/forced-state-block.js'
import { fetchIcsUrl, REASONS, type InboxStatus, type NotificationDto } from './api.js'
import {
  useArchiveMutation,
  useMarkAllReadMutation,
  useMarkReadMutation,
  useNotificationsQuery,
  useSnoozeMutation,
  useUndoableArchive,
} from './hooks.js'
import { NotificationDetail } from './notification-sheet.js'
import { NotificationRow } from './notification-row.js'
import { NotificationSheet } from './notification-sheet.js'
import { REASON_TONE, ReasonIcon } from './reason-icon.js'

const TABS: readonly InboxStatus[] = ['inbox', 'unread', 'archived']

/** Which row the j/k cursor is on, by id.
 *
 * Motion verdict F5, the last of it. Passing the selection down as a prop meant a tab click changed
 * a prop on a whole panel, and a panel re-render is not cheap even when every row memo bails:
 * `AnimatePresence`'s own `PresenceChild` / `PopChild` / `PopChildMeasure` wrappers are rebuilt for
 * each of the ~38 rows (measured: 57 ms of the 71 ms a switch cost, with the rows themselves
 * accounting for 8.8 ms of it). Through context the panels' props never change on a tab switch at
 * all -- the switch is purely the `hidden` attribute on two wrapper `div`s -- and a j/k press
 * re-renders the rows, which is the only thing that actually changed. */
const SelectedNotificationContext = React.createContext<string | null>(null)

function InboxTabs({
  status,
  onChange,
  unreadCount,
}: {
  status: InboxStatus
  onChange: (status: InboxStatus) => void
  unreadCount: number
}) {
  const t = useT()
  return (
    <div role="tablist" aria-label={t('inbox.title')} className="flex gap-1 border-b border-border">
      {TABS.map((tab) => (
        <button
          key={tab}
          type="button"
          role="tab"
          aria-selected={status === tab}
          onClick={() => onChange(tab)}
          className={cn(
            'flex items-center gap-2 border-b-2 px-3 py-2 text-body transition-colors duration-(--dur-micro)',
            status === tab
              ? 'border-primary text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground',
          )}
        >
          {t(`inbox.tabs.${tab}`)}
          {tab === 'unread' && unreadCount > 0 ? <Badge tone="info">{unreadCount}</Badge> : null}
        </button>
      ))}
    </div>
  )
}

/** j/k/Enter/e -- Gmail and Linear's own inbox keys. Disabled while focus sits in a text field (the
 * quiet-hours time inputs on the preferences screen, a comment box elsewhere) so a stray "j" never
 * eats a keystroke a person meant to type. */
function useListKeyboardNav({
  items,
  selectedIndex,
  setSelectedIndex,
  onOpen,
  onArchive,
}: {
  items: readonly NotificationDto[]
  selectedIndex: number
  setSelectedIndex: (i: number) => void
  onOpen: (notification: NotificationDto) => void
  onArchive: (id: string) => void
}) {
  React.useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null
      if (target && /^(input|textarea|select)$/i.test(target.tagName)) return
      if (target?.isContentEditable) return
      if (items.length === 0) return

      if (e.key === 'j') {
        e.preventDefault()
        setSelectedIndex(Math.min(items.length - 1, selectedIndex + 1))
      } else if (e.key === 'k') {
        e.preventDefault()
        setSelectedIndex(Math.max(0, selectedIndex - 1))
      } else if (e.key === 'Enter') {
        const current = items[selectedIndex]
        if (current) {
          e.preventDefault()
          onOpen(current)
        }
      } else if (e.key === 'e') {
        const current = items[selectedIndex]
        if (current) {
          e.preventDefault()
          onArchive(current.id)
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [items, selectedIndex, setSelectedIndex, onOpen, onArchive])
}

/** Motion verdict F5. A tab click cost a 499 ms long task followed by a 238 ms one, and the
 * re-stagger it should have played started after half a second of frozen UI. The cost was
 * re-rendering ~30 notification rows; this is the half of the fix that stops that happening on every
 * parent render.
 *
 * The inline `() => onOpen(notification, index)` closures the rows used to be handed were rebuilt on
 * every render, so a plain `React.memo` around `NotificationRow` would never have held. They are
 * built *inside* this component instead, from props that are genuinely stable: the parent's handlers
 * are `useCallback`s and `notification` is the object react-query already keeps identical between
 * refetches, so the default shallow comparison is exactly right and needs no hand-written
 * `areEqual`. */
const InboxRow = React.memo(function InboxRow({
  notification,
  index,
  showReasonChip,
  onOpen,
  onArchive,
  onQuickAction,
  onSnooze,
  ref,
}: {
  notification: NotificationDto
  index: number
  showReasonChip?: boolean
  onOpen: (notification: NotificationDto, index: number) => void
  onArchive: (id: string) => void
  onQuickAction: (notification: NotificationDto) => void
  onSnooze: (id: string, minutes: number) => void
  /** `<Stagger presence>`'s `AnimatePresence mode="popLayout"` clones its presence child with a ref
   * so it can measure the leaving row; this component *is* that child, so the ref has to reach the
   * `<li>` underneath. */
  ref?: React.Ref<HTMLElement>
}) {
  const selected = React.useContext(SelectedNotificationContext) === notification.id
  // A context change re-renders every consumer, and there are ~76 rows mounted across the three
  // tabs -- but only two of them ever *change* when the cursor moves. Caching the element means the
  // other 74 re-render into the identical element and React skips their subtree entirely, which is
  // the difference between 238 ms and ~8 ms on a tab switch.
  //
  // The `StaggerItem` is inside this boundary on purpose: left outside it, each list render rebuilt
  // every `motion.li` -- a `layout` projection node apiece, wrapped by `AnimatePresence`'s own
  // `PresenceChild`/`PopChild` -- before the row's memo could bail (motion verdict F5).
  return React.useMemo(
    () => (
      <StaggerItem {...(ref ? { ref } : {})} as="li" exit="hidden" layout>
        <NotificationRow
          notification={notification}
          selected={selected}
          {...(showReasonChip === undefined ? {} : { showReasonChip })}
          onOpen={() => onOpen(notification, index)}
          onQuickAction={() => onQuickAction(notification)}
          onArchive={() => onArchive(notification.id)}
          onSnooze={(minutes) => onSnooze(notification.id, minutes)}
        />
      </StaggerItem>
    ),
    [
      ref,
      notification,
      selected,
      showReasonChip,
      index,
      onOpen,
      onQuickAction,
      onArchive,
      onSnooze,
    ],
  )
})

function InboxList({
  items,
  onOpen,
  onArchive,
  onQuickAction,
  onSnooze,
  listKey,
}: {
  items: readonly NotificationDto[]
  listKey: string
  onOpen: (notification: NotificationDto, index: number) => void
  onArchive: (id: string) => void
  onQuickAction: (notification: NotificationDto) => void
  onSnooze: (id: string, minutes: number) => void
}) {
  return (
    // round2 SEV2 "archiving a row removes it instantly": `StaggerItem`'s own `exit="hidden"`
    // reverses its entrance variant, `layout` slides the remaining rows up to close the gap --
    // and `presence` on the `Stagger` is what lets either play at all: the presence boundary has to
    // live *inside* the list container, or the rows are `AnimatePresence`'s grandchildren and inert.
    <Stagger
      presence
      as="ul"
      animateKey={listKey}
      className="rounded-md border border-border bg-card"
    >
      {items.map((notification, index) => (
        <InboxRow
          key={notification.id}
          notification={notification}
          index={index}
          onOpen={onOpen}
          onQuickAction={onQuickAction}
          onArchive={onArchive}
          onSnooze={onSnooze}
        />
      ))}
    </Stagger>
  )
}

function GroupedInboxList({
  items,
  onOpen,
  onArchive,
  onQuickAction,
  onSnooze,
  listKey,
}: {
  items: readonly NotificationDto[]
  listKey: string
  onOpen: (notification: NotificationDto, index: number) => void
  onArchive: (id: string) => void
  onQuickAction: (notification: NotificationDto) => void
  onSnooze: (id: string, minutes: number) => void
}) {
  const t = useT()
  const indexOf = new Map(items.map((n, i) => [n.id, i]))
  return (
    <div className="flex flex-col gap-6">
      {REASONS.map((reason) => {
        const group = items.filter((n) => n.reason === reason)
        if (group.length === 0) return null
        return (
          <section key={reason} className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Chip
                tone={REASON_TONE[reason]}
                leading={<ReasonIcon reason={reason} className="size-3" />}
              >
                {t(`inbox.reason.${reason}`)}
              </Chip>
              <span className="text-caption text-muted-foreground">{group.length}</span>
            </div>
            <Stagger
              presence
              as="ul"
              animateKey={listKey}
              className="rounded-md border border-border bg-card"
            >
              {group.map((notification) => (
                <InboxRow
                  key={notification.id}
                  notification={notification}
                  index={indexOf.get(notification.id) ?? 0}
                  showReasonChip={false}
                  onOpen={onOpen}
                  onQuickAction={onQuickAction}
                  onArchive={onArchive}
                  onSnooze={onSnooze}
                />
              ))}
            </Stagger>
          </section>
        )
      })}
    </div>
  )
}

/** One tab's list, memoised -- and deliberately unaware of which tab is showing.
 *
 * Motion verdict F5. All three lists stay mounted, so a tab switch has to be a visibility change and
 * nothing else. Everything that changes on a switch (`hidden`, the entrance class) therefore lives on
 * the wrapper *outside* this memo, and the selection reaches the rows through
 * `SelectedNotificationContext` rather than as a prop. The result is that a tab click re-renders no
 * panel at all: measured, a panel re-render cost 71 ms, of which 57 ms was `AnimatePresence`
 * rebuilding its `PresenceChild`/`PopChild` wrappers around ~38 rows that had not changed. */
const InboxTabPanel = React.memo(function InboxTabPanel({
  tab,
  items,
  isPending,
  isError,
  onRetry,
  grouped,
  onOpen,
  onArchive,
  onQuickAction,
  onSnooze,
  zeroCelebrate,
}: {
  tab: InboxStatus
  /** The query's *data*, never the query object: `useQuery` hands back a fresh result object on
   * every render, and passing that object was on its own enough to make this memo a no-op -- the
   * panel kept re-rendering (65-280 ms a switch) long after the rows themselves had stopped. */
  items: readonly NotificationDto[] | undefined
  isPending: boolean
  isError: boolean
  onRetry: () => void
  grouped: boolean
  onOpen: (notification: NotificationDto, index: number) => void
  onArchive: (id: string) => void
  onQuickAction: (notification: NotificationDto) => void
  onSnooze: (id: string, minutes: number) => void
  zeroCelebrate?: { play: boolean; onDone: () => void }
}) {
  return (
    <InboxBody
      items={items}
      isPending={isPending}
      isError={isError}
      onRetry={onRetry}
      status={tab}
      grouped={grouped}
      onOpen={onOpen}
      onArchive={onArchive}
      onQuickAction={onQuickAction}
      onSnooze={onSnooze}
      {...(zeroCelebrate ? { zeroCelebrate } : {})}
    />
  )
})

function InboxBody({
  items,
  isPending,
  isError,
  onRetry,
  status,
  grouped,
  onOpen,
  onArchive,
  onQuickAction,
  onSnooze,
  zeroCelebrate,
}: {
  items: readonly NotificationDto[] | undefined
  isPending: boolean
  isError: boolean
  onRetry: () => void
  status: InboxStatus
  grouped: boolean
  onOpen: (notification: NotificationDto, index: number) => void
  onArchive: (id: string) => void
  onQuickAction: (notification: NotificationDto) => void
  onSnooze: (id: string, minutes: number) => void
  /** UI-OVERHAUL.md §3 "RSVP yes, card done, sprint complete": inbox zero gets the same one-shot
   * burst, fired only on the *transition* into empty (never on every visit to an already-empty
   * inbox) -- `inbox-screen.tsx` owns that transition detection. */
  zeroCelebrate?: { play: boolean; onDone: () => void }
}) {
  if (isPending || items === undefined) {
    return <StateView kind="loading" titleKey="state.loading" />
  }
  if (isError) {
    return (
      <StateView
        kind="error"
        titleKey="state.error.title"
        bodyKey="state.error.body"
        action={{ labelKey: 'state.error.action', onAction: onRetry }}
      />
    )
  }
  if (items.length === 0) {
    return (
      <StateView
        kind="empty"
        titleKey={`inbox.empty.${status}.title`}
        bodyKey={`inbox.empty.${status}.body`}
        illustration={
          status === 'inbox' ? (
            <span className="relative inline-flex">
              <AllDoneIllustration />
              {zeroCelebrate ? (
                <Celebrate play={zeroCelebrate.play} onDone={zeroCelebrate.onDone} radius={40} />
              ) : null}
            </span>
          ) : (
            <EmptyInboxIllustration />
          )
        }
      />
    )
  }
  // The tab is the filter here: switching Inbox -> Archive -> All swaps the whole list for a
  // different one, and DESIGN.md §10 re-enters a list "on first render and on filter change".
  // Archiving a single row is *not* a filter change, so the key is the tab, never the item count.
  const props = {
    items,
    onOpen,
    onArchive,
    onQuickAction,
    onSnooze,
    listKey: status,
  }
  return grouped ? <GroupedInboxList {...props} /> : <InboxList {...props} />
}

export default function InboxScreen() {
  const t = useT()
  const forced = useForcedState()
  const online = useOnline()
  const detailCrossfadeReduced = useReducedMotion()
  const meQuery = useMeQuery()
  const [status, setStatus] = React.useState<InboxStatus>('inbox')
  const [openId, setOpenId] = React.useState<string | null>(null)
  const [selectedIndex, setSelectedIndex] = React.useState(0)
  // UI-OVERHAUL.md §8: grouped by reason is the default view, not an opt-in someone has to find --
  // the toggle moved into a "View" menu (below) rather than staying its own header button.
  const [grouped, setGrouped] = React.useState(true)
  // The split becomes a stack below this width (UI-OVERHAUL.md "stack at 390") -- Tailwind's own
  // `md` breakpoint, so this hook's threshold and the `md:` classes below never drift apart.
  const isDesktop = useMediaQuery('(min-width: 768px)')

  const settled = !meQuery.isPending

  React.useEffect(() => {
    if (forced) return
    if (settled && meQuery.data === null) navigate('/login')
  }, [forced, settled, meQuery.data])

  // Motion verdict F5: all three tab lists stay mounted and the inactive two are hidden, so
  // Barchasi -> Oʻqilmagan is a visibility change rather than an unmount of thirty rows and a mount
  // of thirty more. Only the tab in view polls (`useNotificationsQuery`'s `active`).
  const inboxQuery = useNotificationsQuery('inbox', status === 'inbox')
  const unreadQuery = useNotificationsQuery('unread', status === 'unread')
  const archivedQuery = useNotificationsQuery('archived', status === 'archived')
  const queryByStatus: Record<InboxStatus, ReturnType<typeof useNotificationsQuery>> = {
    inbox: inboxQuery,
    unread: unreadQuery,
    archived: archivedQuery,
  }
  const notificationsQuery = queryByStatus[status]
  // Stable per tab, so a fresh `onRetry` closure per render cannot break `InboxTabPanel`'s memo.
  const queryClient = useQueryClient()
  const retryByStatus = React.useMemo<Record<InboxStatus, () => void>>(() => {
    const make = (tab: InboxStatus) => () => {
      void queryClient.refetchQueries({ queryKey: ['inbox', 'notifications', tab] })
    }
    return { inbox: make('inbox'), unread: make('unread'), archived: make('archived') }
  }, [queryClient])
  const markRead = useMarkReadMutation()
  const markAllRead = useMarkAllReadMutation()
  const snooze = useSnoozeMutation()
  const archiveNow = useArchiveMutation()
  const archiveUndoable = useUndoableArchive()

  const items = notificationsQuery.data?.items ?? []
  // The j/k cursor as an id, for `SelectedNotificationContext` (see its own note): the panels stay
  // memoised and only the rows re-render when the selection moves.
  const selectedId = items[selectedIndex]?.id ?? null
  const unreadCount = notificationsQuery.data?.unreadCount ?? 0
  const openNotification = items.find((n) => n.id === openId) ?? null

  // Inbox zero fires once, on the transition into empty -- the `inbox` tab having *always* been
  // empty (a brand-new account, a hard refresh) is not a moment to celebrate, only clearing it out
  // is. `undefined` (query still pending) never counts as "was non-empty".
  const zeroCelebrate = useCelebrate()
  // `useCelebrate` returns a fresh object literal every render; the panel that receives it is
  // memoised, so it needs one identity per actual change of the flag (motion verdict F5).
  const zeroCelebrateProp = React.useMemo(
    () => ({ play: zeroCelebrate.play, onDone: zeroCelebrate.onDone }),
    [zeroCelebrate.play, zeroCelebrate.onDone],
  )
  const previousInboxCount = React.useRef<number | undefined>(undefined)
  React.useEffect(() => {
    if (status !== 'inbox' || notificationsQuery.data === undefined) return
    const count = items.length
    if (previousInboxCount.current !== undefined && previousInboxCount.current > 0 && count === 0) {
      zeroCelebrate.fire()
    }
    previousInboxCount.current = count
    // `zeroCelebrate.fire` is stable (`useCelebrate`'s own `useCallback`) -- the object itself is
    // not, and including it would re-run this on every render instead of only on a real transition.
  }, [status, notificationsQuery.data, items.length, zeroCelebrate.fire]) // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => {
    setSelectedIndex(0)
    setOpenId(null)
  }, [status])

  // Stable identities, so `InboxRow`'s `React.memo` actually holds and a parent re-render does not
  // re-render sixty rows (motion verdict F5). The mutation *objects* react-query hands back are new
  // on every render; their `.mutate` functions are not, so those are what the callbacks below close
  // over and depend on. Depending on the objects themselves was exactly the thing that would have
  // made every `React.memo` on this screen a no-op.
  const { mutate: markReadMutate } = markRead
  const { mutate: snoozeMutate } = snooze
  const handleOpen = React.useCallback(
    (notification: NotificationDto, index: number) => {
      setOpenId(notification.id)
      setSelectedIndex(index)
      if (notification.readAt === null) markReadMutate([notification.id])
    },
    [markReadMutate],
  )

  const handleQuickAction = React.useCallback(
    (notification: NotificationDto) => {
      if (notification.readAt === null) markReadMutate([notification.id])
      if (notification.deepLink) navigate(notification.deepLink)
    },
    [markReadMutate],
  )

  const handleArchive = React.useCallback(
    (id: string) => {
      setOpenId((current) => (current === id ? null : current))
      const { cancel } = archiveUndoable([id])
      toastWithUndo({
        message: t('inbox.row.archived'),
        undoLabel: t('action.undo'),
        onUndo: cancel,
      })
    },
    [archiveUndoable, t],
  )

  const handleSnooze = React.useCallback(
    (id: string, minutes: number) => {
      snoozeMutate({ id, minutes })
      toast(t('inbox.row.snoozed'))
    },
    [snoozeMutate, t],
  )

  function handleArchiveNow(id: string) {
    archiveNow.mutate([id])
  }

  async function handleCopyCalendar() {
    try {
      const { url } = await fetchIcsUrl()
      await navigator.clipboard.writeText(new URL(url, window.location.origin).toString())
      toast(t('toast.copied'))
    } catch {
      toast(t('toast.saveError'))
    }
  }

  useListKeyboardNav({
    items,
    selectedIndex,
    setSelectedIndex: (i) => {
      setSelectedIndex(i)
      const n = items[i]
      if (n) setOpenId(n.id)
    },
    onOpen: (n) =>
      handleOpen(
        n,
        items.findIndex((x) => x.id === n.id),
      ),
    onArchive: handleArchive,
  })

  if (forced) {
    return <ForcedStateBlock kind={forced} />
  }
  if (!settled) {
    return <StateView kind="loading" titleKey="state.loading" />
  }
  if (meQuery.data === null) return null // redirecting to /login

  if (!online && notificationsQuery.data === undefined) {
    return (
      <StateView
        kind="offline"
        titleKey="state.offline.banner"
        bodyKey="state.offline.empty"
        action={{ labelKey: 'state.error.action', onAction: () => notificationsQuery.refetch() }}
      />
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={t('inbox.eyebrow')}
        title={t('inbox.title')}
        actions={
          <>
            {/* The one primary action in the row (UI-OVERHAUL.md §2): the most consequential single
                thing to do from this screen, whenever there is anything to do it to. */}
            {unreadCount > 0 ? (
              <Button variant="primary" size="sm" onClick={() => markAllRead.mutate()}>
                <CheckCheck className="size-4" aria-hidden="true" />
                {t('inbox.markAllRead')}
              </Button>
            ) : null}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm">
                  <View className="size-4" aria-hidden="true" />
                  {t('inbox.viewMenu.title')}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onSelect={() => setGrouped((v) => !v)}
                  className="justify-between"
                >
                  {t('inbox.groupByReason')}
                  {grouped ? <Check className="size-3.5" aria-hidden="true" /> : null}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="ghost" size="sm" onClick={handleCopyCalendar}>
              <CalendarDays className="size-4" aria-hidden="true" />
              {t('inbox.calendarLink')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => navigate('/inbox/preferences')}>
              <SlidersHorizontal className="size-4" aria-hidden="true" />
              {t('inbox.preferences.title')}
            </Button>
          </>
        }
        tabs={<InboxTabs status={status} onChange={setStatus} unreadCount={unreadCount} />}
      />

      {/* `minmax(0,440px)`: the list was ~420px of a 1,144px content column with the detail pane
          only an 80px bordered box below it (item handoff) -- widening the list a little and letting
          the detail pane take the rest evens that out. */}
      <div className="grid grid-cols-1 items-stretch gap-6 md:grid-cols-[minmax(0,440px)_1fr]">
        <SelectedNotificationContext.Provider value={selectedId}>
          <div className="min-w-0">
            {TABS.map((tab) => (
              <div
                key={tab}
                hidden={tab !== status}
                // Everything a tab switch changes lives here, outside `InboxTabPanel`'s memo. The list
                // no longer re-staggers on a switch (it never unmounts), so the "a different tab is a
                // different list" arrival DESIGN.md §10 asks for is carried by one composited entrance
                // on the panel instead of by sixty rows; adding the class is what restarts the
                // keyframe, and the reduced-motion backstop collapses it to an instant state change.
                className={cn(
                  'min-w-0',
                  tab === status && 'animate-[devon-rise-in_220ms_var(--ease-out)]',
                )}
              >
                <InboxTabPanel
                  tab={tab}
                  items={queryByStatus[tab].data?.items}
                  isPending={queryByStatus[tab].isPending}
                  isError={queryByStatus[tab].isError}
                  onRetry={retryByStatus[tab]}
                  grouped={grouped}
                  onOpen={handleOpen}
                  onArchive={handleArchive}
                  onQuickAction={handleQuickAction}
                  onSnooze={handleSnooze}
                  {...(tab === 'inbox' ? { zeroCelebrate: zeroCelebrateProp } : {})}
                />
              </div>
            ))}
          </div>
        </SelectedNotificationContext.Provider>

        {/* The right pane of the split at >=768; a bottom sheet carries the same content below that
            (UI-OVERHAUL.md "stack at 390") -- `isDesktop` decides which one is actually mounted, so
            the two never both claim the same open notification at once. */}
        {isDesktop ? (
          <div className="sticky top-4 h-full min-h-100 self-stretch overflow-hidden rounded-md border border-border bg-card p-6">
            {/* round2 SEV2 "switching selection swaps the detail pane with no crossfade": keyed on
                the open notification's id (or the empty-selection state) so picking a different row
                fades the old content out and the new one in, instead of the swap reading as a
                flicker. */}
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={openNotification?.id ?? 'empty'}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: detailCrossfadeReduced ? 0.1 : 0.16 }}
                className="h-full"
              >
                {openNotification ? (
                  <NotificationDetail
                    notification={openNotification}
                    onArchive={handleArchiveNow}
                  />
                ) : (
                  // Centred, illustrated "nothing selected" instead of one sentence in an otherwise
                  // empty box (item handoff: "~600px of nothing below it").
                  <div className="flex h-full min-h-88 flex-col items-center justify-center gap-3 text-center">
                    <EmptyInboxIllustration className="w-32" />
                    <p className="max-w-72 text-body text-muted-foreground">
                      {t('inbox.detail.emptySelection')}
                    </p>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        ) : null}
      </div>

      <NotificationSheet
        notification={isDesktop ? null : openNotification}
        onOpenChange={(open) => {
          if (!open) setOpenId(null)
        }}
        onArchive={handleArchiveNow}
      />
    </div>
  )
}
