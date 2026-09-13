// `@devon/ui`'s `LiveStatusPill`, bound to this app's realtime client.
//
// The pill itself is a design-system component (`packages/ui/src/realtime/live-indicators.tsx`) and
// is deliberately transport-free: it takes the status as a prop. The socket lives here, so the
// binding lives here too -- which is what lets `features/work`'s board header and
// `features/calendar` both show the same pill without either one importing the other (before the
// v1.1 integration, work imported it out of calendar's components folder).
//
// `PresenceAvatars` needs no binding -- its caller already has the member list from `usePresence`
// -- so it is imported straight from `@devon/ui` at its two call sites.
import * as React from 'react'
import { LiveStatusPill as UiLiveStatusPill, type LiveStatus } from '@devon/ui'
import { useRealtimeStatus } from './hooks.js'
import type { RealtimeStatus } from './client.js'

// The only place both types are in scope, so the only place the promotion can be kept honest:
// `LiveStatus` is `@devon/ui`'s transport-free copy of `RealtimeStatus`, and a state added to
// either one without the other fails this typecheck instead of rendering an invisible pill
// (`STATUS_COPY` has no entry -> the component returns null).
type ExactlyTheSameUnion<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never
export const LIVE_STATUS_MATCHES_REALTIME_STATUS: ExactlyTheSameUnion<RealtimeStatus, LiveStatus> =
  true

/** "Live" / "Live mode is off", bound to this app's realtime client. */
export function LiveStatusPill({ className }: { className?: string }): React.JSX.Element | null {
  const status = useRealtimeStatus()
  return <UiLiveStatusPill status={status} className={className} />
}
