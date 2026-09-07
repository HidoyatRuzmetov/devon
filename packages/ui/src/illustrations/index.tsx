/** Devon's illustration set (DESIGN.md v2 §2.7, UI-OVERHAUL.md §1.6: "Illustrations are
 * open-licence SVG recoloured to tokens (unDraw, Open Peeps, Humaaans), never stock photos, never
 * clip-art").
 *
 * These are original flat-vector drawings in the unDraw idiom -- two-tone, geometric, no gradients,
 * no drop shadows, one accent per scene -- drawn for this repo and released under the same terms as
 * the rest of it. They deliberately follow unDraw's *conventions* (single accent colour, ~4:3 frame,
 * no faces, no text) so the set stays swappable: dropping a real unDraw SVG in here means replacing
 * the paths and keeping the four `var(--color-illustration-*)` roles, nothing else.
 *
 * Every fill is a token (`--color-illustration-ink | -fill | -accent | -muted`), never a literal
 * colour, so light/dark and any future palette change repaint the whole set for free. Each one is
 * `aria-hidden` -- an illustration in an empty state is decoration next to a heading that already
 * says the thing (WCAG: no redundant alt text).
 *
 * Sizing is the caller's: pass `className="w-40"`. Nothing here is larger than DESIGN.md §4's 160 px
 * ceiling at its intended size.
 */
import * as React from 'react'

export interface IllustrationProps {
  className?: string | undefined
}

const INK = 'var(--color-illustration-ink)'
const FILL = 'var(--color-illustration-fill)'
const ACCENT = 'var(--color-illustration-accent)'
const MUTED = 'var(--color-illustration-muted)'

function Frame({
  className,
  children,
}: {
  className?: string | undefined
  children: React.ReactNode
}) {
  return (
    <svg
      viewBox="0 0 200 140"
      className={className}
      role="presentation"
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
    >
      {children}
      {/* The ground line every scene sits on -- what makes eight separate drawings read as one set. */}
      <rect x="24" y="122" width="152" height="3" rx="1.5" fill={MUTED} />
    </svg>
  )
}

/** Nothing assigned yet -- the Home / My work empty state. */
export function EmptyWorkIllustration({ className }: IllustrationProps): React.JSX.Element {
  return (
    <Frame className={className}>
      <rect x="52" y="34" width="96" height="88" rx="8" fill={FILL} />
      <rect x="64" y="50" width="72" height="8" rx="4" fill={MUTED} />
      <rect x="64" y="68" width="52" height="8" rx="4" fill={MUTED} />
      <rect x="64" y="86" width="62" height="8" rx="4" fill={MUTED} />
      <circle cx="148" cy="44" r="16" fill={ACCENT} />
      <path
        d="M141 44 l5 5 l10 -11"
        fill="none"
        stroke={INK}
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Frame>
  )
}

/** An empty board / no columns yet. */
export function EmptyBoardIllustration({ className }: IllustrationProps): React.JSX.Element {
  return (
    <Frame className={className}>
      <rect x="26" y="36" width="44" height="86" rx="6" fill={FILL} />
      <rect x="78" y="36" width="44" height="86" rx="6" fill={FILL} />
      <rect x="130" y="36" width="44" height="86" rx="6" fill={MUTED} />
      <rect x="34" y="48" width="28" height="18" rx="4" fill={INK} opacity="0.85" />
      <rect x="34" y="72" width="28" height="18" rx="4" fill={MUTED} />
      <rect x="86" y="48" width="28" height="18" rx="4" fill={ACCENT} />
      <rect x="138" y="48" width="28" height="6" rx="3" fill={FILL} />
    </Frame>
  )
}

/** No results for a search or filter. */
export function EmptySearchIllustration({ className }: IllustrationProps): React.JSX.Element {
  return (
    <Frame className={className}>
      <rect x="44" y="30" width="112" height="76" rx="8" fill={FILL} />
      <rect x="58" y="46" width="60" height="7" rx="3.5" fill={MUTED} />
      <rect x="58" y="62" width="84" height="7" rx="3.5" fill={MUTED} />
      <circle cx="112" cy="86" r="24" fill="none" stroke={INK} strokeWidth="6" />
      <path d="M130 104 l16 16" stroke={ACCENT} strokeWidth="8" strokeLinecap="round" />
    </Frame>
  )
}

