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
import { useT } from '@devon/i18n'
import {
  AllDoneIllustration,
  Badge,
  Button,
  Chip,
  EmptyInboxIllustration,
  PageHeader,
  Stagger,
  StaggerItem,
  StateView,
  cn,
  toast,
  toastWithUndo,
} from '@devon/ui'
import { CalendarDays, CheckCheck, LayoutList, SlidersHorizontal, Ungroup } from 'lucide-react'
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

function InboxList({
  items,
  selectedIndex,
  onOpen,
  onArchive,
  onQuickAction,
  onSnooze,
}: {
  items: readonly NotificationDto[]
  selectedIndex: number
  onOpen: (notification: NotificationDto, index: number) => void
  onArchive: (id: string) => void
  onQuickAction: (notification: NotificationDto) => void
  onSnooze: (id: string, minutes: number) => void
}) {
  return (
    <Stagger as="ul" className="rounded-md border border-border bg-card">
      {items.map((notification, index) => (
        <StaggerItem key={notification.id} as="li">
          <NotificationRow
            notification={notification}
            selected={index === selectedIndex}
            onOpen={() => onOpen(notification, index)}
            onQuickAction={() => onQuickAction(notification)}
            onArchive={() => onArchive(notification.id)}
            onSnooze={(minutes) => onSnooze(notification.id, minutes)}
          />
        </StaggerItem>
      ))}
    </Stagger>
  )
}

function GroupedInboxList({
  items,
  selectedIndex,
  onOpen,
  onArchive,
  onQuickAction,
  onSnooze,
}: {
  items: readonly NotificationDto[]
  selectedIndex: number
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
              <Chip tone={REASON_TONE[reason]}>
                <ReasonIcon reason={reason} className="size-3" />
                {t(`inbox.reason.${reason}`)}
              </Chip>
              <span className="text-caption text-muted-foreground">{group.length}</span>
            </div>
            <Stagger as="ul" className="rounded-md border border-border bg-card">
              {group.map((notification) => (
                <StaggerItem key={notification.id} as="li">
                  <NotificationRow
                    notification={notification}
                    selected={indexOf.get(notification.id) === selectedIndex}
                    onOpen={() => onOpen(notification, indexOf.get(notification.id) ?? 0)}
                    onQuickAction={() => onQuickAction(notification)}
                    onArchive={() => onArchive(notification.id)}
                    onSnooze={(minutes) => onSnooze(notification.id, minutes)}
                  />
                </StaggerItem>
              ))}
            </Stagger>
          </section>
        )
      })}
    </div>
  )
}

function InboxBody({
  query,
  status,
  grouped,
  selectedIndex,
  onOpen,
  onArchive,
  onQuickAction,
  onSnooze,
}: {
  query: ReturnType<typeof useNotificationsQuery>
  status: InboxStatus
  grouped: boolean
  selectedIndex: number
  onOpen: (notification: NotificationDto, index: number) => void
  onArchive: (id: string) => void
  onQuickAction: (notification: NotificationDto) => void
  onSnooze: (id: string, minutes: number) => void
}) {
  if (query.isPending) {
    return <StateView kind="loading" titleKey="state.loading" />
  }
  if (query.isError) {
    return (
      <StateView
        kind="error"
        titleKey="state.error.title"
        bodyKey="state.error.body"
        action={{ labelKey: 'state.error.action', onAction: () => query.refetch() }}
      />
    )
  }
  const items = query.data.items
  if (items.length === 0) {
    return (
      <StateView
        kind="empty"
        titleKey={`inbox.empty.${status}.title`}
        bodyKey={`inbox.empty.${status}.body`}
        illustration={status === 'inbox' ? <AllDoneIllustration /> : <EmptyInboxIllustration />}
      />
    )
  }
  const props = { items, selectedIndex, onOpen, onArchive, onQuickAction, onSnooze }
  return grouped ? <GroupedInboxList {...props} /> : <InboxList {...props} />
}

