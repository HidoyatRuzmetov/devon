import * as React from 'react'
import { useT } from '@devon/i18n'
import { cn } from '../lib/cn.js'
import { Button } from '../primitives/button.js'
import { Skeleton } from '../primitives/skeleton.js'
import { EmptyState, ErrorState, NoPermissionState, OfflineState } from './empty-state.js'
import {
  EmptySearchIllustration,
  ErrorIllustration,
  NoPermissionIllustration,
  OfflineIllustration,
} from '../illustrations/index.js'

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
  /** Replaces the kind's default illustration -- e.g. a board's empty state wants the board drawing,
   * not the generic one. */
  illustration?: React.ReactNode
  /** Drops the illustration for a state rendered inside a column or a small card. */
  compact?: boolean
  className?: string
}

/** The one state primitive every route renders for empty/loading/error/forbidden/offline (AC-7).
 *
 * Since the UI overhaul this is a thin, i18n-key-taking façade over the four designed state
 * components in `empty-state.tsx` (which take plain strings, because a feature already has `t`).
 * Keeping both is deliberate: every existing call site passes keys, and the *rule* this component
 * enforces -- one primary action, never two -- lives in one place either way.
 *
 * Loading renders a layout-shaped shimmer skeleton (a caller building a pixel-matched skeleton for
 * its own layout composes `<Skeleton>` directly instead -- design.md §8.2's "matching final layout"
 * is something a one-size-fits-all component structurally cannot promise). */
export function StateView({
  kind,
  titleKey,
  bodyKey,
  action,
  requestId,
  illustration,
  compact = false,
  className,
}: StateViewProps): React.JSX.Element {
  const t = useT()

  if (kind === 'loading') {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-busy="true"
        className={cn('mx-auto flex w-full max-w-160 flex-col gap-4 p-6', className)}
      >
        <span className="sr-only">{t(titleKey)}</span>
        <Skeleton className="h-8 w-60" />
        <Skeleton className="h-4 w-40" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
        <Skeleton className="h-40 w-full" />
        {action ? (
          <Button
            data-primary
            variant="secondary"
            size="sm"
            className="self-center"
            onClick={action.onAction}
          >
            {t(action.labelKey)}
          </Button>
        ) : null}
      </div>
    )
  }

  const common = {
    title: t(titleKey),
    ...(bodyKey ? { body: t(bodyKey) } : {}),
    ...(action ? { action: { label: t(action.labelKey), onAction: action.onAction } } : {}),
    compact,
    ...(className ? { className } : {}),
  }

  if (kind === 'error') {
    return (
      <ErrorState
        {...common}
        illustration={illustration ?? <ErrorIllustration />}
        {...(requestId
          ? { requestId, requestIdLabel: t('state.error.requestId', { id: requestId }) }
          : {})}
      />
    )
  }
  if (kind === 'forbidden') {
    return (
      <NoPermissionState {...common} illustration={illustration ?? <NoPermissionIllustration />} />
    )
  }
  if (kind === 'offline') {
    return <OfflineState {...common} illustration={illustration ?? <OfflineIllustration />} />
  }
  return <EmptyState {...common} illustration={illustration ?? <EmptySearchIllustration />} />
}
