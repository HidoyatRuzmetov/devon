import * as React from 'react'
import { Bell, CalendarDays, CheckSquare, LayoutGrid, Timer } from 'lucide-react'
import { useT } from '@devon/i18n'
import { cn, MotionProvider, StateView, Toaster } from '@devon/ui'
import { SessionProvider, useIsDevMode, useSessionState } from './lib/session.js'
import { tg } from './lib/telegram.js'
import { navigate, routeFromStartParam, useRoute, type Route } from './lib/router.js'
import { TabBar, type TabEntry } from './components/tab-bar.js'
import { ListSkeleton, ScreenBody, ScreenHeader } from './components/screen.js'
import { TodayScreen } from './screens/today-screen.js'
import { InboxScreen } from './screens/inbox-screen.js'
import { BoardScreen } from './screens/board-screen.js'
import { CardScreen } from './screens/card-screen.js'
import { EventsScreen } from './screens/events-screen.js'
import { EventScreen } from './screens/event-screen.js'
import { FocusScreen } from './screens/focus-screen.js'
import { FieldsScreen } from './screens/fields-screen.js'
import { SetupScreen } from './screens/setup-screen.js'

/** Keeps `<html data-theme>` in step with Telegram's own light/dark switch, and repaints the sheet
 * chrome with Devon's tokens afterwards so the frame and the app are one surface. Outside Telegram
 * the stub reports the OS preference, so the same code path runs in a browser. */
function useTelegramTheme(): void {
  React.useEffect(() => {
    const apply = (): void => {
      document.documentElement.dataset['theme'] = tg.colorScheme
      // One frame later: the token values for the new theme have to be on the element before they
      // can be read back and handed to Telegram.
      requestAnimationFrame(() => tg.paintChrome())
    }
    apply()
    return tg.onEvent('themeChanged', apply)
  }, [])
}

/** Telegram reports how much of the screen its sheet actually occupies, and changes it when the user
 * drags or the keyboard opens. Mirroring it into a custom property is what keeps the tab bar on the
 * visible edge instead of somewhere under the fold. */
function useViewportHeight(): void {
  React.useEffect(() => {
    const apply = (): void => {
      const height = tg.viewportStableHeight
      document.documentElement.style.setProperty(
        '--tg-viewport-height',
        height > 0 ? `${height}px` : '100dvh',
      )
    }
    apply()
    const off = tg.onEvent('viewportChanged', apply)
    window.addEventListener('resize', apply)
    return () => {
      off()
      window.removeEventListener('resize', apply)
    }
  }, [])
}

function DevModeStrip(): React.ReactElement | null {
  const t = useT()
  const isDev = useIsDevMode()
  if (!isDev) return null
  return (
    <p
      role="status"
      className={cn(
        'bg-attention/20 text-foreground border-attention/40 border-b',
        'px-4 py-1.5 text-center text-[12px] leading-4',
      )}
    >
      {t('miniapp.devMode')}
    </p>
  )
}

function tabsFor(t: ReturnType<typeof useT>, unreadCount: number): TabEntry[] {
  return [
    {
      id: 'today',
      route: { name: 'today' },
      label: t('miniapp.tab.today'),
      shortLabel: t('miniapp.tab.todayShort'),
      icon: CheckSquare,
    },
    {
      id: 'inbox',
      route: { name: 'inbox' },
      label: t('miniapp.tab.inbox'),
      shortLabel: t('miniapp.tab.inboxShort'),
      icon: Bell,
      count: unreadCount,
    },
    {
      id: 'board',
      route: { name: 'board' },
      label: t('miniapp.tab.board'),
      shortLabel: t('miniapp.tab.boardShort'),
      icon: LayoutGrid,
    },
    {
      id: 'events',
      route: { name: 'events' },
      label: t('miniapp.tab.events'),
      shortLabel: t('miniapp.tab.eventsShort'),
      icon: CalendarDays,
    },
    {
      id: 'focus',
      route: { name: 'focus' },
      label: t('miniapp.tab.focus'),
      shortLabel: t('miniapp.tab.focusShort'),
      icon: Timer,
    },
  ]
}

/** Which tab is lit for a screen that is not itself a tab (a card belongs to the board, an event to
 * the events list, my details and the setup checklist to today). */
