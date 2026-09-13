// React Query hooks for the calendar feature (MODULE-GUIDE.md "Web features"). One cache-key family
// per resource, so rotating a feed never refetches the agenda and turning push on never refetches
// either.
import * as React from 'react'
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import type { Me } from '../../lib/api-schemas.js'
import * as api from './api.js'
import {
  currentSubscription,
  describeThisBrowser,
  disablePush,
  enablePush,
  pushSupport,
  subscriptionKeys,
  type PushSupport,
} from './lib/push-client.js'
import type { FeedKind } from './schemas.js'

/** The signed-in person's CSRF token, read from the `/me` response the shell already holds -- never
 * a second network call (the pattern every other feature's hooks file uses). */
export function useCsrfToken(): string {
  const queryClient = useQueryClient()
  const me = queryClient.getQueryData<Me | null>(['me'])
  return me?.csrfToken ?? ''
}

export const calendarKeys = {
  feeds: () => ['calendar', 'feeds'] as const,
  agenda: (days: number) => ['calendar', 'agenda', days] as const,
  pushKey: () => ['calendar', 'push', 'key'] as const,
  pushDevices: () => ['calendar', 'push', 'devices'] as const,
  addLinks: (eventId: string, locale: string) =>
    ['calendar', 'add-links', eventId, locale] as const,
}

// --- agenda ----------------------------------------------------------------------------------------

export function useAgendaQuery(days: number) {
  return useQuery({
    queryKey: calendarKeys.agenda(days),
    queryFn: () => api.fetchAgenda(days),
  })
}

/** H5.2 "prefetch on hover/focus": warms the default 30-day agenda before the sidebar click, under
 * exactly the key `calendar-screen.tsx` reads on mount. */
export function prefetchAgenda(qc: QueryClient): Promise<unknown> {
  return qc.prefetchQuery({ queryKey: calendarKeys.agenda(30), queryFn: () => api.fetchAgenda(30) })
}

// --- feeds -----------------------------------------------------------------------------------------

export function useFeedsQuery() {
  return useQuery({ queryKey: calendarKeys.feeds(), queryFn: () => api.fetchFeeds() })
}

export function useCreateFeed() {
  const queryClient = useQueryClient()
  const csrfToken = useCsrfToken()
  return useMutation({
    mutationFn: (input: { kind: FeedKind; label: string }) => api.createFeed(input, csrfToken),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: calendarKeys.feeds() }),
  })
}

export function useRotateFeed() {
  const queryClient = useQueryClient()
  const csrfToken = useCsrfToken()
  return useMutation({
    mutationFn: (id: string) => api.rotateFeed(id, csrfToken),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: calendarKeys.feeds() }),
  })
}

export function useRevokeFeed() {
  const queryClient = useQueryClient()
  const csrfToken = useCsrfToken()
  return useMutation({
    mutationFn: (id: string) => api.revokeFeed(id, csrfToken),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: calendarKeys.feeds() }),
  })
}

// --- add to calendar -------------------------------------------------------------------------------

/** Loaded only when the menu is actually opened (`enabled`), because four service URLs for an event
 * nobody is exporting is four URLs nobody needed. */
export function useAddToCalendarLinks(eventId: string | null, locale: string, enabled: boolean) {
  return useQuery({
    queryKey: calendarKeys.addLinks(eventId ?? '', locale),
    queryFn: () => api.fetchAddToCalendarLinks(eventId!, locale),
    enabled: enabled && eventId !== null,
    staleTime: 5 * 60 * 1000,
  })
}

// --- web push --------------------------------------------------------------------------------------

export function usePushKeyQuery() {
  return useQuery({
    queryKey: calendarKeys.pushKey(),
    queryFn: () => api.fetchPushKey(),
    staleTime: 60 * 60 * 1000,
  })
}

export function usePushDevicesQuery() {
  return useQuery({ queryKey: calendarKeys.pushDevices(), queryFn: () => api.fetchPushDevices() })
}

export type PushState = {
  support: PushSupport
  /** True when *this* browser holds a live subscription -- the only honest answer to "are reminders
   * on?", because the answer differs per device by design. */
  enabledHere: boolean
  /** This browser's endpoint, needed to unsubscribe the right row. */
  endpoint: string | null
  loading: boolean
}

