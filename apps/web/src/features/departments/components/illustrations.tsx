// Illustrations for the departments hub, create-or-join choice and pending-request screen -- none of
// which `packages/ui/src/illustrations` carries yet. Same idiom as the shared set (DESIGN.md v2 §2.7):
// two-tone flat vector, `var(--color-illustration-*)` roles only, ~4:3 frame, one shared ground line,
// `aria-hidden`. Kept here (not `packages/ui`) per this pass's per-feature boundary -- worth promoting
// to the shared set since the "create or join a workspace" scene is a common enough shape.
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
      <rect x="24" y="122" width="152" height="3" rx="1.5" fill={MUTED} />
    </svg>
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
