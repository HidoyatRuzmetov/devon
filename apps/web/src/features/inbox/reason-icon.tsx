// One glyph per notification reason (TECH-SPEC §3.6's nine reasons), shared by the inbox list and the
// preferences matrix so the same reason always reads as the same shape (DESIGN.md: "status is never
// conveyed by colour alone").
import type * as React from 'react'
import {
  AtSign,
  BarChart3,
  Bell,
  CalendarCheck,
  ClipboardList,
  Clock,
  Gavel,
  Newspaper,
  RefreshCw,
} from 'lucide-react'
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
}

export function ReasonIcon({ reason, className }: { reason: Reason; className?: string }) {
  const Icon = ICONS[reason]
  return <Icon className={className} aria-hidden="true" />
}
