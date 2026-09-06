import * as React from 'react'
import * as AvatarPrimitive from '@radix-ui/react-avatar'
import { cn } from '../lib/cn.js'

/** DESIGN.md §2.1: the 8-hue categorical set, used only for avatars and unit chips, never a status
 * signal. `unitHue(seed)` picks a stable hue from a department/unit id so the same unit always
 * renders the same colour without a lookup table. */
const UNIT_HUE_COUNT = 8
export function unitHueClass(seed: string): string {
  let hash = 0
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0
  return `bg-unit-${(hash % UNIT_HUE_COUNT) + 1}`
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
  size?: 'sm' | 'md' | 'lg'
}

const SIZE_CLASS = {
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
    {src ? <AvatarPrimitive.Image src={src} alt={alt} className="size-full object-cover" /> : null}
    <AvatarPrimitive.Fallback delayMs={src ? 400 : 0} aria-hidden="true">
      {initials}
    </AvatarPrimitive.Fallback>
    <span className="sr-only">{alt}</span>
  </AvatarPrimitive.Root>
))
Avatar.displayName = 'Avatar'
