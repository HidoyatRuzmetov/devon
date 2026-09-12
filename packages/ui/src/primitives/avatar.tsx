import * as React from 'react'
import * as AvatarPrimitive from '@radix-ui/react-avatar'
import { cn } from '../lib/cn.js'

/** DESIGN.md §2.1: the 8-hue categorical set, used only for avatars and unit chips, never a status
 * signal. `unitHueClass(seed)` picks a stable hue from a department/unit id so the same unit always
 * renders the same colour.
 *
 * Eight literal class names, never a `bg-unit-${n}` template: Tailwind v4 emits only utilities it can
 * read verbatim from source, so the template generated no CSS and every initials fallback rendered
 * transparent. `styles/tokens.css` also safelists the eight (`@source inline`) for callers that build
 * the string themselves. */
const UNIT_HUE_CLASSES = [
  'bg-unit-1',
  'bg-unit-2',
  'bg-unit-3',
  'bg-unit-4',
  'bg-unit-5',
  'bg-unit-6',
  'bg-unit-7',
  'bg-unit-8',
] as const
export function unitHueClass(seed: string): string {
  let hash = 0
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0
  return UNIT_HUE_CLASSES[hash % UNIT_HUE_CLASSES.length] ?? UNIT_HUE_CLASSES[0]
}

/** DESIGN.md §3: "initials from three-name rule". `given + family` per spec.md §4.5 ("A.Y."). */
export function initialsFromName(givenName: string, familyName: string): string {
  const g = givenName.trim().charAt(0).toUpperCase()
  const f = familyName.trim().charAt(0).toUpperCase()
  return `${g}${f}` || '?'
}

export interface AvatarProps extends React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Root> {
  src?: string | null
  alt: string
  /** Initials fallback, e.g. `initialsFromName(user.givenName, user.familyName)`. */
  initials: string
  /** A stable id (user id, unit id) used to pick a consistent unit hue for the initials fallback. */
  hueSeed?: string
  size?: 'xs' | 'sm' | 'md' | 'lg'
}

const SIZE_CLASS = {
  // v1.1: the secondary avatar on a board card (the giver behind the assignee, SPEC 3.3) -- small
  // enough to read as "and also" rather than as a second equal face.
  xs: 'size-5 text-[0.625rem]',
  sm: 'size-6 text-caption',
  md: 'size-9 text-small',
  lg: 'size-11 text-body',
} as const

export const Avatar = React.forwardRef<
  React.ComponentRef<typeof AvatarPrimitive.Root>,
  AvatarProps
>(({ className, src, alt, initials, hueSeed, size = 'md', ...props }, ref) => (
  <AvatarPrimitive.Root
    ref={ref}
    className={cn(
      'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-medium text-white',
      SIZE_CLASS[size],
      hueSeed ? unitHueClass(hueSeed) : 'bg-muted-foreground',
      className,
    )}
    {...props}
  >
    {src ? (
      // H6.1 "lazy loading below the fold": every caller renders dozens of these at once (board
      // columns, the people grid, member lists) -- native lazy-loading defers the ones outside the
      // viewport without this component (or its callers) needing to know which ones those are.
      <AvatarPrimitive.Image
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        className="size-full object-cover"
      />
    ) : null}
    <AvatarPrimitive.Fallback delayMs={src ? 400 : 0} aria-hidden="true">
      {initials}
    </AvatarPrimitive.Fallback>
    <span className="sr-only">{alt}</span>
  </AvatarPrimitive.Root>
))
Avatar.displayName = 'Avatar'
