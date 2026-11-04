import { Skeleton } from '@devon/ui'
import { useRoutePath, useSearchParams } from './router.js'
import { useDepartment } from './session.js'
import { ViewSkeleton, type LoadingView } from './view-skeleton.js'

const routes: Record<string, LoadingView> = {
  '/work': 'board',
  '/work/table': 'table',
  '/work/timeline': 'timeline',
  '/work/calendar': 'calendar',
  '/work/mine': 'mine',
  '/work/deleted': 'deletedTasks',
  '/work/card': 'card',
  '/work/templates': 'templates',
  '/people': 'people',
  '/structure': 'structure',
  '/projects': 'projects',
  '/projects/view': 'project',
  '/assistant': 'assistant',
  '/help': 'faq',
  '/account': 'settings',
  '/account/professional': 'resume',
  '/account/personnel': 'personnel',
  '/account/notifications': 'preferences',
  '/account/telegram': 'telegram',
  '/account/department': 'department',
  '/account/ai': 'aiSettings',
  '/account/security': 'security',
  '/account/delete': 'accountDelete',
  '/inbox': 'inbox',
  '/inbox/preferences': 'preferences',
  '/inbox/telegram': 'telegram',
  '/admin': 'overview',
  '/admin/departments': 'departments',
  '/admin/accounts': 'accounts',
  '/admin/analytics': 'analytics',
  '/admin/audit': 'audit',
  '/admin/health': 'health',
  '/admin/settings': 'registration',
  '/departments': 'departments',
  '/departments/new': 'departmentRequest',
  '/departments/requests': 'approvals',
  '/department': 'department',
  '/join': 'join',
  '/login': 'login',
  '/setup': 'setup',
  '/register': 'signup',
}

/** The route chunk, permission check and data request use the same layout, including selected tabs. */
export function loadingViewForRoute(
  path: string,
  search = new URLSearchParams(),
  head = false,
): LoadingView {
  if (path === '/') return head ? 'headHome' : 'memberHome'
  if (path === '/analytics') return search.get('view') === 'progress' ? 'progress' : 'checkin'
  if (path === '/events') return search.get('view') === 'calendar' ? 'eventCalendar' : 'events'
  if (path === '/personal')
    return search.get('tab') === 'tasks'
      ? 'tasks'
      : search.get('tab') === 'pomodoro'
        ? 'pomodoro'
        : 'calendar'
  if (path === '/pages') return search.has('page') ? 'page' : 'pages'
  if (path === '/calendar' || path === '/account/calendar')
    return search.get('tab') === 'push'
      ? 'push'
      : search.get('tab') === 'agenda'
        ? 'agenda'
        : 'feeds'
  return routes[path] ?? 'notFound'
}

function HeaderSkeleton() {
  return (
    <div aria-hidden="true" className="flex min-h-20 items-center justify-between gap-4 pb-4">
      <div className="space-y-3">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-8 w-60" />
        <Skeleton className="h-3 w-80 max-w-full" />
      </div>
      <Skeleton className="h-9 w-28" />
    </div>
  )
}

export function RouteLoading() {
  const path = useRoutePath()
  const search = useSearchParams()
  const { department } = useDepartment()
  const view = loadingViewForRoute(path, search, department?.role === 'head')
  const body = <ViewSkeleton view={view} />
  if (path === '/account' || path.startsWith('/account/'))
    return (
      <div className="space-y-5">
        <HeaderSkeleton />
        <div className="flex flex-col gap-6 lg:flex-row lg:gap-8">
          <div aria-hidden="true" className="hidden w-56 shrink-0 space-y-5 lg:block">
            {[3, 5, 2].map((count, group) => (
              <div key={group} className="space-y-2">
                <Skeleton className="mb-3 h-3 w-24" />
                {Array.from({ length: count }, (_, index) => (
                  <Skeleton key={index} className="h-11 w-full" />
                ))}
              </div>
            ))}
          </div>
          <div className="min-w-0 flex-1">{body}</div>
        </div>
      </div>
    )
  if (['/login', '/register', '/setup', '/join', '/assistant', '/analytics'].includes(path))
    return body
  return (
    <div className="space-y-3">
      <HeaderSkeleton />
      {path.startsWith('/work') ? (
        <div
          aria-hidden="true"
          className="flex flex-wrap justify-between gap-3 border-b border-border pb-4"
        >
          <Skeleton className="h-9 w-80" />
          <div className="flex gap-2">
            <Skeleton className="h-9 w-40" />
            <Skeleton className="size-9" />
            <Skeleton className="h-9 w-24" />
          </div>
        </div>
      ) : null}
      {body}
    </div>
  )
}

/** Session loading must not mount private widgets just to draw their chrome. */
export function SessionLoading() {
  return (
    <div className="flex min-h-dvh bg-background">
      <aside
        aria-hidden="true"
        className="hidden w-(--width-sidebar) shrink-0 space-y-5 border-r border-border p-5 lg:block"
      >
        <Skeleton className="mb-10 h-8 w-32" />
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </aside>
      <div className="min-w-0 flex-1">
        <div
          aria-hidden="true"
          className="flex h-14 items-center justify-between border-b border-border px-6"
        >
          <Skeleton className="h-8 w-40" />
          <Skeleton className="size-8 rounded-full" />
        </div>
        <main className="p-4 lg:p-6">
          <RouteLoading />
        </main>
      </div>
    </div>
  )
}
