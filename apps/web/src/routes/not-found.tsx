// `/404` (design.md §6.5). "Full shell around it (the user is not lost, only the URL is)" -- rendered
// inside `AppShell` like every other primary route, not a bare unstyled page.
import { EmptySearchIllustration, EmptyState } from '@devon/ui'
import { useT } from '@devon/i18n'
import { useForcedState } from '../lib/forced-state.js'
import { navigate } from '../lib/router.js'
import { ForcedStateBlock } from '../shell/forced-state-block.js'

export function NotFoundRoute() {
  const t = useT()
  const forced = useForcedState()

  if (forced) {
    return <ForcedStateBlock kind={forced} />
  }

  return (
    <div className="flex min-h-100 items-center justify-center">
      <EmptyState
        title={t('state.notfound.title')}
        body={t('state.notfound.body')}
        illustration={<EmptySearchIllustration />}
        action={{ label: t('state.denied.action'), onAction: () => navigate('/') }}
      />
    </div>
  )
}
