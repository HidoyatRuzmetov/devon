// The two small pieces of chrome that make the live layer visible (v1.1 SPEC §10, EPIC-018).
//
// SHARED PRIMITIVES (see this package's notes): both are consumed by `features/work`'s board today.
// They live here because this package owns the realtime layer and its copy; the merge may promote
// them to `packages/ui`.
//
// Design rule both obey: **an indicator that cannot be trusted is worse than no indicator.** So
// `LiveStatusPill` shows "off" as plainly as it shows "live" -- a deployment with no Centrifugo is
// the common case on a developer box and a legitimate one in production, and a person who is told
// the board is live when it is polling will stop believing the product. And `PresenceAvatars`
// renders nothing at all rather than an empty frame when nobody else is here: absence of people is
// not a thing that needs a widget.
import * as React from 'react'
import { useT } from '@devon/i18n'
import { Avatar, Badge, initialsFromName, Tooltip, TooltipContent, TooltipTrigger } from '@devon/ui'
import { Radio, WifiOff } from 'lucide-react'
import {
  useRealtimeStatus,
  type PresenceMember,
  type RealtimeStatus,
} from '../../../lib/realtime/index.js'

const STATUS_COPY: Record<RealtimeStatus, { label: string; hint: string } | null> = {
  // `idle` is "we have not tried yet" -- a state with nothing honest to say, so it says nothing.
  idle: null,
  connecting: { label: 'realtime.status.connecting', hint: 'realtime.status.connectingHint' },
  connected: { label: 'realtime.status.live', hint: 'realtime.status.liveHint' },
  off: { label: 'realtime.status.off', hint: 'realtime.status.offHint' },
  error: { label: 'realtime.status.error', hint: 'realtime.status.errorHint' },
}

/** "Live" / "Live mode is off", with the reason on hover and focus. */
export function LiveStatusPill({ className }: { className?: string }): React.JSX.Element | null {
  const t = useT()
  const status = useRealtimeStatus()
  const copy = STATUS_COPY[status]
  if (!copy) return null

  const live = status === 'connected'
  const Icon = live ? Radio : WifiOff

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* A button, not a span: the hint has to be reachable by keyboard, and a tooltip on a
            non-focusable element is a tooltip a keyboard user never sees. */}
        <button
          type="button"
          className={className}
          aria-label={`${t(copy.label)} — ${t(copy.hint)}`}
        >
          {/* `primary`, not `success`: DESIGN.md §2.1 keeps green for success/approved/on-track, and
              "the socket is connected" is an on/configured state -- the exact leak that rule exists
              to stop. Brand tone says "this is a fact about this thing" without claiming a win. */}
          <Badge tone={live ? 'primary' : 'neutral'}>
            <Icon aria-hidden="true" className="size-3.5" />
            {t(copy.label)}
          </Badge>
        </button>
      </TooltipTrigger>
      <TooltipContent>{t(copy.hint)}</TooltipContent>
    </Tooltip>
  )
}

export type PresenceAvatarsProps = {
  members: PresenceMember[]
  /** Beyond this many, the rest collapse into a "+N" chip. Four fits the board header at 390 px. */
  max?: number
  className?: string
}

/** Who else is looking at this screen right now. */
export function PresenceAvatars({
  members,
  max = 4,
  className,
}: PresenceAvatarsProps): React.JSX.Element | null {
  const t = useT()
  if (members.length === 0) return null

  const shown = members.slice(0, max)
  const hidden = members.length - shown.length
  const names = members.map((m) => m.name).filter(Boolean)
  const summary =
    members.length === 1
      ? t('realtime.presence.one', { name: names[0] ?? '' })
      : t('realtime.presence.many', { name: names[0] ?? '', count: members.length - 1 })

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={summary}
          className={['flex items-center -space-x-2', className].filter(Boolean).join(' ')}
        >
          {shown.map((member) => (
            <span
              key={member.userId}
              className="rounded-full ring-2 ring-surface-1 transition-transform duration-(--dur-micro) ease-out hover:z-10 hover:-translate-y-0.5"
            >
              <Avatar
                size="sm"
                src={null}
                alt={member.name}
                initials={initialsFromName(member.name, '')}
                hueSeed={member.userId}
              />
            </span>
          ))}
          {hidden > 0 ? (
            <span className="z-10 flex size-6 items-center justify-center rounded-full bg-surface-3 text-caption text-muted-foreground ring-2 ring-surface-1">
              +{hidden}
            </span>
          ) : null}
        </button>
      </TooltipTrigger>
      <TooltipContent>{summary}</TooltipContent>
    </Tooltip>
  )
}