export default function InboxScreen() {
  const t = useT()
  const forced = useForcedState()
  const online = useOnline()
  const meQuery = useMeQuery()
  const [status, setStatus] = React.useState<InboxStatus>('inbox')
  const [openId, setOpenId] = React.useState<string | null>(null)
  const [selectedIndex, setSelectedIndex] = React.useState(0)
  const [grouped, setGrouped] = React.useState(false)
  // The split becomes a stack below this width (UI-OVERHAUL.md "stack at 390") -- Tailwind's own
  // `md` breakpoint, so this hook's threshold and the `md:` classes below never drift apart.
  const isDesktop = useMediaQuery('(min-width: 768px)')

  const settled = !meQuery.isPending

  React.useEffect(() => {
    if (forced) return
    if (settled && meQuery.data === null) navigate('/login')
  }, [forced, settled, meQuery.data])

  const notificationsQuery = useNotificationsQuery(status)
  const markRead = useMarkReadMutation()
  const markAllRead = useMarkAllReadMutation()
  const snooze = useSnoozeMutation()
  const archiveNow = useArchiveMutation()
  const archiveUndoable = useUndoableArchive()

  const items = notificationsQuery.data?.items ?? []
  const unreadCount = notificationsQuery.data?.unreadCount ?? 0
  const openNotification = items.find((n) => n.id === openId) ?? null

  React.useEffect(() => {
    setSelectedIndex(0)
    setOpenId(null)
  }, [status])

  function handleOpen(notification: NotificationDto, index: number) {
    setOpenId(notification.id)
    setSelectedIndex(index)
    if (notification.readAt === null) markRead.mutate([notification.id])
  }

  function handleQuickAction(notification: NotificationDto) {
    if (notification.readAt === null) markRead.mutate([notification.id])
    if (notification.deepLink) navigate(notification.deepLink)
  }

  function handleArchive(id: string) {
    if (openId === id) setOpenId(null)
    const { cancel } = archiveUndoable([id])
    toastWithUndo({
      message: t('inbox.row.archived'),
      undoLabel: t('action.undo'),
      onUndo: cancel,
    })
  }

  function handleArchiveNow(id: string) {
    archiveNow.mutate([id])
  }

  function handleSnooze(id: string, minutes: number) {
    snooze.mutate({ id, minutes })
    toast(t('inbox.row.snoozed'))
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
            {unreadCount > 0 ? (
              <Button variant="secondary" size="sm" onClick={() => markAllRead.mutate()}>
                <CheckCheck className="size-4" aria-hidden="true" />
                {t('inbox.markAllRead')}
              </Button>
            ) : null}
            <Button
              variant={grouped ? 'secondary' : 'ghost'}
              size="sm"
              aria-pressed={grouped}
              onClick={() => setGrouped((v) => !v)}
            >
              {grouped ? (
                <Ungroup className="size-4" aria-hidden="true" />
              ) : (
                <LayoutList className="size-4" aria-hidden="true" />
              )}
              {t('inbox.groupByReason')}
            </Button>
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

      <div className="grid grid-cols-1 items-start gap-6 md:grid-cols-[minmax(0,420px)_1fr]">
        <InboxBody
          query={notificationsQuery}
          status={status}
          grouped={grouped}
          selectedIndex={selectedIndex}
          onOpen={handleOpen}
          onArchive={handleArchive}
          onQuickAction={handleQuickAction}
          onSnooze={handleSnooze}
        />

        {/* The right pane of the split at >=768; a bottom sheet carries the same content below that
            (UI-OVERHAUL.md "stack at 390") -- `isDesktop` decides which one is actually mounted, so
            the two never both claim the same open notification at once. */}
        {isDesktop ? (
          <div className="sticky top-4 rounded-md border border-border bg-card p-6">
            {openNotification ? (
              <NotificationDetail notification={openNotification} onArchive={handleArchiveNow} />
            ) : (
              <p className="text-body text-muted-foreground">{t('inbox.detail.emptySelection')}</p>
            )}
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
