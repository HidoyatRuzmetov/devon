// Cover illustrations for event cards (TECH-SPEC §3.4/§5: "a curated open-licence 2D vector set
// (unDraw-style, recoloured to tokens)"). Original flat-geometric line work in this build (no network
// fetch available to vendor a third-party pack from this environment) drawn in the same spirit --
// two-tone, no gradients, no drop shadows -- and, critically, "recoloured to tokens": every fill
// below is a `var(--color-*)` custom property, never a literal hex, so light/dark and a future palette
// swap repaint these for free (DESIGN.md §2: "no raw colour in any component"). One illustration per
// `events.illustration_key`; unknown/missing keys fall back to the event's own category via
// `illustrationFor()`.
import * as React from 'react'

type IllustrationProps = { className?: string | undefined; style?: React.CSSProperties | undefined }

function Base({
  className,
  style,
  children,
}: {
  className?: string | undefined
  style?: React.CSSProperties | undefined
  children: React.ReactNode
}) {
  return (
    <svg
      viewBox="0 0 160 100"
      // "meet" (the SVG default) letterboxes/pillarboxes to fit the whole viewBox inside the
      // element's box -- which is why a full-bleed `object-cover w-full` container still showed
      // card background on either side of an illustration that never actually filled it. "slice"
      // crops instead, the SVG-native equivalent of object-fit: cover (CSS object-fit is not
      // reliably honoured on an inline <svg> root the way it is on an <img>).
      preserveAspectRatio="xMidYMid slice"
      className={className}
      style={style}
      role="img"
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width="160" height="100" fill="var(--color-illustration-fill)" />
      {children}
    </svg>
  )
}

function PicnicIllustration({ className, style }: IllustrationProps) {
  return (
    <Base className={className} style={style}>
      <circle cx="128" cy="24" r="14" fill="var(--color-illustration-accent)" />
      <rect x="20" y="58" width="120" height="8" rx="4" fill="var(--color-illustration-ink)" />
      <rect x="34" y="66" width="92" height="20" rx="3" fill="var(--color-illustration-muted)" />
      <path d="M34 66 L80 40 L126 66 Z" fill="var(--color-illustration-ink)" opacity="0.85" />
      <circle cx="60" cy="78" r="5" fill="var(--color-illustration-accent)" />
      <circle cx="80" cy="78" r="5" fill="var(--color-illustration-ink)" />
      <circle cx="100" cy="78" r="5" fill="var(--color-illustration-accent)" />
    </Base>
  )
}

function SportsIllustration({ className, style }: IllustrationProps) {
  return (
    <Base className={className} style={style}>
      <rect x="10" y="70" width="140" height="6" rx="3" fill="var(--color-illustration-muted)" />
      <circle
        cx="60"
        cy="46"
        r="18"
        fill="var(--color-illustration-muted)"
        stroke="var(--color-illustration-ink)"
        strokeWidth="3"
      />
      <path
        d="M42 46 H78 M60 28 V64 M48 34 Q60 46 48 58 M72 34 Q60 46 72 58"
        stroke="var(--color-illustration-ink)"
        strokeWidth="2"
        fill="none"
      />
      <rect x="100" y="30" width="8" height="40" rx="4" fill="var(--color-illustration-ink)" />
      <rect x="88" y="26" width="32" height="8" rx="4" fill="var(--color-illustration-ink)" />
    </Base>
  )
}

function TrainingIllustration({ className, style }: IllustrationProps) {
  return (
    <Base className={className} style={style}>
      <rect
        x="24"
        y="24"
        width="112"
        height="46"
        rx="4"
        fill="var(--color-illustration-muted)"
        stroke="var(--color-illustration-ink)"
        strokeWidth="3"
      />
      <path
        d="M36 58 L58 40 L76 52 L104 30"
        stroke="var(--color-illustration-accent)"
        strokeWidth="3"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="104" cy="30" r="4" fill="var(--color-illustration-accent)" />
      <rect x="70" y="74" width="20" height="8" rx="2" fill="var(--color-illustration-muted)" />
      <rect x="50" y="82" width="60" height="6" rx="3" fill="var(--color-illustration-muted)" />
    </Base>
  )
}

function VolunteeringIllustration({ className, style }: IllustrationProps) {
  return (
    <Base className={className} style={style}>
      <circle cx="80" cy="40" r="16" fill="var(--color-illustration-accent)" opacity="0.25" />
      <path
        d="M80 26 C68 26 60 34 60 46 C60 58 80 72 80 72 C80 72 100 58 100 46 C100 34 92 26 80 26 Z"
        fill="var(--color-illustration-accent)"
      />
      <rect x="30" y="80" width="100" height="6" rx="3" fill="var(--color-illustration-muted)" />
      <circle cx="30" cy="70" r="8" fill="var(--color-illustration-ink)" />
      <circle cx="130" cy="70" r="8" fill="var(--color-illustration-ink)" />
    </Base>
  )
}

