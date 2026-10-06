// SPEC §7 -- "Imkoniyatlar": the client half of the department's feature switches.
//
// The sibling of `can.tsx`, and deliberately a *different* question. `useCan` asks "may this person
// do it?"; `useFeature` asks "does this department use it at all?". A switch that is off hides a
// capability from everyone, head included -- it is a scope decision, not a permission -- so a screen
// gated by `useFeature` renders nothing at all rather than a no-permission state.
//
// Values come from `GET /api/v1/departments/:id`'s `settings.features`, already merged against the
// registry defaults on the server (`packages/contracts/src/features.ts`'s `resolveFeatures`), so
// nothing here has to know the defaults. Cached by TanStack Query under the same key the department
// detail screen uses, so switching a toggle there refreshes every gated screen with one invalidate
// and no second request.
import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { FEATURE_KEYS, resolveFeatures, type FeatureFlags, type FeatureKey } from '@devon/contracts'
import { fetchDepartment } from '../features/departments/api.js'
import { useDepartment } from './session.js'

export type UseFeaturesResult = {
  features: FeatureFlags
  /** True until the department's settings have loaded. A gated screen should render its skeleton
   * rather than flashing "this is off" and then revealing itself. */
  isLoading: boolean
  isError: boolean
  retry: () => void
}

/** Every switch for the department the viewer is currently working in. */
export function useFeatures(): UseFeaturesResult {
  const { departmentId } = useDepartment()
  const query = useQuery({
    queryKey: ['departments', 'detail', departmentId ?? ''],
    queryFn: () => fetchDepartment(departmentId!),
    enabled: Boolean(departmentId),
    // Switches change a handful of times in a department's life; re-asking on every mount of every
    // gated component would be pure noise on the network panel.
    staleTime: 5 * 60_000,
  })

  return React.useMemo(
    () => ({
      // `resolveFeatures` again on this side: a response from an older server that predates a switch
      // simply gets that switch's default instead of `undefined` leaking into a boolean prop.
      features: resolveFeatures(query.data?.settings.features),
      isLoading: Boolean(departmentId) && query.isPending,
      isError: query.isError,
      retry: () => {
        void query.refetch()
      },
    }),
    [departmentId, query.data, query.isPending, query.isError, query.refetch],
  )
}

/**
 * One switch.
 *
 * ```tsx
 * const estimates = useFeature('estimates')
 * {estimates ? <EstimateField /> : null}
 * ```
 *
 * Answers `false` while loading and for a viewer with no department, which is the fail-closed
 * direction: a capability that briefly fails to appear is a blink, one that briefly appears and then
 * vanishes is a bug report.
 */
export function useFeature(key: FeatureKey): boolean {
  const { features, isLoading } = useFeatures()
  return isLoading ? false : features[key]
}

export type FeatureProps = {
  feature: FeatureKey
  children: React.ReactNode
  /** Rendered instead when the switch is off. Usually nothing -- see this file's header. */
  fallback?: React.ReactNode
}

/** The declarative form, for whole blocks. */
export function Feature({ feature, children, fallback = null }: FeatureProps): React.JSX.Element {
  return <>{useFeature(feature) ? children : fallback}</>
}

export { FEATURE_KEYS }
export type { FeatureFlags, FeatureKey }
