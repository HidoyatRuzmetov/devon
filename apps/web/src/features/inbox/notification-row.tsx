// One row in the inbox list (design.md components: a list row is a button, never a nested-clickable
// mess -- the whole row opens the detail sheet; per-row actions are separate controls after it, not
// inside the same hit target).
import { useT, useLocale, formatDate, formatTime } from '@devon/i18n'
import { Archive, Clock3 } from 'lucide-react'
import {
  Chip,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
  cn,
} from '@devon/ui'
import { pickLocalized, type NotificationDto } from './api.js'
import { REASON_TONE, ReasonIcon } from './reason-icon.js'

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

/** The reason decides which inline action reads right next to the row (UI-OVERHAUL.md "inline
 * actions (approve, RSVP, open)") -- a decision waiting on someone gets "Approve", an event RSVP
 * gets "RSVP", everything else with a target gets the generic "Open". All three are the same jump to
 * `deepLink`; the label is what tells the reader what pressing it *means* without opening the row
 * first (Gmail/Linear inbox convention). */
function quickActionLabelKey(reason: NotificationDto['reason']): string {
  if (reason === 'decision') return 'inbox.row.approve'
  if (reason === 'rsvp') return 'inbox.row.rsvp'
  return 'inbox.row.open'
}

export function NotificationRow({
  notification,
  selected = false,
  showReasonChip = true,
  onOpen,
  onQuickAction,
  onArchive,
  onSnooze,
}: {
  notification: NotificationDto
  /** Highlighted by keyboard (j/k) navigation, Linear-style -- not the same as "unread". */
  selected?: boolean
  /** The grouped list's section head already states the reason (UI-OVERHAUL.md §8) -- repeating it
   * on every row in the group is noise, so `GroupedInboxList` passes `false` here. */
  showReasonChip?: boolean
  onOpen: () => void
  /** Jumps straight to `deepLink` without opening the detail panel first. */
  onQuickAction: () => void
  onArchive: () => void
  onSnooze: (minutes: number) => void
}) {
  const t = useT()
  const locale = useLocale()
  const unread = notification.readAt === null
  const created = new Date(notification.createdAt)

  return (
    // Both call sites (InboxList, GroupedInboxList in inbox-screen.tsx) already wrap this row in a
    // StaggerItem rendered as a list item -- a second list item here nested a list item inside a list
    // item, invalid HTML that threw a React hydration warning (found clicking through Inbox, 2026-09).
    // The list-item semantics belong to that one wrapper; this row is a plain div.
    <div
      className={cn(
        'group relative flex items-start gap-3 border-b border-border px-4 py-3 last:border-b-0',
        unread && 'bg-accent/40',
        selected && 'ring-1 ring-inset ring-primary',
      )}
    >
      {/* Unread signal on the row rail (UI-OVERHAUL.md §8) -- the inline dot beside the title is easy
          to miss once the title itself wraps to two lines, so the rail carries the same signal at a
          glance down the whole list. */}
      {unread ? (
        <span
          aria-hidden="true"
          className="absolute inset-y-0 left-0 w-0.5 bg-primary"
        />
      ) : null}
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          // `min-w-0`: a flex item's default `min-width: auto` refuses to shrink below its content's
          // natural width, so without it this button (and the `truncate` title inside it) never
          // actually shrinks -- it pushes the `shrink-0` action cluster past the row's own box instead
          // of truncating, leaving the clock/archive buttons floating in the gutter next to the row.
          'flex min-w-0 flex-1 items-start gap-3 rounded-sm text-left',
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
          <span className="flex items-start gap-2">
            {unread ? (
              <span
                className="mt-1.5 size-2 shrink-0 rounded-full bg-primary"
                aria-label={t('inbox.row.unread')}
              />
            ) : null}
            <span
              className={cn(
                'line-clamp-2 text-body',
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
          <span className="mt-1 flex items-center gap-2 text-caption text-muted-foreground">
            {showReasonChip ? (
              <Chip tone={REASON_TONE[notification.reason]}>
                {t(`inbox.reason.${notification.reason}`)}
              </Chip>
            ) : null}
            <span>
              {formatDate(created, locale)} {formatTime(created, locale)}
            </span>
          </span>
        </span>
      </button>
      <span className="flex shrink-0 items-center gap-1">
        {notification.deepLink ? (
          <button
            type="button"
            onClick={onQuickAction}
            className="hidden whitespace-nowrap rounded-sm px-2 py-1 text-caption font-medium text-primary hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:inline-flex"
          >
            {t(quickActionLabelKey(notification.reason))}
          </button>
        ) : null}
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
    </div>
  )
}
