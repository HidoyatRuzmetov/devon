// Sign-in state for the whole app: one exchange on boot, one context, one retry path.
//
// The identity it holds is the server's answer, never something read out of `initData` on the
// client: `initDataUnsafe` is called unsafe for a reason, and the only party that may decide who is
// signed in is the API that verified the HMAC (I-6).
import * as React from 'react'
import type { MiniappSession } from '@devon/contracts'
import { resolveLocale, setLocale } from '@devon/i18n'
import { ApiError, signIn } from './api.js'
import { tg } from './telegram.js'

export type SessionState =
  | { status: 'loading' }
  | { status: 'ready'; session: MiniappSession }
  | { status: 'unlinked' }
  | { status: 'offline' }
  | { status: 'error'; requestId: string | null }

type SessionContextValue = {
  state: SessionState
  reload: () => void
}

const SessionContext = React.createContext<SessionContextValue>({
  state: { status: 'loading' },
  reload: () => {},
})

export function SessionProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [state, setState] = React.useState<SessionState>({ status: 'loading' })
  const [attempt, setAttempt] = React.useState(0)

  React.useEffect(() => {
    let cancelled = false
    setState({ status: 'loading' })
    signIn()
      .then((session) => {
        if (cancelled) return
        // The account's own saved locale wins over Telegram's client language: a xodim who set the
        // product to Russian means it (DESIGN.md §5, and the same rule `apps/web`'s locale boot uses).
        setLocale(resolveLocale({ user: session.user.locale }))
        setState({ status: 'ready', session })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        if (error instanceof ApiError && error.isOffline) {
          setState({ status: 'offline' })
          return
        }
        // 401 from the exchange means exactly one thing: this Telegram chat is not linked to a
        // WorkPortal account yet (or the web browser running the dev stub is not signed in). That is
        // not an error state, it is an instruction -- see `unlinked-screen.tsx`.
        if (error instanceof ApiError && error.status === 401) {
          setState({ status: 'unlinked' })
          return
        }
        setState({
          status: 'error',
          requestId: error instanceof ApiError ? error.requestId : null,
        })
      })
    return () => {
      cancelled = true
    }
  }, [attempt])

  const value = React.useMemo<SessionContextValue>(
    () => ({ state, reload: () => setAttempt((n) => n + 1) }),
    [state],
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSessionState(): SessionContextValue {
  return React.useContext(SessionContext)
}

/** For the screens, which only ever render once the provider has reached `ready`. */
export function useSession(): MiniappSession {
  const { state } = React.useContext(SessionContext)
  if (state.status !== 'ready') {
    throw new Error('useSession() called outside a ready session')
  }
  return state.session
}

export function useIsHead(): boolean {
  const { state } = React.useContext(SessionContext)
  return state.status === 'ready' && state.session.departmentRole === 'head'
}

/** True while the app is running on a web session rather than a verified Telegram launch -- the app
 * shows a visible strip, so a screenshot of the dev path can never be mistaken for the real one. */
export function useIsDevMode(): boolean {
  const { state } = React.useContext(SessionContext)
  return state.status === 'ready' && (state.session.source === 'web_session' || !tg.isTelegram)
}
