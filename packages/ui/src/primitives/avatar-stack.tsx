import * as React from 'react'
import { cn } from '../lib/cn.js'
import { Avatar } from './avatar.js'

export interface AvatarStackPerson {
  id: string
  name: string
  initials: string
  src?: string | null
}

export interface AvatarStackProps {
  people: readonly AvatarStackPerson[]
  /** How many faces to show before collapsing the rest into a "+N" disc. */
  max?: number
  size?: 'sm' | 'md'
  /** Reads out the whole group, e.g. "12 ishtirokchi" -- the individual faces are `aria-hidden`
   * inside it, because a screen reader announcing eight names in a row is noise, not information. */
  label: string
  className?: string
}

/** DESIGN.md §3 "AvatarStack": event attendees, card watchers, project members. Overlapping discs
 * with a ring in the surface colour so the overlap reads as depth in both themes. */
export function AvatarStack({
  people,
  max = 5,
  size = 'sm',
  label,
  className,
}: AvatarStackProps): React.JSX.Element {
  const shown = people.slice(0, max)
  const overflow = people.length - shown.length

  return (
    <div className={cn('flex items-center', className)} aria-label={label} role="group">
      <div className="flex -space-x-2" aria-hidden="true">
        {shown.map((person) => (
          <Avatar
            key={person.id}
            src={person.src ?? null}
            alt={person.name}
            initials={person.initials}
            hueSeed={person.id}
            size={size}
            className="ring-2 ring-card"
          />
        ))}
        {overflow > 0 ? (
          <span
            className={cn(
              'inline-flex shrink-0 items-center justify-center rounded-full bg-muted font-medium text-muted-foreground ring-2 ring-card',
              size === 'sm' ? 'size-6 text-caption' : 'size-9 text-small',
            )}
          >
            {`+${overflow}`}
          </span>
        ) : null}
      </div>
    </div>
  )
}
