// `/` -- Home (design.md §6.1, AC-8's zero-training test). Nothing in EPIC-000 is actionable yet, so
// the honest content is always one of the three empty variants once the session/instance queries
// resolve (design.md: "nothing yet, and here is how you will find it when there is").
import * as React from 'react'
import { useT, useLocale } from '@devon/i18n'
import { StateView } from '@devon/ui'
import { useForcedState } from '../lib/forced-state.js'
import { useInstanceQuery, useMeQuery } from '../lib/session.js'
import { useOnline } from '../lib/use-online.js'
import { navigate } from '../lib/router.js'
import { formatHomeDateLine, greetingKey, greetingName, tashkentHour } from '../lib/greeting.js'
import { ForcedStateBlock } from '../shell/forced-state-block.js'
import { useOpenPalette } from '../shell/palette-context.js'

export function HomeRoute() {
  const t = useT()
  const locale = useLocale()
  const forced = useForcedState()
  const online = useOnline()
  const meQuery = useMeQuery()
  const instanceQuery = useInstanceQuery()
  const openPalette = useOpenPalette()

  const settled = !meQuery.isPending && !instanceQuery.isPending
  const user = meQuery.data?.user ?? null

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
        action={{ labelKey: 'state.error.action', onAction: () => window.location.reload() }}
      />
    )
  }

  if (!user) return null // redirecting to /login (effect above)

  const isDemo = instanceQuery.data?.isDemo ?? false
  const now = new Date()

  const empty = isDemo
    ? {
        titleKey: 'home.empty.demo.title',
        bodyKey: undefined,
        actionKey: 'home.empty.action',
        onAction: openPalette,
      }
    : user.role === 'super_admin'
      ? {
          titleKey: 'home.empty.admin.title',
          bodyKey: 'home.empty.admin.body',
          actionKey: 'home.empty.admin.action',
          onAction: () => navigate('/admin'),
        }
      : {
          titleKey: 'home.empty.member.title',
          bodyKey: 'home.empty.member.body',
          actionKey: 'home.empty.action',
          onAction: openPalette,
        }

  return (
    <div className="mx-auto flex max-w-320 flex-col items-center gap-10 text-center">
      <div className="flex flex-col items-center gap-2">
        <p className="text-eyebrow uppercase tracking-(--text-eyebrow--letter-spacing) text-muted-foreground">
          {t('home.eyebrow')}
        </p>
        <h1 className="font-display text-hero text-foreground">
          {t(greetingKey(tashkentHour(now)), { name: greetingName(user) })}
        </h1>
        <p className="text-lead text-muted-foreground">{formatHomeDateLine(now, locale)}</p>
      </div>
      <StateView
        kind="empty"
        titleKey={empty.titleKey}
        bodyKey={empty.bodyKey}
        action={{ labelKey: empty.actionKey, onAction: empty.onAction }}
        className="w-full max-w-140"
      />
    </div>
  )
}
