import * as React from 'react'
import { cn } from '../lib/cn.js'
import { Skeleton } from '../primitives/skeleton.js'

export interface PageContainerProps {
  children: React.ReactNode
  /** `default` is the 1280 px working width (boards, tables, dashboards); `narrow` (960 px) suits a
   * settings or detail screen; `prose` (720 px) is for a page of text; `full` opts out entirely for
   * a board that must use every pixel. */
  width?: 'default' | 'narrow' | 'prose' | 'full'
  className?: string
}

const WIDTH_CLASS = {
  default: 'max-w-(--width-content)',
  narrow: 'max-w-(--width-content-narrow)',
  prose: 'max-w-(--width-content-prose)',
  full: '',
} as const

/** DESIGN.md §2.4's layout numbers, as one component instead of a `max-w-*` guess per screen. Every
 * route's content sits inside one of these, so the left edge of a heading is in the same place on
 * every screen -- the single cheapest thing that makes a set of screens read as one product. */
export function PageContainer({
  children,
  width = 'default',
  className,
}: PageContainerProps): React.JSX.Element {
  return (
    <div className={cn('mx-auto w-full min-w-0', WIDTH_CLASS[width], className)}>{children}</div>
  )
}

export interface RouteSkeletonProps {
  /** Announced politely while a lazy route chunk is still downloading. */
  label: string
  className?: string
}

/** The fallback every lazy route renders while its chunk loads. Shaped like a real page -- header,
 * three tiles, a body block -- rather than a spinner, so the layout does not jump when the content
 * lands (DESIGN.md §4: "skeleton matching final layout"). */
export function RouteSkeleton({ label, className }: RouteSkeletonProps): React.JSX.Element {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className={cn('flex w-full flex-col gap-6', className)}
    >
      <span className="sr-only">{label}</span>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-8 w-72 max-w-full" />
        <Skeleton className="h-4 w-100 max-w-full" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-28 w-full" />
      </div>
      <Skeleton className="h-64 w-full" />
    </div>
  )
}