/** Inbox at zero. */
export function EmptyInboxIllustration({ className }: IllustrationProps): React.JSX.Element {
  return (
    <Frame className={className}>
      <path d="M40 74 L60 40 h80 l20 34 v40 a6 6 0 0 1 -6 6 H46 a6 6 0 0 1 -6 -6 z" fill={FILL} />
      <path
        d="M40 74 h34 l8 14 h36 l8 -14 h34"
        fill="none"
        stroke={INK}
        strokeWidth="4"
        strokeLinejoin="round"
      />
      <circle cx="100" cy="44" r="12" fill={ACCENT} />
      <path
        d="M95 44 l4 4 l8 -9"
        fill="none"
        stroke={INK}
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Frame>
  )
}

/** No upcoming events. */
export function EmptyEventsIllustration({ className }: IllustrationProps): React.JSX.Element {
  return (
    <Frame className={className}>
      <rect x="46" y="34" width="108" height="88" rx="8" fill={FILL} />
      <rect x="46" y="34" width="108" height="22" rx="8" fill={INK} opacity="0.9" />
      <rect x="66" y="26" width="8" height="18" rx="4" fill={MUTED} />
      <rect x="126" y="26" width="8" height="18" rx="4" fill={MUTED} />
      <rect x="60" y="68" width="20" height="16" rx="4" fill={MUTED} />
      <rect x="90" y="68" width="20" height="16" rx="4" fill={ACCENT} />
      <rect x="120" y="68" width="20" height="16" rx="4" fill={MUTED} />
      <rect x="60" y="92" width="20" height="16" rx="4" fill={MUTED} />
      <rect x="90" y="92" width="20" height="16" rx="4" fill={MUTED} />
    </Frame>
  )
}

/** No projects yet. */
export function EmptyProjectsIllustration({ className }: IllustrationProps): React.JSX.Element {
  return (
    <Frame className={className}>
      <rect x="40" y="52" width="120" height="70" rx="8" fill={FILL} />
      <path
        d="M40 60 v-8 a6 6 0 0 1 6 -6 h34 l10 12 h64 a6 6 0 0 1 6 6 v6 z"
        fill={INK}
        opacity="0.9"
      />
      <circle cx="100" cy="88" r="22" fill="none" stroke={MUTED} strokeWidth="7" />
      <path
        d="M100 66 a22 22 0 0 1 19 33"
        fill="none"
        stroke={ACCENT}
        strokeWidth="7"
        strokeLinecap="round"
      />
    </Frame>
  )
}

/** Personal workspace / today view at zero. */
export function EmptyPersonalIllustration({ className }: IllustrationProps): React.JSX.Element {
  return (
    <Frame className={className}>
      <rect x="56" y="26" width="88" height="96" rx="8" fill={FILL} />
      <rect x="48" y="40" width="16" height="8" rx="4" fill={MUTED} />
      <rect x="48" y="62" width="16" height="8" rx="4" fill={MUTED} />
      <rect x="48" y="84" width="16" height="8" rx="4" fill={MUTED} />
      <rect x="74" y="40" width="56" height="8" rx="4" fill={MUTED} />
      <rect x="74" y="62" width="44" height="8" rx="4" fill={MUTED} />
      <rect x="74" y="84" width="52" height="8" rx="4" fill={MUTED} />
      <circle cx="140" cy="100" r="18" fill={ACCENT} />
      <path
        d="M132 100 l6 6 l12 -13"
        fill="none"
        stroke={INK}
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Frame>
  )
}

/** Something went wrong -- the error state. */
export function ErrorIllustration({ className }: IllustrationProps): React.JSX.Element {
  return (
    <Frame className={className}>
      <rect x="44" y="34" width="112" height="76" rx="8" fill={FILL} />
      <rect x="44" y="34" width="112" height="18" rx="8" fill={MUTED} />
      <circle cx="56" cy="43" r="3" fill={FILL} />
      <circle cx="66" cy="43" r="3" fill={FILL} />
      <path d="M100 62 v22" stroke={INK} strokeWidth="7" strokeLinecap="round" />
      <circle cx="100" cy="97" r="4.5" fill={ACCENT} />
    </Frame>
  )
}

/** This page is not yours to open -- the no-permission state. */
export function NoPermissionIllustration({ className }: IllustrationProps): React.JSX.Element {
  return (
    <Frame className={className}>
      <path d="M100 22 l46 18 v30 c0 26 -19 44 -46 52 c-27 -8 -46 -26 -46 -52 V40 z" fill={FILL} />
      <rect x="84" y="66" width="32" height="26" rx="5" fill={INK} opacity="0.9" />
      <path
        d="M90 66 v-8 a10 10 0 0 1 20 0 v8"
        fill="none"
        stroke={INK}
        strokeWidth="4.5"
        strokeLinecap="round"
      />
      <circle cx="100" cy="78" r="4" fill={ACCENT} />
    </Frame>
  )
}

