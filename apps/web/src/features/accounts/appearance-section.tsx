import { LOCALES, LOCALE_LABEL, useLocale, useT } from '@devon/i18n'
import { SectionCard, toast } from '@devon/ui'
import { useLocaleMutation } from '../../lib/session.js'
import { setThemePreference, useThemePreference, type ThemePreference } from '../../lib/theme.js'

const SELECT_CLASS =
  'h-10 rounded-sm border border-border bg-card px-2 text-body text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

export function AppearanceSection() {
  const t = useT()
  const locale = useLocale()
  const localeMutation = useLocaleMutation()
  const theme = useThemePreference()
  return (
    <SectionCard id="section-appearance" title={t('accounts.settings.appearance')}>
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,14rem),1fr))]">
        <label className="flex flex-col gap-1.5 text-small">
          {t('accounts.register.locale')}
          <select
            className={SELECT_CLASS}
            value={locale}
            disabled={localeMutation.isPending}
            onChange={(event) => {
              const next = LOCALES.find((value) => value === event.target.value)
              if (next) localeMutation.mutate(next, { onError: () => toast(t('toast.saveError')) })
            }}
          >
            {LOCALES.map((value) => (
              <option key={value} value={value}>
                {LOCALE_LABEL[value]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-small">
          {t('accounts.settings.theme')}
          <select
            className={SELECT_CLASS}
            value={theme}
            onChange={(event) => {
              const next = event.target.value as ThemePreference
              if (['light', 'dark', 'system'].includes(next)) setThemePreference(next)
            }}
          >
            {(['light', 'dark', 'system'] as const).map((value) => (
              <option key={value} value={value}>
                {t(`shell.theme.${value}`)}
              </option>
            ))}
          </select>
        </label>
      </div>
    </SectionCard>
  )
}
