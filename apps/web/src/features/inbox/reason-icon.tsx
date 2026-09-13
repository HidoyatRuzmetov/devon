// One glyph -- and one colour tone -- per notification reason (TECH-SPEC §3.6's nine reasons),
// shared by the inbox list and the preferences matrix so the same reason always reads as the same
// shape and colour (DESIGN.md: "status is never conveyed by colour alone" -- the icon and label are
// always there too; the tone just makes scanning a mixed list faster, the way Linear's inbox chips
// do).
import type * as React from 'react'
import {
  AtSign,
  BarChart3,
  Bell,
  CalendarCheck,
  ClipboardList,
  Clock,
  FileQuestion,
  Gavel,
  Newspaper,
  RefreshCw,
} from 'lucide-react'
import type { ChipProps } from '@devon/ui'
import type { Reason } from './api.js'

const ICONS: Record<Reason, React.ComponentType<React.SVGProps<SVGSVGElement>>> = {
  assigned: ClipboardList,
  mentioned: AtSign,
  due: Clock,
  updated: RefreshCw,
  rsvp: CalendarCheck,
  poll: BarChart3,
  decision: Gavel,
  digest: Newspaper,
  system: Bell,
  field_request: FileQuestion,
}

export function ReasonIcon({ reason, className }: { reason: Reason; className?: string }) {
  const Icon = ICONS[reason]
  return <Icon className={className} aria-hidden="true" />
}

/** DESIGN.md v2's chip tones, one per reason -- assignment and decisions read as "act on me" (primary
 * / attention), a deadline as at-risk (warning), an RSVP/poll confirmation as settled (success), and
 * the rest as informational (info / neutral). */
export const REASON_TONE: Record<Reason, NonNullable<ChipProps['tone']>> = {
  assigned: 'primary',
  mentioned: 'info',
  due: 'attention',
  updated: 'neutral',
  rsvp: 'success',
  poll: 'info',
  decision: 'attention',
  digest: 'neutral',
  // A question waiting on this person, like an assignment -- "act on me", not background noise.
  field_request: 'primary',
  system: 'neutral',
}
