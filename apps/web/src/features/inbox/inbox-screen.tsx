// `/inbox` (this module's task: "inbox drawer + page with mark read/archive"). A department table's
// usual `department_child` permission does not apply here -- every route reads/writes only the signed
// -in user's own notifications (`{ kind: 'personal', ownerUserId }`, `apps/api/src/modules/
// notifications/index.ts`), so the only gate this screen needs is "is anyone signed in at all",
// exactly like `HomeRoute`.
import * as React from 'react'
import { useT } from '@devon/i18n'
import { Badge, Button, StateView, cn, toast, toastWithUndo } from '@devon/ui'
import { CalendarDays, CheckCheck, SlidersHorizontal } from 'lucide-react'
import { useForcedState } from '../../lib/forced-state.js'
import { useMeQuery } from '../../lib/session.js'
import { useOnline } from '../../lib/use-online.js'
import { navigate } from '../../lib/router.js'
import { ForcedStateBlock } from '../../shell/forced-state-block.js'
import { fetchIcsUrl, type InboxStatus, type NotificationDto } from './api.js'
import {
  useArchiveMutation,
  useMarkAllReadMutation,
  useMarkReadMutation,
  useNotificationsQuery,
  useSnoozeMutation,
  useUndoableArchive,
} from './hooks.js'
import { NotificationRow } from './notification-row.js'
import { NotificationSheet } from './notification-sheet.js'

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

function InboxBody({
  query,
  status,
  onOpen,
  onArchive,
  onSnooze,
}: {
  query: ReturnType<typeof useNotificationsQuery>
  status: InboxStatus
  onOpen: (notification: NotificationDto) => void
  onArchive: (id: string) => void
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
      />
    )
  }
  return (
    <ul className="rounded-md border border-border bg-card">
      {items.map((notification) => (
        <NotificationRow
          key={notification.id}
          notification={notification}
          onOpen={() => onOpen(notification)}
          onArchive={() => onArchive(notification.id)}
          onSnooze={(minutes) => onSnooze(notification.id, minutes)}
        />
      ))}
    </ul>
  )
}

export default function InboxScreen() {
  const t = useT()
  const forced = useForcedState()
  const online = useOnline()
  const meQuery = useMeQuery()
  const [status, setStatus] = React.useState<InboxStatus>('inbox')
  const [openId, setOpenId] = React.useState<string | null>(null)

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

  function handleOpen(notification: NotificationDto) {
    setOpenId(notification.id)
    if (notification.readAt === null) markRead.mutate([notification.id])
  }

  function handleArchive(id: string) {
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
    <div className="mx-auto flex max-w-200 flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-eyebrow uppercase tracking-(--text-eyebrow--letter-spacing) text-muted-foreground">
            {t('inbox.eyebrow')}
          </p>
          <h1 className="font-display text-h1 text-foreground">{t('inbox.title')}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {unreadCount > 0 ? (
            <Button variant="secondary" size="sm" onClick={() => markAllRead.mutate()}>
              <CheckCheck className="size-4" aria-hidden="true" />
              {t('inbox.markAllRead')}
            </Button>
          ) : null}
          <Button variant="ghost" size="sm" onClick={handleCopyCalendar}>
            <CalendarDays className="size-4" aria-hidden="true" />
            {t('inbox.calendarLink')}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => navigate('/inbox/preferences')}>
            <SlidersHorizontal className="size-4" aria-hidden="true" />
            {t('inbox.preferences.title')}
          </Button>
        </div>
      </div>

      <InboxTabs status={status} onChange={setStatus} unreadCount={unreadCount} />

      <InboxBody
        query={notificationsQuery}
        status={status}
        onOpen={handleOpen}
        onArchive={handleArchive}
        onSnooze={handleSnooze}
      />

      <NotificationSheet
        notification={openNotification}
        onOpenChange={(open) => {
          if (!open) setOpenId(null)
        }}
        onArchive={handleArchiveNow}
      />
    </div>
  )
}
