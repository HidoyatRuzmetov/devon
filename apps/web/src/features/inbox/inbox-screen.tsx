import { notificationDestination } from './notification-destination.js'
// Personal inbox, embedded in Home for members, heads and accounts without a department.
import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useT } from '@devon/i18n'
import {
  AllDoneIllustration,
  Badge,
  Button,
  Celebrate,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyInboxIllustration,
  IconButton,
  Stagger,
  StaggerItem,
  StateView,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  cn,
  toast,
  toastWithUndo,
  useCelebrate,
} from '@devon/ui'
import {
  CalendarDays,
  Check,
  CheckCheck,
  SlidersHorizontal,
  MoreHorizontal,
  ChevronRight,
} from 'lucide-react'
import { useForcedState } from '../../lib/forced-state.js'
import { useMeQuery } from '../../lib/session.js'
import { useOnline } from '../../lib/use-online.js'
import { navigate, replaceSearchParam, useSearchParams } from '../../lib/router.js'
import { ForcedStateBlock } from '../../shell/forced-state-block.js'
import { fetchIcsUrl, type InboxStatus, type NotificationDto } from './api.js'
import {
  useMarkAllReadMutation,
  useMarkReadMutation,
  useNotificationFeed,
  useSnoozeMutation,
  useUndoableArchive,
} from './hooks.js'
import { NotificationRow } from './notification-row.js'
import { NotificationSheet } from './notification-sheet.js'
import { inboxGroup, INBOX_GROUPS, type InboxGroup } from './groups.js'

const TABS: readonly InboxStatus[] = ['inbox', 'unread', 'archived']
type OpenNotification = (notification: NotificationDto, index: number, opener?: HTMLElement) => void

function visibleInboxOpeners(scope: HTMLElement | null | undefined) {
  return Array.from(
    scope?.querySelectorAll<HTMLButtonElement>(
      '[role="tabpanel"][data-state="active"] [data-inbox-opener]',
    ) ?? [],
  ).filter((row) => !row.closest('details:not([open])') && row.getClientRects().length > 0)
}

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
const GroupCountsContext = React.createContext<{
  counts: Record<InboxGroup, number> | undefined
  hasMore: boolean
  pending: boolean
  loadMore: () => void
}>({ counts: undefined, hasMore: false, pending: false, loadMore: () => {} })

function InboxTabs({ unreadCount }: { unreadCount: number }) {
  const t = useT()
  return (
    <TabsList aria-label={t('inbox.title')}>
      {TABS.map((tab) => (
        <TabsTrigger key={tab} value={tab}>
          {t(`inbox.tabs.${tab}`)}
          {tab === 'unread' && unreadCount > 0 ? <Badge tone="info">{unreadCount}</Badge> : null}
        </TabsTrigger>
      ))}
    </TabsList>
  )
}

/** j/k/Enter/e -- Gmail and Linear's own inbox keys. Disabled while focus sits in a text field (the
 * quiet-hours time inputs on the preferences screen, a comment box elsewhere) so a stray "j" never
 * eats a keystroke a person meant to type. */
