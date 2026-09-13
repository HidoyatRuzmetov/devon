// "Bildirishnomalar" -- the inbox, with the inline actions the Telegram message itself offers, so a
// person who opened the app instead of tapping the button in the chat can do the same things.
//
// Reads and writes the ordinary notifications module (`/api/v1/notifications/*`); nothing about the
// pipeline is re-implemented for the phone (I-14).
import * as React from 'react'
import { Archive, CheckCheck, Clock } from 'lucide-react'
import { formatRelativeTime, useLocale, useT } from '@devon/i18n'
import { Badge, Button, cn, toast } from '@devon/ui'
import {
  archiveNotifications,
  listNotifications,
  markAllNotificationsRead,
  markNotificationsRead,
  snoozeNotification,
  type Notification,
} from '../lib/api.js'
import { useQuery } from '../lib/use-query.js'
import { navigate } from '../lib/router.js'
import { tg } from '../lib/telegram.js'
import {
  ListSkeleton,
  QueryState,
  ScreenBody,
  ScreenHeader,
  ScreenList,
} from '../components/screen.js'
import { rowSurface } from '../components/bits.js'

const SNOOZE_MINUTES = 24 * 60

/** The reason is the first thing a notification says (DESIGN.md §5: "Sizga topshirildi:",
 * "Muddati oʻtdi:"), so it is a labelled chip, never a bare colour. */
const REASON_TONE: Record<string, 'neutral' | 'attention' | 'destructive' | 'info' | 'primary'> = {
  assigned: 'primary',
  mentioned: 'info',
  due: 'destructive',
  updated: 'neutral',
  rsvp: 'attention',
  poll: 'attention',
  decision: 'attention',
  digest: 'neutral',
  system: 'neutral',
}

/** A notification's deep link is a web route (`/work/cards/<id>`); the card is the one subject this
 * app can open natively, so that is the one link it rewrites. Everything else stays a read-only row
 * rather than sending the reader out of Telegram into a browser they may not be signed in to. */
function cardIdOf(notification: Notification): string | null {
  if (notification.subjectType === 'card' && notification.subjectId) return notification.subjectId
  const match = notification.deepLink
    ? /\/cards\/([0-9a-f-]{36})/.exec(notification.deepLink)
    : null
  return match?.[1] ?? null
}

function localized(text: Record<string, string> | null, locale: string): string {
  if (!text) return ''
  return text[locale] ?? text['uz-Latn'] ?? Object.values(text)[0] ?? ''
}

export function InboxScreen(): React.ReactElement {
  const t = useT()
  const locale = useLocale()
  const query = useQuery(() => listNotifications('inbox'), [])
  const [busy, setBusy] = React.useState<string | null>(null)

  const items = query.data?.items ?? []
  const unread = items.filter((item) => item.readAt === null)

  const mutate = React.useCallback(
    (id: string, run: () => Promise<unknown>, successKey: string) => {
      setBusy(id)
      run()
        .then(() => {
          tg.haptic.success()
          toast.success(t(successKey))
          query.refetch()
        })
        .catch(() => toast.error(t('miniapp.inbox.actionFailed')))
        .finally(() => setBusy(null))
    },
    [query, t],
  )

  const onOpen = React.useCallback((notification: Notification) => {
    const cardId = cardIdOf(notification)
    if (notification.readAt === null) {
      // Fire-and-forget: opening is the read signal, and a failed mark-read must never block the
      // navigation the person asked for.
      void markNotificationsRead([notification.id]).catch(() => undefined)
    }
    if (cardId) navigate({ name: 'card', cardId })
    else if (notification.reason === 'rsvp' || notification.reason === 'poll') {
      navigate({ name: 'events' })
    }
  }, [])

  return (
    <>
      <ScreenHeader
        title={t('miniapp.inbox.title')}
        eyebrow={t('miniapp.inbox.eyebrow', { count: unread.length })}
        action={
          unread.length > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                mutate('all', () => markAllNotificationsRead(), 'miniapp.inbox.allRead')
              }
              disabled={busy === 'all'}
            >
              <CheckCheck className="size-4" aria-hidden />
              <span className="sr-only">{t('miniapp.inbox.markAllRead')}</span>
            </Button>
          ) : null
        }
      />
      <ScreenBody>
        {query.status === 'loading' && query.data === null ? (
          <ListSkeleton rows={5} />
        ) : query.status === 'error' && query.data === null ? (
          <QueryState error={query.error} onRetry={query.refetch} />
        ) : items.length === 0 ? (
          <QueryState
            error={null}
            emptyTitleKey="miniapp.inbox.empty.title"
            emptyBodyKey="miniapp.inbox.empty.body"
            onRetry={query.refetch}
          />
        ) : (
          <ScreenList>
            {items.map((item) => {
              const isUnread = item.readAt === null
              return (
                <article
                  key={item.id}
                  className={cn(
                    rowSurface,
                    'flex flex-col gap-2',
                    // The unread rail is always paired with the "Oʻqilmagan" badge below --
                    // colour is never the only signal (DESIGN.md §2.1).
                    isUnread ? 'border-l-2 border-l-attention' : '',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => onOpen(item)}
                    className="text-left focus-visible:outline-none"
                  >
                    <div className="mb-1 flex flex-wrap items-center gap-1.5">
                      <Badge tone={REASON_TONE[item.reason] ?? 'neutral'}>
                        {t(`miniapp.reason.${item.reason}`)}
                      </Badge>
                      {isUnread ? (
                        <Badge tone="attention" variant="outline">
                          {t('miniapp.inbox.unread')}
                        </Badge>
                      ) : null}
                      <span className="text-muted-foreground ml-auto text-[11px] tabular-nums">
                        {formatRelativeTime(new Date(item.createdAt), locale)}
                      </span>
                    </div>
                    <h3 className="text-foreground text-[14px] leading-5 font-medium">
                      {localized(item.title, locale)}
                    </h3>
                    {item.body ? (
                      <p className="text-muted-foreground mt-0.5 line-clamp-2 text-[13px] leading-5">
                        {localized(item.body, locale)}
                      </p>
                    ) : null}
                  </button>
                  <div className="flex gap-2">
                    {isUnread ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={busy === item.id}
                        onClick={() =>
                          mutate(
                            item.id,
                            () => markNotificationsRead([item.id]),
                            'miniapp.inbox.markedRead',
                          )
                        }
                      >
                        {t('miniapp.inbox.markRead')}
                      </Button>
                    ) : null}
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy === item.id}
                      onClick={() =>
                        mutate(
                          item.id,
                          () => snoozeNotification(item.id, SNOOZE_MINUTES),
                          'miniapp.inbox.snoozed',
                        )
                      }
                    >
                      <Clock className="size-4" aria-hidden />
                      {t('miniapp.inbox.snooze')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="ml-auto"
                      disabled={busy === item.id}
                      onClick={() =>
                        mutate(
                          item.id,
                          () => archiveNotifications([item.id]),
                          'miniapp.inbox.archived',
                        )
                      }
                    >
                      <Archive className="size-4" aria-hidden />
                      <span className="sr-only">{t('miniapp.inbox.archive')}</span>
                    </Button>
                  </div>
                </article>
              )
            })}
          </ScreenList>
        )}
      </ScreenBody>
    </>
  )
}
