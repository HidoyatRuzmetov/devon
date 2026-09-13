// The two small pieces of chrome that make the live layer visible (v1.1 SPEC §10, EPIC-018).
//
// Promoted here at the v1.1 integration: `features/calendar` built them, `features/work`'s board
// header and the shared canvas both use them, and a component two features import is a `@devon/ui`
// component by this repo's own convention (MODULE-GUIDE.md). They are presentational on purpose --
// the transport lives in `apps/web/src/lib/realtime`, which this package must not reach into, so
// the status and the member list arrive as props and the app binds them.
//
// Design rule both obey: **an indicator that cannot be trusted is worse than no indicator.** So
// `LiveStatusPill` shows "off" as plainly as it shows "live" -- a deployment with no Centrifugo is
// the common case on a developer box and a legitimate one in production, and a person who is told
// the board is live when it is polling will stop believing the product. And `PresenceAvatars`
// renders nothing at all rather than an empty frame when nobody else is here: absence of people is
// not a thing that needs a widget.
import * as React from 'react'
import { useT } from '@devon/i18n'
import { Radio, WifiOff } from 'lucide-react'
import { Avatar, initialsFromName } from '../primitives/avatar.js'
import { Badge } from '../primitives/badge.js'
import { Tooltip, TooltipContent, TooltipTrigger } from '../primitives/tooltip.js'

/** Mirrors `apps/web/src/lib/realtime`'s `RealtimeStatus`; declared here so the package stays
 *  transport-free. The app passes its own value straight in, and the two are held together by a
 *  mutual-assignability assertion in `apps/web/src/lib/realtime/live-status-pill.tsx` -- the one
 *  file where both types are visible -- so adding a state on either side is a typecheck error, not
 *  a pill that silently renders nothing. Behaviour is covered by `./live-indicators.test.tsx`. */
export type LiveStatus = 'idle' | 'off' | 'connecting' | 'connected' | 'error'

/** The shape `PresenceAvatars` needs off a presence member; the app's own `PresenceMember` is a
 *  superset of it. */
export type PresenceMemberLike = { userId: string; name: string }

const STATUS_COPY: Record<LiveStatus, { label: string; hint: string } | null> = {
  // `idle` is "we have not tried yet" -- a state with nothing honest to say, so it says nothing.
  idle: null,
  connecting: { label: 'realtime.status.connecting', hint: 'realtime.status.connectingHint' },
  connected: { label: 'realtime.status.live', hint: 'realtime.status.liveHint' },
  off: { label: 'realtime.status.off', hint: 'realtime.status.offHint' },
  error: { label: 'realtime.status.error', hint: 'realtime.status.errorHint' },
}

export type LiveStatusPillProps = {
  status: LiveStatus
  /** `| undefined` explicitly: the repo runs `exactOptionalPropertyTypes`, and the app binding
   *  forwards its own optional `className` straight through. */
  className?: string | undefined
}

/** "Live" / "Live mode is off", with the reason on hover and focus. */
export function LiveStatusPill({
  status,
  className,
}: LiveStatusPillProps): React.JSX.Element | null {
  const t = useT()
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
  members: readonly PresenceMemberLike[]
  /** Beyond this many, the rest collapse into a "+N" chip. Four fits the board header at 390 px. */
  max?: number | undefined
  className?: string | undefined
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
