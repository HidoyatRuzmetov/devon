// The minimal shell for `/login` and `/setup` (design.md §6.2: "minimal top bar (wordmark + language
// button only)"). No sidebar, no search trigger, no demo chip, no avatar menu -- none of those make
// sense before a session exists, and design.md §1.1 refuses a nav item whose destination does not
// render real content. The language button still satisfies AC-4's "from every shell screen,
// including /login and /setup" -- it is simply the only other thing in this top bar.
import * as React from 'react'
import { useT, useLocale, setLocale, LOCALES, LOCALE_LABEL } from '@devon/i18n'
import { LocaleMenu, Toaster, TopBar } from '@devon/ui'
import { useMediaQuery } from '../lib/use-media-query.js'
import { WORDMARK } from '../lib/constants.js'
import { persistLocale } from '../lib/locale-boot.js'

export function AuthShell({ children }: { children: React.ReactNode }) {
  const t = useT()
  const locale = useLocale()
  const isDesktop = useMediaQuery('(min-width: 768px)')
  const localeOptions = LOCALES.map((value) => ({ value, autonym: LOCALE_LABEL[value] }))

  function handleLocaleChange(next: string): void {
    if (!(LOCALES as readonly string[]).includes(next)) return
    // Signed-out persistence (design.md §4.3): there is no user record yet, so only the
    // localStorage/`wp_locale` cookie mirror applies -- there is nothing to `PATCH /me` here.
    const locale = next as (typeof LOCALES)[number]
    setLocale(locale)
    persistLocale(locale)
  }

  return (
    <div className="flex min-h-full flex-col bg-background">
      <TopBar
        title={
          <span data-shell-label className="font-display text-h3 text-foreground">
            {WORDMARK}
          </span>
        }
        trailing={
          <LocaleMenu
            triggerLabel={t('shell.locale.aria')}
            chip={t('shell.locale.code')}
            options={localeOptions}
            value={locale}
            onChange={handleLocaleChange}
          />
        }
      />
      <main id="main" className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-100">{children}</div>
      </main>
      <p data-shell-label className="px-4 pb-6 text-center text-caption text-official">
        {t('shell.credit')}
      </p>
      <Toaster position={isDesktop ? 'bottom-right' : 'bottom-center'} />
    </div>
  )
}