/** No connection -- the offline state. */
export function OfflineIllustration({ className }: IllustrationProps): React.JSX.Element {
  return (
    <Frame className={className}>
      <path
        d="M46 62 a76 76 0 0 1 108 0"
        fill="none"
        stroke={MUTED}
        strokeWidth="9"
        strokeLinecap="round"
      />
      <path
        d="M64 82 a50 50 0 0 1 72 0"
        fill="none"
        stroke={MUTED}
        strokeWidth="9"
        strokeLinecap="round"
      />
      <path
        d="M82 100 a24 24 0 0 1 36 0"
        fill="none"
        stroke={INK}
        strokeWidth="9"
        strokeLinecap="round"
      />
      <circle cx="100" cy="114" r="6" fill={INK} />
      <path d="M52 34 l96 88" stroke={ACCENT} strokeWidth="8" strokeLinecap="round" />
    </Frame>
  )
}

/** Welcome / onboarding -- the departments hub and the first-run checklist. */
export function WelcomeIllustration({ className }: IllustrationProps): React.JSX.Element {
  return (
    <Frame className={className}>
      <rect x="30" y="66" width="44" height="56" rx="6" fill={FILL} />
      <rect x="80" y="42" width="44" height="80" rx="6" fill={INK} opacity="0.9" />
      <rect x="130" y="80" width="40" height="42" rx="6" fill={FILL} />
      <rect x="40" y="78" width="24" height="7" rx="3.5" fill={MUTED} />
      <rect x="40" y="92" width="24" height="7" rx="3.5" fill={MUTED} />
      <rect x="92" y="56" width="20" height="7" rx="3.5" fill={FILL} />
      <rect x="92" y="70" width="20" height="7" rx="3.5" fill={FILL} />
      <circle cx="150" cy="60" r="14" fill={ACCENT} />
      <path d="M150 52 v16 M142 60 h16" stroke={INK} strokeWidth="3.5" strokeLinecap="round" />
    </Frame>
  )
}

/** Everything done -- the "you are clear" celebration state. */
export function AllDoneIllustration({ className }: IllustrationProps): React.JSX.Element {
  return (
    <Frame className={className}>
      <circle cx="100" cy="72" r="42" fill={FILL} />
      <path
        d="M80 72 l14 15 l28 -32"
        fill="none"
        stroke={INK}
        strokeWidth="8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="46" cy="38" r="5" fill={ACCENT} />
      <circle cx="158" cy="52" r="4" fill={ACCENT} />
      <circle cx="146" cy="26" r="3" fill={MUTED} />
      <circle cx="58" cy="100" r="3.5" fill={ACCENT} />
    </Frame>
  )
}

/** The "create a department" card: a building going up, a plus breaking ground. */
export function CreateDepartmentIllustration({ className }: IllustrationProps): React.JSX.Element {
  return (
    <Frame className={className}>
      <rect x="62" y="34" width="76" height="88" rx="6" fill={FILL} />
      <rect x="76" y="48" width="14" height="14" rx="2" fill={MUTED} />
      <rect x="100" y="48" width="14" height="14" rx="2" fill={MUTED} />
      <rect x="76" y="70" width="14" height="14" rx="2" fill={MUTED} />
      <rect x="100" y="70" width="14" height="14" rx="2" fill={MUTED} />
      <rect x="88" y="96" width="24" height="26" rx="2" fill={INK} opacity="0.85" />
      <circle cx="146" cy="40" r="18" fill={ACCENT} />
      <path d="M146 32 v16 M138 40 h16" stroke={INK} strokeWidth="3.5" strokeLinecap="round" />
    </Frame>
  )
}

/** The "join a department" card: a key sliding toward an open door. */
export function JoinDepartmentIllustration({ className }: IllustrationProps): React.JSX.Element {
  return (
    <Frame className={className}>
      <path d="M70 30 h50 a8 8 0 0 1 8 8 v76 h-58 z" fill={FILL} />
      <rect x="70" y="30" width="8" height="84" rx="4" fill={INK} opacity="0.85" />
      <circle cx="102" cy="74" r="4" fill={MUTED} />
      <circle cx="150" cy="70" r="12" fill="none" stroke={ACCENT} strokeWidth="5" />
      <path
        d="M159 78 l16 16 M170 89 l7 -7"
        stroke={ACCENT}
        strokeWidth="5"
        strokeLinecap="round"
      />
    </Frame>
  )
}