function SocialIllustration({ className, style }: IllustrationProps) {
  return (
    <Base className={className} style={style}>
      <circle cx="56" cy="42" r="14" fill="var(--color-illustration-ink)" />
      <circle cx="90" cy="34" r="10" fill="var(--color-illustration-ink)" />
      <circle cx="108" cy="50" r="12" fill="var(--color-illustration-accent)" />
      <rect x="30" y="66" width="100" height="8" rx="4" fill="var(--color-illustration-muted)" />
    </Base>
  )
}

function FamilyIllustration({ className, style }: IllustrationProps) {
  return (
    <Base className={className} style={style}>
      <circle cx="52" cy="44" r="13" fill="var(--color-illustration-ink)" />
      <circle cx="80" cy="40" r="10" fill="var(--color-illustration-ink)" />
      <circle cx="102" cy="48" r="8" fill="var(--color-illustration-accent)" />
      <path
        d="M30 82 Q80 60 130 82"
        stroke="var(--color-illustration-muted)"
        strokeWidth="3"
        fill="none"
        strokeLinecap="round"
      />
    </Base>
  )
}

function TeamBuildingIllustration({ className, style }: IllustrationProps) {
  return (
    <Base className={className} style={style}>
      <rect x="40" y="30" width="20" height="20" rx="4" fill="var(--color-illustration-ink)" />
      <rect x="70" y="30" width="20" height="20" rx="4" fill="var(--color-illustration-ink)" />
      <rect x="100" y="30" width="20" height="20" rx="4" fill="var(--color-illustration-accent)" />
      <path
        d="M50 50 V64 M80 50 V64 M110 50 V64"
        stroke="var(--color-illustration-muted)"
        strokeWidth="2"
      />
      <rect x="34" y="64" width="92" height="8" rx="4" fill="var(--color-illustration-muted)" />
    </Base>
  )
}

function OtherIllustration({ className, style }: IllustrationProps) {
  return (
    <Base className={className} style={style}>
      <circle
        cx="80"
        cy="50"
        r="26"
        fill="var(--color-illustration-muted)"
        stroke="var(--color-illustration-ink)"
        strokeWidth="3"
      />
      <path
        d="M68 50 L77 59 L94 40"
        stroke="var(--color-illustration-ink)"
        strokeWidth="4"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Base>
  )
}

const REGISTRY: Record<string, React.ComponentType<IllustrationProps>> = {
  picnic: PicnicIllustration,
  sports: SportsIllustration,
  training: TrainingIllustration,
  volunteering: VolunteeringIllustration,
  social: SocialIllustration,
  family: FamilyIllustration,
  team_building: TeamBuildingIllustration,
  other: OtherIllustration,
}

/** A small, fixed set of deterministic looks for the *same* illustration -- a flip and a hue
 *  nudge, picked from a hash of the event's own id (never random: the same event must render
 *  identically on every load/every viewer, and two events picked from the same category-fallback
 *  key would otherwise be pixel-for-pixel identical, which the item handoff calls out by name:
 *  "the same two SVGs repeat across four events"). Four combinations is enough that four events
 *  sharing a category read as four different cards, not a repeated stamp. */
const VARIANTS: ReadonlyArray<{ flip: boolean; hueDeg: number }> = [
  { flip: false, hueDeg: 0 },
  { flip: true, hueDeg: 0 },
  { flip: false, hueDeg: 24 },
  { flip: true, hueDeg: -18 },
]

function hashString(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h
}

export type EventIllustrationProps = {
  /** `event.illustrationKey`, falling back to `event.category` when the key names nothing here. */
  illustrationKey: string
  category: string
  /** Seeds which of the fixed look variants this event gets -- pass `event.id`. Omit only for a
   *  context with no real event yet (a form preview), where every render sharing the fallback look
   *  is fine. */
  eventId?: string
  className?: string | undefined
}

export function EventIllustration({
  illustrationKey,
  category,
  eventId,
  className,
}: EventIllustrationProps) {
  const Component = REGISTRY[illustrationKey] ?? REGISTRY[category] ?? OtherIllustration
  const variant = VARIANTS[hashString(eventId ?? illustrationKey) % VARIANTS.length]!
  const style: React.CSSProperties = {
    transform: variant.flip ? 'scaleX(-1)' : undefined,
    filter: variant.hueDeg !== 0 ? `hue-rotate(${variant.hueDeg}deg)` : undefined,
  }
  return <Component className={className} style={style} />
}
