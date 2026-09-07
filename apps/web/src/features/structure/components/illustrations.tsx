// Two illustrations this feature needs that `packages/ui/src/illustrations` does not yet carry:
// "no bo'lim yet" (structure's own empty state -- generic `EmptySearchIllustration` reads as "no
// results", not "nothing built here yet") and "no vacancy" for the org-chart's zero-heads state.
// Same idiom as the shared set (DESIGN.md v2 §2.7): two-tone flat vector, `var(--color-illustration-*)`
// roles only, ~4:3 frame, one shared ground line, `aria-hidden`. Kept here (not `packages/ui`) per
// this pass's per-feature boundary -- worth promoting to the shared set if another area wants it.
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
