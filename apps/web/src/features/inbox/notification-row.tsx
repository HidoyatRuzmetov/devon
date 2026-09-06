// One row in the inbox list (design.md components: a list row is a button, never a nested-clickable
// mess -- the whole row opens the detail sheet; per-row actions are separate controls after it, not
// inside the same hit target).
import { useT, useLocale, formatDate, formatTime } from '@devon/i18n'
import { Archive, Clock3 } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
  cn,
} from '@devon/ui'
import { pickLocalized, type NotificationDto } from './api.js'
import { ReasonIcon } from './reason-icon.js'

/** Minutes for each preset snooze option (TECH-SPEC §7 "inline buttons for ... snooze"): 1 hour,
 * tomorrow morning (09:00 local, approximated as +18h from a mid-day interaction), next week
 * (+7 days). Kept as a small, fixed menu rather than a free-form picker -- the same three choices the
 * Telegram inline button and `/mute`-adjacent snooze already offer, so the web and bot experiences
 * agree. */
export const SNOOZE_PRESETS = [
  { key: 'hour', minutes: 60 },
  { key: 'tomorrow', minutes: 18 * 60 },
  { key: 'nextWeek', minutes: 7 * 24 * 60 },
] as const

export function NotificationRow({
  notification,
  onOpen,
  onArchive,
  onSnooze,
}: {
  notification: NotificationDto
  onOpen: () => void
  onArchive: () => void
  onSnooze: (minutes: number) => void
}) {
  const t = useT()
  const locale = useLocale()
  const unread = notification.readAt === null
  const created = new Date(notification.createdAt)

  return (
    <li
      className={cn(
        'group flex items-start gap-3 border-b border-border px-4 py-3 last:border-b-0',
        unread && 'bg-accent/40',
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          'flex flex-1 items-start gap-3 rounded-sm text-left',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        )}
      >
        <span
          className={cn(
            'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full',
            unread ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
          )}
        >
          <ReasonIcon reason={notification.reason} className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            {unread ? (
              <span
                className="size-2 shrink-0 rounded-full bg-primary"
                aria-label={t('inbox.row.unread')}
              />
            ) : null}
            <span
              className={cn(
                'truncate text-body',
                unread ? 'font-medium text-foreground' : 'text-foreground',
              )}
            >
              {pickLocalized(notification.title, locale)}
            </span>
          </span>
          {notification.body ? (
            <span className="mt-0.5 block truncate text-small text-muted-foreground">
              {pickLocalized(notification.body, locale)}
            </span>
          ) : null}
          <span className="mt-1 block text-caption text-muted-foreground">
            {formatDate(created, locale)} {formatTime(created, locale)}
          </span>
        </span>
      </button>
      <span className="flex shrink-0 items-center gap-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton aria-label={t('inbox.row.snooze')}>
              <Clock3 className="size-4" aria-hidden="true" />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {SNOOZE_PRESETS.map((preset) => (
              <DropdownMenuItem key={preset.key} onSelect={() => onSnooze(preset.minutes)}>
                {t(`inbox.row.snoozeOptions.${preset.key}`)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <IconButton aria-label={t('inbox.row.archive')} onClick={onArchive}>
          <Archive className="size-4" aria-hidden="true" />
        </IconButton>
      </span>
    </li>
  )
}