function useListKeyboardNav({
  items,
  selectedId,
  onSelect,
  onOpen,
  onArchive,
  scope,
}: {
  scope?: React.RefObject<HTMLDivElement | null> | undefined
  items: readonly NotificationDto[]
  selectedId: string | null
  onSelect: (notification: NotificationDto) => void
  onOpen: (notification: NotificationDto) => void
  onArchive: (id: string, fromRow?: boolean) => void
}) {
  React.useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null
      if (scope && (!target || !scope.current?.contains(target))) return
      if (target && /^(input|textarea|select)$/i.test(target.tagName)) return
      if (target?.isContentEditable) return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (target?.closest('[role="dialog"], [role="menu"], [role="combobox"]')) return
      const focusedRow = target?.closest<HTMLElement>('[data-inbox-opener]')
      // Other controls own their keys. A row keeps native Enter activation while j/k/e work
      // on that actual focused row, including after Tab navigation or closing its detail sheet.
      if (target?.closest('button, a, [role="button"], [role="tab"]') && !focusedRow) return
      if (focusedRow && e.key === 'Enter') return
      // Native disclosures can close without a React render. Read visibility when a key is
      // pressed so keyboard navigation and archive recovery never target a collapsed group.
      const visibleIds = new Set(
        visibleInboxOpeners(scope?.current).map((row) => row.dataset['inboxOpener']),
      )
      const navigableItems = scope ? items.filter((item) => visibleIds.has(item.id)) : items
      if (navigableItems.length === 0) return
      const currentId = focusedRow?.dataset['inboxOpener'] ?? selectedId
      const currentIndex = navigableItems.findIndex((item) => item.id === currentId)

      if (e.key === 'j') {
        e.preventDefault()
        const next = navigableItems[Math.min(navigableItems.length - 1, currentIndex + 1)]
        if (next) onSelect(next)
      } else if (e.key === 'k') {
        e.preventDefault()
        const previous = navigableItems[Math.max(0, currentIndex - 1)]
        if (previous) onSelect(previous)
      } else if (e.key === 'Enter') {
        const current = navigableItems[currentIndex]
        if (current) {
          e.preventDefault()
          onOpen(current)
        }
      } else if (e.key === 'e') {
        const current = navigableItems[currentIndex]
        if (current) {
          e.preventDefault()
          onArchive(current.id)
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [items, selectedId, onSelect, onOpen, onArchive, scope])
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
  onOpen: OpenNotification
  onArchive: (id: string, fromRow?: boolean) => void
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
          onOpen={(opener) => onOpen(notification, index, opener)}
          onQuickAction={() => onQuickAction(notification)}
          onArchive={() => onArchive(notification.id, true)}
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
  onOpen: OpenNotification
  onArchive: (id: string, fromRow?: boolean) => void
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
  onOpen: OpenNotification
  onArchive: (id: string, fromRow?: boolean) => void
  onQuickAction: (notification: NotificationDto) => void
  onSnooze: (id: string, minutes: number) => void
}) {
  const t = useT()
  const feed = React.useContext(GroupCountsContext)
  const indexOf = new Map(items.map((n, i) => [n.id, i]))
  return (
    <div className="flex flex-col gap-4">
      {INBOX_GROUPS.map((reason) => {
        const group = items.filter((n) => inboxGroup(n) === reason)
        const total = feed.counts?.[reason] ?? group.length
        if (total === 0) return null
        return (
          <details key={reason} open className="group">
            <summary className="mb-2 flex min-h-8 cursor-pointer list-none items-center gap-2 rounded-sm px-1 hover:bg-accent [&::-webkit-details-marker]:hidden">
              <ChevronRight
                className="size-3.5 text-muted-foreground transition-transform group-open:rotate-90 motion-reduce:transition-none"
                aria-hidden="true"
              />
              <span className="text-caption font-semibold text-muted-foreground">
                {t(`homeRefinement.inboxGroups.${reason}`)}
              </span>
              <span className="text-caption text-muted-foreground">{total}</span>
            </summary>
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
            {!group.length && feed.hasMore ? (
              <Button
                variant="ghost"
                size="sm"
                className="w-full"
                loading={feed.pending}
                onClick={feed.loadMore}
              >
                {t('homeRefinement.loadMore')}
              </Button>
            ) : null}
          </details>
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
  onOpen: OpenNotification
  onArchive: (id: string, fromRow?: boolean) => void
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
  onOpen: OpenNotification
  onArchive: (id: string, fromRow?: boolean) => void
  onQuickAction: (notification: NotificationDto) => void
  onSnooze: (id: string, minutes: number) => void
  /** UI-OVERHAUL.md §3 "RSVP yes, card done, sprint complete": inbox zero gets the same one-shot
   * burst, fired only on the *transition* into empty (never on every visit to an already-empty
   * inbox) -- `inbox-screen.tsx` owns that transition detection. */
  zeroCelebrate?: { play: boolean; onDone: () => void }
}) {
  if (isError && items === undefined) {
    return (
      <StateView
        kind="error"
        titleKey="state.error.title"
        bodyKey="state.error.body"
        action={{ labelKey: 'state.error.action', onAction: onRetry }}
      />
    )
  }
  if (isPending || items === undefined) {
    return <StateView kind="loading" titleKey="state.loading" />
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

export function InboxPanel() {
  const t = useT()
  const forced = useForcedState()
  const online = useOnline()
  const meQuery = useMeQuery()
  const search = useSearchParams()
  const requested = search.get('inbox')
  const [status, setStatus] = React.useState<InboxStatus>(
    requested === 'unread' || requested === 'archived' ? requested : 'inbox',
  )
  React.useEffect(() => {
    if (requested)
      setStatus(requested === 'unread' || requested === 'archived' ? requested : 'inbox')
  }, [requested])
  const [openId, setOpenId] = React.useState<string | null>(null)
  const [selectedIndex, setSelectedIndex] = React.useState(-1)
  const inboxRef = React.useRef<HTMLDivElement>(null)
  const openerRef = React.useRef<HTMLElement | null>(null)
  const openerNotificationId = React.useRef<string | null>(null)
  // UI-OVERHAUL.md §8: grouped by reason is the default view, not an opt-in someone has to find --
  // the toggle moved into a "View" menu (below) rather than staying its own header button.
  const [grouped, setGrouped] = React.useState(true)
  const settled = !meQuery.isPending

  React.useEffect(() => {
    if (forced) return
    if (settled && meQuery.data === null) navigate('/login')
  }, [forced, settled, meQuery.data])

  // Keep mounted tabs stable; only the selected tab fetches. Realtime invalidation refreshes it.
  const inboxQuery = useNotificationFeed('inbox', status === 'inbox')
  const unreadQuery = useNotificationFeed('unread', status === 'unread')
  const archivedQuery = useNotificationFeed('archived', status === 'archived')
  const queryByStatus: Record<InboxStatus, ReturnType<typeof useNotificationFeed>> = {
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
  const archiveUndoable = useUndoableArchive()

  const items = React.useMemo(
    () => notificationsQuery.data?.items ?? [],
    [notificationsQuery.data?.items],
  )
  const navigationItems = grouped
    ? INBOX_GROUPS.flatMap((group) => items.filter((item) => inboxGroup(item) === group))
    : items
  // A conditional sheet unmount keeps its last close callback. Read current rows through a ref,
  // so that callback does not restore focus to a row still animating out after a successful archive.
  const currentItems = React.useRef(items)
  React.useLayoutEffect(() => {
    currentItems.current = items
  }, [items])
  // The j/k cursor as an id, for `SelectedNotificationContext` (see its own note): the panels stay
  // memoised and only the rows re-render when the selection moves.
  const selectedId = items[selectedIndex]?.id ?? null
  const unreadCount = notificationsQuery.data?.unreadCount ?? 0
  const [openSnapshot, setOpenSnapshot] = React.useState<NotificationDto | null>(null)
  const openNotification =
    items.find((n) => n.id === openId) ?? (openSnapshot?.id === openId ? openSnapshot : null)

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
    setSelectedIndex(-1)
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
    (notification: NotificationDto, index: number, opener?: HTMLElement) => {
      openerNotificationId.current = notification.id
      openerRef.current =
        opener ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null)
      setOpenSnapshot(notification)
      setOpenId(notification.id)
      setSelectedIndex(index)
      if (notification.readAt === null) markReadMutate([notification.id])
    },
    [markReadMutate],
  )

  const handleQuickAction = React.useCallback(
    (notification: NotificationDto) => {
      if (notification.readAt === null) markReadMutate([notification.id])
      const destination = notificationDestination(notification)
      if (destination) navigate(destination)
    },
    [markReadMutate],
  )

  const handleArchive = React.useCallback(
    async (id: string, fromRow = false) => {
      const focusedRow = document.activeElement?.closest<HTMLElement>('[data-inbox-row]')
      const restoreRowFocus = fromRow || focusedRow?.dataset['inboxRow'] === id
      const visibleRows = visibleInboxOpeners(inboxRef.current)
      const rowIndex = visibleRows.findIndex((row) => row.dataset['inboxOpener'] === id)
      const nextRow = visibleRows[rowIndex + 1] ?? visibleRows[rowIndex - 1]
      try {
        const { cancel } = await archiveUndoable(id)
        setOpenId((current) => (current === id ? null : current))
        if (restoreRowFocus) {
          if (nextRow?.isConnected && !nextRow.closest('details:not([open])')) nextRow.focus()
          else
            inboxRef.current
              ?.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')
              ?.focus()
        }
        if (cancel)
          toastWithUndo({
            message: t('inbox.row.archived'),
            undoLabel: t('action.undo'),
            onUndo: () => {
              void cancel().catch(() => toast(t('toast.saveError')))
            },
          })
        else toast(t('inbox.row.archived'))
      } catch {
        toast(t('toast.saveError'))
      }
    },
    [archiveUndoable, t],
  )

  const handleSnooze = React.useCallback(
    (id: string, minutes: number) => {
      snoozeMutate(
        { id, minutes },
        {
          onSuccess: () => toast(t('inbox.row.snoozed')),
          onError: () => toast(t('toast.saveError')),
        },
      )
    },
    [snoozeMutate, t],
  )

  function handleArchiveNow(id: string) {
    void handleArchive(id)
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
    scope: inboxRef,
    items: navigationItems,
    selectedId,
    onSelect: (notification) => {
      setSelectedIndex(items.findIndex((item) => item.id === notification.id))
      inboxRef.current
        ?.querySelector<HTMLButtonElement>(
          `[role="tabpanel"][data-state="active"] [data-inbox-opener="${CSS.escape(notification.id)}"]`,
        )
        ?.focus()
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
    <Tabs
      id="home-inbox"
      data-testid="home-inbox"
      ref={inboxRef}
      value={status}
      onValueChange={(value) => {
        if (TABS.includes(value as InboxStatus)) {
          setStatus(value as InboxStatus)
          replaceSearchParam('inbox', value === 'inbox' ? 'all' : value)
        }
      }}
      className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-card"
    >
      <div className="shrink-0 border-b border-border px-3 pt-3 pb-2">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2
            aria-label={t('inbox.title')}
            className="flex items-center gap-2 font-display text-h3"
          >
            {t('inbox.title')}
            {unreadCount > 0 ? <Badge tone="info">{unreadCount}</Badge> : null}
          </h2>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              disabled={
                unreadCount <= 0 || notificationsQuery.isPending || notificationsQuery.isError
              }
              loading={markAllRead.isPending}
              onClick={() => markAllRead.mutate()}
            >
              <CheckCheck className="size-4" aria-hidden="true" />
              <span className="text-caption">{t('inbox.markAllRead')}</span>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton aria-label={t('homeRefinement.inboxActions')}>
                  <MoreHorizontal className="size-4" aria-hidden="true" />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setGrouped((v) => !v)}>
                  {t('homeRefinement.groupUpdates')}
                  {grouped ? <Check className="ml-auto size-4" aria-hidden="true" /> : null}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={handleCopyCalendar}>
                  <CalendarDays className="size-4" aria-hidden="true" />
                  {t('inbox.calendarLink')}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => navigate('/account/notifications?from=overview')}>
                  <SlidersHorizontal className="size-4" aria-hidden="true" />
                  {t('inbox.preferences.title')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        <InboxTabs unreadCount={0} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
        <SelectedNotificationContext.Provider value={selectedId}>
          <div className="min-w-0">
            {TABS.map((tab) => (
              <TabsContent
                key={tab}
                value={tab}
                forceMount
                // Everything a tab switch changes lives here, outside `InboxTabPanel`'s memo. The list
                // no longer re-staggers on a switch (it never unmounts), so the "a different tab is a
                // different list" arrival DESIGN.md §10 asks for is carried by one composited entrance
                // on the panel instead of by sixty rows; adding the class is what restarts the
                // keyframe, and the reduced-motion backstop collapses it to an instant state change.
                className={cn(
                  'min-w-0',
                  tab !== status && 'hidden',
                  tab === status && 'animate-[devon-rise-in_220ms_var(--ease-out)]',
                )}
              >
                <GroupCountsContext.Provider
                  value={{
                    counts: queryByStatus[tab].data?.groupCounts,
                    hasMore: Boolean(queryByStatus[tab].hasNextPage),
                    pending: queryByStatus[tab].isFetchingNextPage,
                    loadMore: () => {
                      void queryByStatus[tab].fetchNextPage()
                    },
                  }}
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
                </GroupCountsContext.Provider>
                {queryByStatus[tab].hasNextPage ? (
                  <Button
                    className="mt-3 w-full"
                    variant="ghost"
                    size="sm"
                    loading={queryByStatus[tab].isFetchingNextPage}
                    onClick={() => void queryByStatus[tab].fetchNextPage()}
                  >
                    {t('homeRefinement.loadMore')}
                  </Button>
                ) : null}
              </TabsContent>
            ))}
          </div>
        </SelectedNotificationContext.Provider>
      </div>

      <NotificationSheet
        notification={openNotification}
        onOpenChange={(open) => {
          if (!open) setOpenId(null)
        }}
        onArchive={handleArchiveNow}
        onRestoreFocus={() => {
          if (
            openerRef.current?.isConnected &&
            currentItems.current.some((item) => item.id === openerNotificationId.current)
          )
            openerRef.current.focus()
          else
            inboxRef.current
              ?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
              ?.focus()
          openerRef.current = null
          openerNotificationId.current = null
        }}
      />
    </Tabs>
  )
}
