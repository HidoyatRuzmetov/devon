import { useSyncExternalStore } from 'react'
import {
  getLocaleLoadFailure,
  subscribeLocaleLoadFailure,
  LOCALE_LABEL,
  useT,
  type Locale,
} from '@devon/i18n'
import { Button } from '@devon/ui'

/** A refused language chunk keeps the current screen usable. Reload fetches a new document/module
 * map too: browsers may retain a failed dynamic import for the life of the current document. */
export function LocaleLoadNotice({ bootLocale }: { bootLocale?: Locale }) {
  const failed = useSyncExternalStore(subscribeLocaleLoadFailure, getLocaleLoadFailure)
  const locale = bootLocale ?? failed
  const t = useT()
  if (!locale) return null
  return (
    <div
      role="alert"
      className="flex min-w-0 flex-col items-stretch gap-3 rounded-md border border-warning bg-card p-4 text-foreground sm:flex-row sm:items-center"
    >
      <p className="min-w-0 flex-1">
        {t(bootLocale ? 'locale.bootLoadingFailed' : 'locale.loadingFailed', {
          locale: LOCALE_LABEL[locale],
        })}
      </p>
      <Button
        variant="secondary"
        className="h-auto min-h-10 max-w-full self-start whitespace-normal sm:shrink-0"
        onClick={() => window.location.reload()}
      >
        {t('locale.reload')}
      </Button>
    </div>
  )
}