/** The pending-request screen: a document with a clock, waiting. */
export function PendingReviewIllustration({ className }: IllustrationProps): React.JSX.Element {
  return (
    <Frame className={className}>
      <rect x="56" y="24" width="70" height="92" rx="6" fill={FILL} />
      <rect x="68" y="40" width="46" height="7" rx="3.5" fill={MUTED} />
      <rect x="68" y="56" width="34" height="7" rx="3.5" fill={MUTED} />
      <rect x="68" y="72" width="40" height="7" rx="3.5" fill={MUTED} />
      <circle cx="140" cy="92" r="26" fill="var(--color-card)" stroke={ACCENT} strokeWidth="4" />
      <path
        d="M140 78 v14 l10 8"
        fill="none"
        stroke={INK}
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Frame>
  )
}

/** Structure's empty state: an org-chart shape with the top box solid and the two below it dashed --
 * "draw the first unit, the rest follows" read at a glance, without a word of text. */
export function EmptyStructureIllustration({ className }: IllustrationProps): React.JSX.Element {
  return (
    <Frame className={className}>
      <path
        d="M100 46 V64 M100 64 H70 M100 64 H130 M70 64 V78 M130 64 V78"
        stroke={MUTED}
        strokeWidth="3"
        fill="none"
      />
      <rect x="70" y="20" width="60" height="26" rx="6" fill={FILL} />
      <circle cx="100" cy="33" r="7" fill={ACCENT} />
      <rect
        x="36"
        y="78"
        width="56"
        height="26"
        rx="6"
        fill="none"
        stroke={INK}
        strokeWidth="2.5"
        strokeDasharray="5 5"
      />
      <rect
        x="108"
        y="78"
        width="56"
        height="26"
        rx="6"
        fill="none"
        stroke={INK}
        strokeWidth="2.5"
        strokeDasharray="5 5"
      />
    </Frame>
  )
}

/** The org chart's own empty state and the "no head yet" vacancy motif share this drawing: a dashed
 * placeholder person in a role slot. */
export function VacantRoleIllustration({ className }: IllustrationProps): React.JSX.Element {
  return (
    <Frame className={className}>
      <rect
        x="52"
        y="30"
        width="96"
        height="78"
        rx="8"
        fill="none"
        stroke={MUTED}
        strokeWidth="2.5"
        strokeDasharray="6 6"
      />
      <circle
        cx="100"
        cy="58"
        r="14"
        fill="none"
        stroke={INK}
        strokeWidth="2.5"
        strokeDasharray="4 4"
      />
      <path
        d="M78 92 a22 18 0 0 1 44 0"
        fill="none"
        stroke={INK}
        strokeWidth="2.5"
        strokeDasharray="4 4"
      />
      <circle cx="146" cy="34" r="10" fill={ACCENT} />
      <path d="M141 34 h10 M146 29 v10" stroke={INK} strokeWidth="2" strokeLinecap="round" />
    </Frame>
  )
}

/** No pinned charts yet -- Home's own empty state (round2 SEV3 #27: this block used to be a bare
 * paragraph plus a text link with no illustration at all). A small bar chart on a card, one bar
 * accented, echoing `/analytics`'s own chart cards without drawing a specific one. */
export function EmptyChartsIllustration({ className }: IllustrationProps): React.JSX.Element {
  return (
    <Frame className={className}>
      <rect x="40" y="26" width="120" height="88" rx="8" fill={FILL} />
      <rect x="56" y="82" width="16" height="20" rx="3" fill={MUTED} />
      <rect x="80" y="66" width="16" height="36" rx="3" fill={MUTED} />
      <rect x="104" y="50" width="16" height="52" rx="3" fill={ACCENT} />
      <rect x="128" y="72" width="16" height="30" rx="3" fill={MUTED} />
      <path d="M52 46 h60" stroke={INK} strokeWidth="3" strokeLinecap="round" opacity="0.3" />
    </Frame>
  )
}

/** Name → component, so a screen can pick one from data (an event category, a state kind) without a
 * switch statement of its own. */
export const ILLUSTRATIONS = {
  emptyWork: EmptyWorkIllustration,
  emptyBoard: EmptyBoardIllustration,
  emptySearch: EmptySearchIllustration,
  emptyInbox: EmptyInboxIllustration,
  emptyEvents: EmptyEventsIllustration,
  emptyProjects: EmptyProjectsIllustration,
  emptyPersonal: EmptyPersonalIllustration,
  error: ErrorIllustration,
  noPermission: NoPermissionIllustration,
  offline: OfflineIllustration,
  welcome: WelcomeIllustration,
  allDone: AllDoneIllustration,
  createDepartment: CreateDepartmentIllustration,
  joinDepartment: JoinDepartmentIllustration,
  pendingReview: PendingReviewIllustration,
  emptyStructure: EmptyStructureIllustration,
  vacantRole: VacantRoleIllustration,
  emptyCharts: EmptyChartsIllustration,
} as const

export type IllustrationName = keyof typeof ILLUSTRATIONS
