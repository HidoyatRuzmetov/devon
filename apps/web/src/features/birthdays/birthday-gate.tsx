import * as React from 'react'
import { z } from 'zod'
import { useQuery } from '@tanstack/react-query'
import { apiClient } from '../../lib/api-client.js'
import { useMeQuery } from '../../lib/session.js'
import { useIsViewingAs } from '../admin/view-as-banner.js'

const Celebration = React.lazy(() => import('./celebration.js'))
const responseSchema = z.object({
  celebration: z
    .object({ date: z.string(), message: z.string(), claimToken: z.string() })
    .nullable(),
})

async function acknowledgeSeen(claimToken: string, date: string, csrfToken: string) {
  // Idempotent receipt: short transient failures must not turn a viewed letter into a second event.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      // nosemgrep: query-in-loop -- Retry this same idempotent receipt only after a failed attempt; at most three attempts.
      await apiClient.post(
        '/api/v1/accounts/birthday/seen',
        { claimToken, date },
        z.object({ ok: z.boolean() }),
        csrfToken,
      )
      return
    } catch {
      if (attempt < 2)
        // nosemgrep: query-in-loop -- Sequential 1s/2s backoff between failures; parallel requests would defeat the retry policy.
        await new Promise((resolve) => window.setTimeout(resolve, (attempt + 1) * 1000))
    }
  }
}

export function BirthdayGate() {
  const { data: me } = useMeQuery()
  const viewingAs = useIsViewingAs()
  const [dismissed, setDismissed] = React.useState<string | null>(null)
  const [visible, setVisible] = React.useState(() => document.visibilityState === 'visible')
  const [entry, setEntry] = React.useState(0)
  const [presented, setPresented] = React.useState<
    (NonNullable<z.infer<typeof responseSchema>['celebration']> & { ownerId: string }) | null
  >(null)
  const token = React.useRef(crypto.randomUUID())
  const [day, setDay] = React.useState(() =>
    new Date(Date.now() + 18_000_000).toISOString().slice(0, 10),
  )
  React.useEffect(() => {
    const update = () => setDay(new Date(Date.now() + 18_000_000).toISOString().slice(0, 10))
    const timer = setInterval(update, 60_000)
    const visibility = () => {
      const foreground = document.visibilityState === 'visible'
      setVisible(foreground)
      if (foreground) {
        update()
        setEntry((value) => value + 1)
      }
    }
    window.addEventListener('focus', update)
    document.addEventListener('visibilitychange', visibility)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', update)
      document.removeEventListener('visibilitychange', visibility)
    }
  }, [])
  const userId = me?.user.id
  const query = useQuery({
    queryKey: ['birthday', userId, me?.activeDepartmentId, day, entry],
    enabled:
      !!userId &&
      !!me?.activeDepartmentId &&
      visible &&
      !viewingAs &&
      !me?.actingForUserId &&
      !me?.instance.maintenance,
    queryFn: () =>
      apiClient.post(
        '/api/v1/accounts/birthday/open',
        { claimToken: token.current },
        responseSchema,
        me?.csrfToken ?? '',
      ),
    staleTime: 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  })
  React.useEffect(() => {
    const fresh = query.data?.celebration
    if (visible && fresh && userId && dismissed !== `${userId}:${fresh.date}`)
      setPresented((current) =>
        current?.ownerId === userId && current.date === fresh.date
          ? current
          : { ...fresh, ownerId: userId },
      )
  }, [visible, query.data, userId, dismissed])
  const celebration = presented?.ownerId === userId ? presented : null
  if (
    !me ||
    !celebration ||
    viewingAs ||
    me.actingForUserId ||
    dismissed === `${userId}:${celebration.date}`
  )
    return null
  return (
    <React.Suspense fallback={null}>
      <Celebration
        firstName={me.user.givenName}
        message={celebration.message}
        onClose={() => {
          setDismissed(`${userId}:${celebration.date}`)
          setPresented(null)
        }}
        onSeen={() => {
          void acknowledgeSeen(celebration.claimToken, celebration.date, me.csrfToken)
        }}
      />
    </React.Suspense>
  )
}
