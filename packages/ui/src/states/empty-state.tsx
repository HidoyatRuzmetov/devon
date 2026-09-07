import * as React from 'react'
import { CircleAlert, ShieldOff, WifiOff } from 'lucide-react'
import { cn } from '../lib/cn.js'
import { Button } from '../primitives/button.js'
import { IdleFloat } from '../motion/ambient-gradient.js'
import { Reveal } from '../motion/reveal.js'
import {
  EmptyWorkIllustration,
  ErrorIllustration,
  NoPermissionIllustration,
  OfflineIllustration,
} from '../illustrations/index.js'

export interface StateAction {
  label: string
  onAction: () => void
}

interface BaseStateProps {
  title: string
  body?: string
  /** DESIGN.md §4: "Empty (teaches the next action, one button ...)". Exactly one, or none. There is
   * no `secondaryAction` prop by design -- a second button is a spec violation, not a gap. */
  action?: StateAction
  /** Replaces the default illustration. Pass one from `@devon/ui`'s illustration set, or a compact
   * icon for a state inside a small panel. */
  illustration?: React.ReactNode
  /** Drops the illustration entirely -- for a state rendered inside a column or a card too small to
   * carry one (DESIGN.md §4: "no illustration larger than 160 px"). */
  compact?: boolean
  className?: string
}

function StateShell({
  title,
  body,
  action,
  illustration,
  compact = false,
  role,
  extra,
  className,
}: BaseStateProps & { role?: 'alert'; extra?: React.ReactNode }): React.JSX.Element {
  return (
    <Reveal
      className={cn(
        'mx-auto flex max-w-140 flex-col items-center gap-4 rounded-md border border-border',
        'bg-card px-6 py-10 text-center',
        className,
      )}
    >
      <div {...(role ? { role } : {})} className="flex flex-col items-center gap-4">
        {compact || !illustration ? null : (
          // UI-OVERHAUL.md §3 "Empty states": the illustration floats on a 4 s loop and stops
          // completely under reduced motion.
          <IdleFloat className="w-40 max-w-full text-illustration-ink">{illustration}</IdleFloat>
        )}
        <h3 className="font-display text-h3 text-foreground">{title}</h3>
        {body ? <p className="max-w-100 text-body text-muted-foreground">{body}</p> : null}
        {extra}
        {action ? (
          <Button data-primary onClick={action.onAction}>
            {action.label}
          </Button>
        ) : null}
      </div>
    </Reveal>
  )
}

/** DESIGN.md §4, state 1. Teaches the next action with one button and an illustration that says what
 * this screen will hold once it has content. */
export function EmptyState({ illustration, ...props }: BaseStateProps): React.JSX.Element {
  return <StateShell {...props} illustration={illustration ?? <EmptyWorkIllustration />} />
}

export interface ErrorStateProps extends BaseStateProps {
  /** spec.md §8.3: a selectable, copyable reference id -- never a stack trace, never an HTTP status,
   * never "Error 500". */
  requestId?: string
  requestIdLabel?: string
}

/** DESIGN.md §4, state 3: what happened, what to do, retry. */
export function ErrorState({
  illustration,
  requestId,
  requestIdLabel,
  ...props
}: ErrorStateProps): React.JSX.Element {
  return (
    <StateShell
      {...props}
      role="alert"
      illustration={illustration ?? <ErrorIllustration />}
      extra={
        requestId ? (
          <p className="select-text font-mono text-caption text-muted-foreground">
            {requestIdLabel ?? requestId}
          </p>
        ) : null
      }
    />
  )
}

/** DESIGN.md §4, state 4: what this is, who to ask. Never "403", never "Access denied". */
export function NoPermissionState({ illustration, ...props }: BaseStateProps): React.JSX.Element {
  return <StateShell {...props} illustration={illustration ?? <NoPermissionIllustration />} />
}

/** DESIGN.md §4, state 6, in its full-screen form (the banner is the with-cached-content form). */
export function OfflineState({ illustration, ...props }: BaseStateProps): React.JSX.Element {
  return <StateShell {...props} illustration={illustration ?? <OfflineIllustration />} />
}

/** Compact icons for the same four meanings, when a state has to fit inside a board column or a
 * card and an illustration would be out of scale. */
export const COMPACT_STATE_ICON = {
  error: CircleAlert,
  forbidden: ShieldOff,
  offline: WifiOff,
} as const