function activeTabFor(route: Route): string {
  if (route.name === 'card') return 'board'
  if (route.name === 'event') return 'events'
  if (route.name === 'fields' || route.name === 'setup') return 'today'
  return route.name
}

function Screens({ route }: { route: Route }): React.ReactElement {
  switch (route.name) {
    case 'inbox':
      return <InboxScreen />
    case 'board':
      return <BoardScreen />
    case 'events':
      return <EventsScreen />
    case 'focus':
      return <FocusScreen />
    case 'fields':
      return <FieldsScreen />
    case 'setup':
      return <SetupScreen />
    case 'card':
      return <CardScreen cardId={route.cardId} />
    case 'event':
      return <EventScreen eventId={route.eventId} />
    case 'today':
    default:
      return <TodayScreen />
  }
}

function BootState(): React.ReactElement {
  const t = useT()
  const { state, reload } = useSessionState()

  if (state.status === 'loading') {
    return (
      <>
        <ScreenHeader title={t('miniapp.title')} />
        <ScreenBody>
          <ListSkeleton rows={4} />
        </ScreenBody>
      </>
    )
  }
  if (state.status === 'offline') {
    return (
      <>
        <ScreenHeader title={t('miniapp.title')} />
        <ScreenBody>
          <StateView
            kind="offline"
            titleKey="miniapp.offline.title"
            bodyKey="miniapp.offline.body"
            action={{ labelKey: 'miniapp.action.retry', onAction: reload }}
          />
        </ScreenBody>
      </>
    )
  }
  if (state.status === 'unlinked') {
    return (
      <>
        <ScreenHeader title={t('miniapp.title')} />
        <ScreenBody>
          <StateView
            kind="forbidden"
            titleKey="miniapp.unlinked.title"
            bodyKey="miniapp.unlinked.body"
            action={{ labelKey: 'miniapp.action.retry', onAction: reload }}
          />
        </ScreenBody>
      </>
    )
  }
  // `ready` never reaches here (the shell renders the screens instead), but the compiler cannot know
  // that, so the request id is read through an explicit narrowing rather than an assertion.
  const requestId = state.status === 'error' ? state.requestId : null
  return (
    <>
      <ScreenHeader title={t('miniapp.title')} />
      <ScreenBody>
        <StateView
          kind="error"
          titleKey="miniapp.error.title"
          bodyKey="miniapp.error.body"
          {...(requestId ? { requestId } : {})}
          action={{ labelKey: 'miniapp.action.retry', onAction: reload }}
        />
      </ScreenBody>
    </>
  )
}

function Shell(): React.ReactElement {
  const t = useT()
  const route = useRoute()
  const { state } = useSessionState()

  // `?startapp=inbox` (or `card_<id>`) is how the bot's buttons and the notify-to-fill message open a
  // specific screen. Applied once, and only when the sheet opened with no hash of its own, so it can
  // never fight a hash the person navigated to themselves.
  const applied = React.useRef(false)
  React.useEffect(() => {
    if (applied.current || state.status !== 'ready') return
    applied.current = true
    if (window.location.hash !== '' && window.location.hash !== '#/') return
    const target = routeFromStartParam(state.session.startParam ?? tg.startParam)
    if (target) navigate(target)
  }, [state])

  const unread = state.status === 'ready' ? state.session.unreadCount : 0
  const tabs = React.useMemo(() => tabsFor(t, unread), [t, unread])

  return (
    <div
      className="bg-background flex flex-col"
      style={{ height: 'var(--tg-viewport-height)' }}
      data-source={state.status === 'ready' ? state.session.source : 'loading'}
    >
      <DevModeStrip />
      {state.status === 'ready' ? <Screens route={route} /> : <BootState />}
      <TabBar entries={tabs} activeId={activeTabFor(route)} label={t('miniapp.tab.aria')} />
    </div>
  )
}

export function App(): React.ReactElement {
  useTelegramTheme()
  useViewportHeight()
  React.useEffect(() => {
    tg.ready()
  }, [])

  return (
    <MotionProvider>
      <SessionProvider>
        <Shell />
        {/* Bottom-centre inside a sheet: the tab bar owns the bottom edge, so toasts sit above it. */}
        <Toaster position="bottom-center" />
      </SessionProvider>
    </MotionProvider>
  )
}