/**
 * What this browser's push state actually is, re-read whenever the tab comes back to the front.
 *
 * The re-read matters: a person can revoke notification permission in browser settings without
 * WorkPortal hearing about it, and a panel that still claims "on" after that is a panel that lies.
 */
export function usePushState(): PushState & { refresh: () => void } {
  const [state, setState] = React.useState<PushState>({
    support: 'unsupported',
    enabledHere: false,
    endpoint: null,
    loading: true,
  })

  const read = React.useCallback(() => {
    let cancelled = false
    const support = pushSupport()
    if (support === 'unsupported' || support === 'denied') {
      setState({ support, enabledHere: false, endpoint: null, loading: false })
      return () => {
        cancelled = true
      }
    }
    void currentSubscription().then((subscription) => {
      if (cancelled) return
      setState({
        support,
        enabledHere: subscription !== null,
        endpoint: subscription?.endpoint ?? null,
        loading: false,
      })
    })
    return () => {
      cancelled = true
    }
  }, [])

  React.useEffect(() => {
    const cancel = read()
    const onVisible = () => {
      if (document.visibilityState === 'visible') read()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancel()
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [read])

  return { ...state, refresh: read }
}

export type EnablePushOutcome =
  | { ok: true }
  | { ok: false; reason: 'unsupported' | 'denied' | 'dismissed' | 'failed' }

/** Turn reminders on for this browser: ask, subscribe, then tell the API. */
export function useEnablePush() {
  const queryClient = useQueryClient()
  const csrfToken = useCsrfToken()
  return useMutation<EnablePushOutcome, Error, { publicKey: string; locale: string }>({
    mutationFn: async ({ publicKey, locale }) => {
      const result = await enablePush(publicKey)
      if (!result.ok) return { ok: false, reason: result.reason }
      await api.registerPushSubscription(
        {
          endpoint: result.endpoint,
          keys: result.keys,
          browserLabel: describeThisBrowser(),
          locale,
        },
        csrfToken,
      )
      return { ok: true }
    },
    onSuccess: (outcome) => {
      if (outcome.ok) void queryClient.invalidateQueries({ queryKey: calendarKeys.pushDevices() })
    },
  })
}

export function useDisablePush() {
  const queryClient = useQueryClient()
  const csrfToken = useCsrfToken()
  return useMutation({
    mutationFn: async () => {
      const endpoint = await disablePush()
      if (endpoint) await api.unregisterPushSubscription(endpoint, csrfToken)
      return { removed: endpoint !== null }
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: calendarKeys.pushDevices() }),
  })
}

/**
 * Repairs the server's record of *this* browser's subscription on every visit to the calendar
 * screen.
 *
 * Why it exists: a push service may rotate an endpoint at any time, and the service worker handles
 * that rotation locally but deliberately does not call home (it holds no CSRF token; see
 * `service-worker.ts`). So the subscription the browser holds can drift away from the row the API
 * has, and reminders stop arriving with nothing visibly wrong. One cheap upsert on a screen the
 * person opened anyway closes that gap -- `POST /push/subscriptions` is an upsert keyed on the
 * endpoint, so a repeat with an unchanged endpoint touches `last_seen_at` and nothing else.
 */
export function usePushSubscriptionRepair(locale: string, enabled: boolean): void {
  const csrfToken = useCsrfToken()
  const queryClient = useQueryClient()
  const done = React.useRef(false)

  React.useEffect(() => {
    if (!enabled || done.current || !csrfToken) return
    done.current = true
    void (async () => {
      const subscription = await currentSubscription()
      if (!subscription) return
      try {
        await api.registerPushSubscription(
          {
            endpoint: subscription.endpoint,
            keys: subscriptionKeys(subscription),
            browserLabel: describeThisBrowser(),
            locale,
          },
          csrfToken,
        )
        void queryClient.invalidateQueries({ queryKey: calendarKeys.pushDevices() })
      } catch {
        // A repair that fails is invisible by design: the person did not ask for it, and the next
        // visit tries again.
      }
    })()
  }, [enabled, csrfToken, locale, queryClient])
}
