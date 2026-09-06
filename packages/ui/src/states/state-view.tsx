import * as React from 'react'
import { useT } from '@devon/i18n'
import { CircleAlert, Inbox, ShieldOff, WifiOff } from 'lucide-react'
import { cn } from '../lib/cn.js'
import { Button } from '../primitives/button.js'
import { Skeleton } from '../primitives/skeleton.js'

/** design.md §8 / AC-7's five forceable states, verbatim per the frozen work-item handoff contract
 * (EPIC-000.4). "Success" is the sixth state in DESIGN.md §4 but is a `Toast`, not a `StateView`
 * kind -- there is nothing to block a screen on when an action merely succeeded. */
export type StateKind = 'empty' | 'loading' | 'error' | 'forbidden' | 'offline'

export interface StateViewAction {
  labelKey: string
  onAction: () => void
}

export interface StateViewProps {
  kind: StateKind
  /** i18n key, e.g. `t('home.empty.member.title')`. StateView never accepts a literal string --
   * every state is user-visible copy and must go through the message catalogues (I-9). */
  titleKey: string
  bodyKey?: string | undefined
  /** Exactly one primary action, or none. design.md §8: "No secondary button, no 'Learn more' link.
   * Anything else is body text." There is no `secondaryAction` prop, by design -- adding one is a
   * spec violation, not a missing feature. */
  action?: StateViewAction
  /** kind="error" only (spec.md §8.3): a selectable, copyable reference id -- never a stack trace,
   * never an HTTP status, never "Error 500". */
  requestId?: string
  className?: string
}

const ICON: Partial<Record<StateKind, React.ComponentType<React.SVGProps<SVGSVGElement>>>> = {
  empty: Inbox,
  error: CircleAlert,
  forbidden: ShieldOff,
  offline: WifiOff,
}

/** The one state primitive every route in this epic renders for empty/loading/error/forbidden/
 * offline (AC-7). Loading renders a generic skeleton (a caller building a bespoke, pixel-matched
 * skeleton for its own layout composes `<Skeleton>` directly instead -- see design.md §8.2 "matching
 * final layout", which a one-size-fits-all component structurally cannot promise). The other four
 * kinds render: an icon standing in for design.md's "illustration <=160px or none", an h3 title, a
 * body line, and at most one primary `<Button data-primary>` -- asserted by the unit test below to be
 * exactly one element per kind whenever `action` is given, never zero and never two. */
export function StateView({
  kind,
  titleKey,
  bodyKey,
  action,
  requestId,
  className,
}: StateViewProps) {
  const t = useT()

  if (kind === 'loading') {
    return (
      <div
        role="status"
        aria-live="polite"
        className={cn('flex flex-col items-center gap-4 p-10', className)}
      >
        <span className="sr-only">{t(titleKey)}</span>
        <Skeleton className="h-9 w-70" />
        <Skeleton className="h-4 w-45" />
        <Skeleton className="h-55 w-full max-w-140" />
        {action ? (
          <Button data-primary variant="secondary" size="sm" onClick={action.onAction}>
            {t(action.labelKey)}
          </Button>
        ) : null}
      </div>
    )
  }

  const Icon = ICON[kind]
  return (
    <div
      role={kind === 'error' ? 'alert' : undefined}
      className={cn(
        'mx-auto flex max-w-140 flex-col items-center gap-4 rounded-md border border-border',
        'bg-card p-10 text-center',
        className,
      )}
    >
      {Icon ? <Icon className="size-10 text-muted-foreground" aria-hidden="true" /> : null}
      <h3 className="text-h3 text-foreground">{t(titleKey)}</h3>
      {bodyKey ? <p className="max-w-90 text-body text-muted-foreground">{t(bodyKey)}</p> : null}
      {kind === 'error' && requestId ? (
        <p className="select-text font-mono text-caption text-muted-foreground">
          {t('state.error.requestId', { id: requestId })}
        </p>
      ) : null}
      {action ? (
        <Button data-primary onClick={action.onAction}>
          {t(action.labelKey)}
        </Button>
      ) : null}
    </div>
  )
}
