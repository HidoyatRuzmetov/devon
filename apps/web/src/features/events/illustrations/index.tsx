// Cover illustrations for event cards (TECH-SPEC §3.4/§5: "a curated open-licence 2D vector set
// (unDraw-style, recoloured to tokens)"). Original flat-geometric line work in this build (no network
// fetch available to vendor a third-party pack from this environment) drawn in the same spirit --
// two-tone, no gradients, no drop shadows -- and, critically, "recoloured to tokens": every fill
// below is a `var(--color-*)` custom property, never a literal hex, so light/dark and a future palette
// swap repaint these for free (DESIGN.md §2: "no raw colour in any component"). One illustration per
// `events.illustration_key`; unknown/missing keys fall back to the event's own category via
// `illustrationFor()`.
import * as React from 'react'

type IllustrationProps = { className?: string | undefined }

function Base({
  className,
  children,
}: {
  className?: string | undefined
  children: React.ReactNode
}) {
  return (
    <svg
      viewBox="0 0 160 100"
      className={className}
      role="img"
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width="160" height="100" fill="var(--color-accent)" />
      {children}
    </svg>
  )
}

function PicnicIllustration({ className }: IllustrationProps) {
  return (
    <Base className={className}>
      <circle cx="128" cy="24" r="14" fill="var(--color-warning)" />
      <rect x="20" y="58" width="120" height="8" rx="4" fill="var(--color-primary)" />
      <rect x="34" y="66" width="92" height="20" rx="3" fill="var(--color-card)" />
      <path d="M34 66 L80 40 L126 66 Z" fill="var(--color-primary)" opacity="0.85" />
      <circle cx="60" cy="78" r="5" fill="var(--color-success)" />
      <circle cx="80" cy="78" r="5" fill="var(--color-info)" />
      <circle cx="100" cy="78" r="5" fill="var(--color-warning)" />
    </Base>
  )
}

function SportsIllustration({ className }: IllustrationProps) {
  return (
    <Base className={className}>
      <rect x="10" y="70" width="140" height="6" rx="3" fill="var(--color-muted-foreground)" />
      <circle
        cx="60"
        cy="46"
        r="18"
        fill="var(--color-card)"
        stroke="var(--color-primary)"
        strokeWidth="3"
      />
      <path
        d="M42 46 H78 M60 28 V64 M48 34 Q60 46 48 58 M72 34 Q60 46 72 58"
        stroke="var(--color-primary)"
        strokeWidth="2"
        fill="none"
      />
      <rect x="100" y="30" width="8" height="40" rx="4" fill="var(--color-info)" />
      <rect x="88" y="26" width="32" height="8" rx="4" fill="var(--color-info)" />
    </Base>
  )
}

function TrainingIllustration({ className }: IllustrationProps) {
  return (
    <Base className={className}>
      <rect
        x="24"
        y="24"
        width="112"
        height="46"
        rx="4"
        fill="var(--color-card)"
        stroke="var(--color-primary)"
        strokeWidth="3"
      />
      <path
        d="M36 58 L58 40 L76 52 L104 30"
        stroke="var(--color-success)"
        strokeWidth="3"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="104" cy="30" r="4" fill="var(--color-success)" />
      <rect x="70" y="74" width="20" height="8" rx="2" fill="var(--color-muted-foreground)" />
      <rect x="50" y="82" width="60" height="6" rx="3" fill="var(--color-muted-foreground)" />
    </Base>
  )
}

function VolunteeringIllustration({ className }: IllustrationProps) {
  return (
    <Base className={className}>
      <circle cx="80" cy="40" r="16" fill="var(--color-success)" opacity="0.25" />
      <path
        d="M80 26 C68 26 60 34 60 46 C60 58 80 72 80 72 C80 72 100 58 100 46 C100 34 92 26 80 26 Z"
        fill="var(--color-success)"
      />
      <rect x="30" y="80" width="100" height="6" rx="3" fill="var(--color-muted-foreground)" />
      <circle cx="30" cy="70" r="8" fill="var(--color-primary)" />
      <circle cx="130" cy="70" r="8" fill="var(--color-info)" />
    </Base>
  )
}

function SocialIllustration({ className }: IllustrationProps) {
  return (
    <Base className={className}>
      <circle cx="56" cy="42" r="14" fill="var(--color-primary)" />
      <circle cx="90" cy="34" r="10" fill="var(--color-info)" />
      <circle cx="108" cy="50" r="12" fill="var(--color-warning)" />
      <rect x="30" y="66" width="100" height="8" rx="4" fill="var(--color-card)" />
    </Base>
  )
}

function FamilyIllustration({ className }: IllustrationProps) {
  return (
    <Base className={className}>
      <circle cx="52" cy="44" r="13" fill="var(--color-primary)" />
      <circle cx="80" cy="40" r="10" fill="var(--color-info)" />
      <circle cx="102" cy="48" r="8" fill="var(--color-warning)" />
      <path
        d="M30 82 Q80 60 130 82"
        stroke="var(--color-muted-foreground)"
        strokeWidth="3"
        fill="none"
        strokeLinecap="round"
      />
    </Base>
  )
}

function TeamBuildingIllustration({ className }: IllustrationProps) {
  return (
    <Base className={className}>
      <rect x="40" y="30" width="20" height="20" rx="4" fill="var(--color-primary)" />
      <rect x="70" y="30" width="20" height="20" rx="4" fill="var(--color-info)" />
      <rect x="100" y="30" width="20" height="20" rx="4" fill="var(--color-success)" />
      <path
        d="M50 50 V64 M80 50 V64 M110 50 V64"
        stroke="var(--color-muted-foreground)"
        strokeWidth="2"
      />
      <rect x="34" y="64" width="92" height="8" rx="4" fill="var(--color-card)" />
    </Base>
  )
}

function OtherIllustration({ className }: IllustrationProps) {
  return (
    <Base className={className}>
      <circle
        cx="80"
        cy="50"
        r="26"
        fill="var(--color-card)"
        stroke="var(--color-primary)"
        strokeWidth="3"
      />
      <path
        d="M68 50 L77 59 L94 40"
        stroke="var(--color-primary)"
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

export type EventIllustrationProps = {
  /** `event.illustrationKey`, falling back to `event.category` when the key names nothing here. */
  illustrationKey: string
  category: string
  className?: string | undefined
}

export function EventIllustration({
  illustrationKey,
  category,
  className,
}: EventIllustrationProps) {
  const Component = REGISTRY[illustrationKey] ?? REGISTRY[category] ?? OtherIllustration
  return <Component className={className} />
}
