import * as React from 'react'
import { cn } from '../lib/cn.js'
import { Avatar } from './avatar.js'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './tooltip.js'

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
  /** Names the group; each individual face can also be focused to read its own name. */
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
    <TooltipProvider delayDuration={120} skipDelayDuration={300} disableHoverableContent>
      <div className={cn('flex items-center', className)} aria-label={label} role="group">
        <div className="flex items-center -space-x-2">
          {shown.map((person) => (
            <StackPerson key={person.id} name={person.name} tooltip={person.name}>
              <Avatar
                src={person.src ?? null}
                alt={person.name}
                initials={person.initials}
                hueSeed={person.id}
                size={size}
                decorative
                className="ring-2 ring-card"
              />
            </StackPerson>
          ))}
          {overflow > 0 ? (
            <StackPerson
              name={people
                .slice(shown.length)
                .map((person) => person.name)
                .join(', ')}
              tooltip={people.slice(shown.length).map((person) => (
                <div key={person.id}>{person.name}</div>
              ))}
            >
              <span
                className={cn(
                  'inline-flex shrink-0 items-center justify-center rounded-full bg-muted font-medium text-muted-foreground ring-2 ring-card',
                  size === 'sm' ? 'size-6 text-caption' : 'size-9 text-small',
                )}
              >{`+${overflow}`}</span>
            </StackPerson>
          ) : null}
        </div>
      </div>
    </TooltipProvider>
  )
}

/** The target stays still while its child face moves, avoiding hover flicker along the bottom edge.
 * A real button also lets touch/keyboard users reveal the same name hint. */
function StackPerson({
  name,
  tooltip,
  children,
}: {
  name: string
  tooltip: React.ReactNode
  children: React.ReactNode
}) {
  const [open, setOpen] = React.useState(false)
  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="devon-avatar-stack-item inline-flex shrink-0 rounded-full"
          aria-label={name}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            setOpen(true)
          }}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-64">{tooltip}</TooltipContent>
    </Tooltip>
  )
}
