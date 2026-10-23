import * as React from 'react'
import { useT, useLocale } from '@devon/i18n'
import { Button, Reveal, StateView } from '@devon/ui'
import { useForcedState } from '../../lib/forced-state.js'
import { useIsHead } from '../../lib/can.js'
import { DepartmentOverview } from './department-overview.js'
import { MemberOverview } from './member-overview.js'
import { useDepartment, useInstanceQuery, useMeQuery } from '../../lib/session.js'
import { useOnline } from '../../lib/use-online.js'
import { RouterLink, navigate, replaceSearchParam, useSearchParams } from '../../lib/router.js'
import { formatHomeDateLine, greetingKey, greetingName, tashkentHour } from '../../lib/greeting.js'
import { InboxPanel } from '../inbox/inbox-screen.js'
import { useViewportBoundedHeight } from '../../lib/use-viewport-bounded-height.js'
import { HelpCircle } from 'lucide-react'
import { ForcedStateBlock } from '../../shell/forced-state-block.js'

const HomeCardPeekDialog = React.lazy(() =>
  import('../work/components/card-peek-dialog.js').then((module) => ({
    default: module.CardPeekDialog,
  })),
)
export default function HomeScreen() {
  const t = useT()
  const locale = useLocale()
  const forced = useForcedState()
  const online = useOnline()
  const meQuery = useMeQuery()
  const instanceQuery = useInstanceQuery()
  const { departmentId } = useDepartment()
  const isHead = useIsHead()
  const search = useSearchParams()
  const cardOpen = Boolean(search.get('card'))
  const [cardPeekVisited, setCardPeekVisited] = React.useState(cardOpen)
  React.useEffect(() => {
    if (cardOpen) setCardPeekVisited(true)
  }, [cardOpen])

  const settled = !meQuery.isPending && !instanceQuery.isPending
  const user = meQuery.data?.user ?? null
  const overviewScope =
    user && departmentId
      ? `${departmentId}:${user.id}:${meQuery.data?.actingForUserId ?? ''}`
      : null
  const previousOverviewScope = React.useRef<string | null>(null)
  const legacyConversation = search.get('conversation')
  React.useEffect(() => {
    if (!overviewScope || !settled) return
    const changed = previousOverviewScope.current && previousOverviewScope.current !== overviewScope
    previousOverviewScope.current = overviewScope
    if (changed) {
      replaceSearchParam('conversation', null)
      return
    }
    if (legacyConversation)
      navigate(`/assistant?conversation=${encodeURIComponent(legacyConversation)}`, {
        replace: true,
      })
  }, [overviewScope, settled, legacyConversation])

  React.useEffect(() => {
    if (forced) return
    if (settled && meQuery.data === null) navigate('/login')
  }, [forced, settled, meQuery.data])

  if (forced) {
    return <ForcedStateBlock kind={forced} />
  }

  if (!settled) {
    return <StateView kind="loading" titleKey="state.loading" />
  }

  if (!online && !user) {
    return (
      <StateView
        kind="offline"
        titleKey="state.offline.banner"
        bodyKey="state.offline.empty"
        action={{
          labelKey: 'state.error.action',
          onAction: () => window.location.reload(),
        }}
      />
    )
  }

  if (!user) return null // redirecting to /login (effect above)

  const now = new Date()

  const header = (
    <div className="flex shrink-0 items-start justify-between gap-3">
      <Reveal className="min-w-0 flex flex-col gap-1">
        <h1
          tabIndex={-1}
          className="min-w-0 truncate font-display text-h3 text-foreground lg:text-h2"
        >
          {t(greetingKey(tashkentHour(now)), { name: greetingName(user) })}
        </h1>
        <p className="hidden text-caption text-muted-foreground lg:block">
          {formatHomeDateLine(now, locale)}
        </p>
      </Reveal>
      <RouterLink
        href="/help?from=overview"
        className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-md border border-transparent px-2.5 text-small text-muted-foreground transition-colors hover:border-border hover:bg-card/70 hover:text-primary focus-visible:ring-2 focus-visible:ring-ring"
      >
        <HelpCircle className="size-4" aria-hidden="true" />
        <span className="hidden sm:inline">{t('help.title')}</span>
        <span className="sr-only sm:hidden">{t('help.title')}</span>
      </RouterLink>
    </div>
  )

  // No active department yet (a brand-new account, or a super admin with none) -- the original
  // zero-training empty states (design.md: "nothing yet, and here is how you will find it") still
  // apply exactly as EPIC-000 shipped them; this module's dashboard has nothing to query without a
  // department context.
  if (!departmentId) {
    const empty =
      user.role === 'super_admin'
        ? {
            titleKey: 'home.empty.admin.title',
            bodyKey: 'home.empty.admin.body',
            actionKey: 'home.empty.admin.action',
            onAction: () => navigate('/admin'),
          }
        : {
            titleKey: 'departments.detail.noDepartment.title',
            bodyKey: 'departments.detail.noDepartment.body',
            actionKey: 'departments.detail.noDepartment.action',
            onAction: () => navigate('/departments'),
          }

    return <PersonalHome key={user.id} header={header} entry={empty} />
  }

  return (
    <div className="relative flex flex-col gap-3">
      {isHead ? (
        <DepartmentOverview key={overviewScope} header={header} />
      ) : (
        <MemberOverview key={overviewScope} header={header} />
      )}
      {cardOpen || cardPeekVisited ? (
        <React.Suspense fallback={null}>
          <HomeCardPeekDialog key={overviewScope} />
        </React.Suspense>
      ) : null}
    </div>
  )
}

/** Notifications are personal, so they remain available before joining a department too. */
function PersonalHome({
  header,
  entry,
}: {
  header: React.ReactNode
  entry: { titleKey: string; bodyKey: string; actionKey: string; onAction: () => void }
}) {
  const t = useT()
  const [viewportRef, height] = useViewportBoundedHeight<HTMLDivElement>(0, true)
  return (
    <div
      ref={viewportRef}
      className="flex min-h-0 flex-col gap-3"
      style={{ height: height ?? 'calc(100dvh - 120px)' }}
    >
      {header}
      <section className="flex shrink-0 flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-4">
        <div>
          <h2 className="font-display text-h3">{t(entry.titleKey)}</h2>
          <p className="mt-1 text-small text-muted-foreground">{t(entry.bodyKey)}</p>
        </div>
        <Button onClick={entry.onAction}>{t(entry.actionKey)}</Button>
      </section>
      <div className="min-h-0 flex-1">
        <InboxPanel />
      </div>
    </div>
  )
}
