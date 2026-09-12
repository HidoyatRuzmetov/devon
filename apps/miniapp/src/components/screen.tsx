// The frame every screen renders inside, plus the four states every screen must be able to show
// (I-10 / DESIGN.md §4). Kept in one file because in a Mini App they are one decision: the header,
// the scroll region and the state block all have to agree about the sheet's height.
import * as React from 'react'
import { ChevronLeft } from 'lucide-react'
import { useT } from '@devon/i18n'
import { cn, Skeleton, StateView, Stagger, StaggerItem } from '@devon/ui'
import { tg } from '../lib/telegram.js'
import { goBack } from '../lib/router.js'
import type { ApiError } from '../lib/api.js'

export function ScreenHeader({
  title,
  eyebrow,
  onBack,
  action,
}: {
  title: string
  eyebrow?: string
  /** When given, a back chevron appears and Telegram's own native back button is wired to it too. */
  onBack?: (() => void) | 'history'
  action?: React.ReactNode
}): React.ReactElement {
  const handleBack = React.useCallback(() => {
    tg.haptic.tap()
    if (onBack === 'history' || onBack === undefined) goBack()
    else onBack()
  }, [onBack])

  React.useEffect(() => {
    if (!onBack) return undefined
    // Telegram draws its own back button in the sheet chrome; showing ours *and* wiring theirs is
    // what makes the screen feel native on both iOS and Android.
    return tg.backButton.show(handleBack)
  }, [onBack, handleBack])

  const t = useT()
  return (
    <header
      className={cn(
        'bg-card/95 border-border sticky top-0 z-30 border-b backdrop-blur',
        'flex items-center gap-2 px-4 py-3',
      )}
    >
      {onBack ? (
        <button
          type="button"
          onClick={handleBack}
          aria-label={t('miniapp.action.back')}
          className={cn(
            'text-muted-foreground hover:text-foreground -ml-2 flex size-11 items-center justify-center',
            'rounded-md transition-colors duration-(--dur-micro)',
            'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
          )}
        >
          <ChevronLeft className="size-5" aria-hidden />
        </button>
      ) : null}
      <div className="min-w-0 flex-1">
        {eyebrow ? (
          <p className="text-muted-foreground text-[11px] leading-4 font-semibold tracking-[0.08em] uppercase">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="font-display text-foreground truncate text-[20px] leading-7">{title}</h1>
      </div>
      {action}
    </header>
  )
}

/** The scroll region. Bounded by Telegram's own reported sheet height so the tab bar is never pushed
 * under the keyboard and the page itself never scrolls behind the sheet. */
export function ScreenBody({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}): React.ReactElement {
  return (
    <main
      className={cn(
        'flex-1 overflow-y-auto overscroll-contain px-4 pt-3',
        // Room for the fixed tab bar plus the device's own safe area.
        'pb-[calc(var(--height-tabbar)+env(safe-area-inset-bottom)+16px)]',
        className,
      )}
    >
      {children}
    </main>
  )
}

/** A list that enters with the catalogue's 24 ms stagger (DESIGN.md §10, first row of the list
 * section) and crossfades instead under `prefers-reduced-motion` -- `Stagger` already does that. */
export function ScreenList({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}): React.ReactElement {
  return (
    <Stagger className={cn('flex flex-col gap-2', className)}>
      {React.Children.map(children, (child, index) =>
        child == null ? null : <StaggerItem key={index}>{child}</StaggerItem>,
      )}
    </Stagger>
  )
}

/** Skeleton rows shaped like the list they replace -- never a spinner (DESIGN.md §4). */
export function ListSkeleton({ rows = 5 }: { rows?: number }): React.ReactElement {
  return (
    <div className="flex flex-col gap-2" aria-hidden>
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-[72px] w-full rounded-md" />
      ))}
    </div>
  )
}

/**
 * Turns whatever a screen's query ended up in into the right designed state.
 *
 * `forbidden` matters more here than anywhere in the web app: the Mini App is opened from a chat
 * message that may be months old, by a person whose role has changed since. A 403 must read as "this
 * is the boshqarma boshligʻi's screen", not as a crash.
 */
export function QueryState({
  error,
  emptyTitleKey,
  emptyBodyKey,
  onRetry,
}: {
  error: ApiError | null
  emptyTitleKey?: string
  emptyBodyKey?: string
  onRetry: () => void
}): React.ReactElement {
  if (!error) {
    return (
      <StateView
        kind="empty"
        titleKey={emptyTitleKey ?? 'miniapp.empty.title'}
        bodyKey={emptyBodyKey ?? 'miniapp.empty.body'}
        compact
      />
    )
  }
  if (error.isOffline) {
    return (
      <StateView
        kind="offline"
        titleKey="miniapp.offline.title"
        bodyKey="miniapp.offline.body"
        action={{ labelKey: 'miniapp.action.retry', onAction: onRetry }}
        compact
      />
    )
  }
  if (error.isForbidden) {
    return (
      <StateView
        kind="forbidden"
        titleKey="miniapp.forbidden.title"
        bodyKey="miniapp.forbidden.body"
        compact
      />
    )
  }
  return (
    <StateView
      kind="error"
      titleKey="miniapp.error.title"
      bodyKey="miniapp.error.body"
      {...(error.requestId ? { requestId: error.requestId } : {})}
      action={{ labelKey: 'miniapp.action.retry', onAction: onRetry }}
      compact
    />
  )
}
