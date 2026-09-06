// `/404` (design.md §6.5). "Full shell around it (the user is not lost, only the URL is)" -- rendered
// inside `AppShell` like every other primary route, not a bare unstyled page.
import { FileQuestion } from 'lucide-react'
import { useT } from '@devon/i18n'
import { Button } from '@devon/ui'
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
    <div className="mx-auto flex max-w-140 flex-col items-center gap-4 rounded-md border border-border bg-card p-10 text-center">
      <FileQuestion className="size-10 text-muted-foreground" aria-hidden="true" />
      <h1 className="text-h3 text-foreground">{t('state.notfound.title')}</h1>
      <p className="max-w-90 text-body text-muted-foreground">{t('state.notfound.body')}</p>
      <Button data-primary onClick={() => navigate('/')}>
        {t('state.denied.action')}
      </Button>
    </div>
  )
}
