import * as React from 'react'
import { useT, useLocale } from '@devon/i18n'
import { HubAmbientWash, Reveal, StateView, WelcomeIllustration } from '@devon/ui'
import { useForcedState } from '../../lib/forced-state.js'
import { useIsHead } from '../../lib/can.js'
import { DepartmentOverview } from './department-overview.js'
import { MemberOverview } from './member-overview.js'
import { useDepartment, useInstanceQuery, useMeQuery } from '../../lib/session.js'
import { useOnline } from '../../lib/use-online.js'
import { navigate, replaceSearchParam, useSearchParams } from '../../lib/router.js'
import { formatHomeDateLine, greetingKey, greetingName, tashkentHour } from '../../lib/greeting.js'
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

  const settled = !meQuery.isPending && !instanceQuery.isPending
  const user = meQuery.data?.user ?? null
  const overviewScope =
    user && departmentId
      ? `${departmentId}:${user.id}:${meQuery.data?.actingForUserId ?? ''}`
      : null
  const previousOverviewScope = React.useRef<string | null>(null)
  const overviewScopeChanged = Boolean(
    previousOverviewScope.current &&
    overviewScope &&
    previousOverviewScope.current !== overviewScope,
  )

  React.useEffect(() => {
    if (!overviewScope) return
    if (previousOverviewScope.current && previousOverviewScope.current !== overviewScope)
      replaceSearchParam('conversation', null)
    previousOverviewScope.current = overviewScope
  }, [overviewScope])

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
    <Reveal className="flex flex-col gap-1">
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

    return (
      <div className="relative flex flex-col gap-8">
        <HubAmbientWash />
        {header}
        <StateView
          kind="empty"
          titleKey={empty.titleKey}
          bodyKey={empty.bodyKey}
          illustration={<WelcomeIllustration />}
          action={{ labelKey: empty.actionKey, onAction: empty.onAction }}
          className="w-full max-w-140"
        />
      </div>
    )
  }

  return (
    <div className="relative flex flex-col gap-3">
      <HubAmbientWash className="h-full" />
      {isHead ? (
        <DepartmentOverview
          key={overviewScope}
          header={header}
          allowConversationRoute={!overviewScopeChanged}
        />
      ) : (
        <MemberOverview
          key={overviewScope}
          header={header}
          allowConversationRoute={!overviewScopeChanged}
        />
      )}
      {search.get('card') ? (
        <React.Suspense fallback={null}>
          <HomeCardPeekDialog />
        </React.Suspense>
      ) : null}
    </div>
  )
}
