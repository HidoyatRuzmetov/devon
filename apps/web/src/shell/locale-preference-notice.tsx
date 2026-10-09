import { LOCALE_LABEL, useT } from '@devon/i18n'
import { Button } from '@devon/ui'
import type { LocalePreferenceRecovery } from '../lib/locale-preference-recovery.js'

export function LocalePreferenceNotice({
  recovery,
  onRetry,
}: {
  recovery: LocalePreferenceRecovery | null
  onRetry: () => void
}) {
  const t = useT()
  if (!recovery?.showNotice) return null
  return (
    <div
      role="alert"
      className="flex min-w-0 flex-col items-stretch gap-3 rounded-md border border-warning bg-card p-4 text-foreground sm:flex-row sm:items-center"
    >
      <p className="min-w-0 flex-1">
        {t('locale.preferenceFailed', { locale: LOCALE_LABEL[recovery.locale] })}
      </p>
      <Button
        variant="secondary"
        className="h-auto min-h-10 max-w-full self-start whitespace-normal sm:shrink-0"
        loading={recovery.status === 'pending'}
        disabled={recovery.status === 'pending'}
        onClick={onRetry}
      >
        {t('locale.retrySave')}
      </Button>
    </div>
  )
}
