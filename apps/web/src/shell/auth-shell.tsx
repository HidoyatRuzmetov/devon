// The shell for the signed-out routes -- `/login`, `/register`, `/setup`, `/join` (design.md §6.2:
// "minimal top bar (wordmark + language button only)"), rebuilt to UI-OVERHAUL.md §2 row 3:
// "centred card on an ambient gradient; single column; ... the one ministry-navy touchpoint".
//
// No sidebar, no search trigger, no demo chip, no avatar menu -- none of those make sense before a
// session exists, and design.md §1.1 refuses a nav item whose destination does not render real
// content. The language button and the theme toggle are the only other controls: someone signing in
// from a dark office at 18:00 should not have to sign in first to turn the lights down.
import * as React from 'react'
import { useT, useLocale, setLocale, LOCALES, LOCALE_LABEL } from '@devon/i18n'
import {
  AmbientGradient,
  BlurFade,
  LocaleMenu,
  ThemeToggle,
  Toaster,
  TopBar,
  type ThemeToggleValue,
} from '@devon/ui'
import { useMediaQuery } from '../lib/use-media-query.js'
import { WORDMARK } from '../lib/constants.js'
import { persistLocale } from '../lib/locale-boot.js'
import { setThemePreference, useThemePreference } from '../lib/theme.js'

export function AuthShell({ children }: { children: React.ReactNode }) {
  const t = useT()
  const locale = useLocale()
  const theme = useThemePreference()
  const isDesktop = useMediaQuery('(min-width: 768px)')
  const localeOptions = LOCALES.map((value) => ({ value, autonym: LOCALE_LABEL[value] }))

  function handleLocaleChange(next: string): void {
    if (!(LOCALES as readonly string[]).includes(next)) return
    // Signed-out persistence (design.md §4.3): there is no user record yet, so only the
    // localStorage/`wp_locale` cookie mirror applies -- there is nothing to `PATCH /me` here.
    const chosen = next as (typeof LOCALES)[number]
    setLocale(chosen)
    persistLocale(chosen)
  }

  return (
    <div className="relative flex min-h-full flex-col overflow-hidden bg-background">
      {/* DESIGN.md v2: ambient gradients live on auth and the hub, nowhere else, and stop dead under
          prefers-reduced-motion. */}
      <AmbientGradient variant="auth" />

      <TopBar
        className="border-b-0 bg-transparent backdrop-blur-none"
        title={
          <span data-shell-label className="font-display text-h3 text-foreground">
            {WORDMARK}
          </span>
        }
        trailing={
          <>
            <ThemeToggle
              value={theme as ThemeToggleValue}
              onChange={(next) => setThemePreference(next)}
              label={t('shell.theme.toggle')}
            />
            <LocaleMenu
              triggerLabel={t('shell.locale.aria')}
              chip={t('shell.locale.code')}
              options={localeOptions}
              value={locale}
              onChange={handleLocaleChange}
            />
          </>
        }
      />

      <main id="main" className="flex flex-1 flex-col items-center justify-center px-4 py-10">
        <BlurFade className="w-full max-w-105">
          <div className="mb-6 flex flex-col items-center gap-1 text-center">
            <h2 className="font-display text-h2 text-foreground">{WORDMARK}</h2>
            <p className="max-w-90 text-body text-muted-foreground">{t('auth.tagline')}</p>
          </div>
          {children}
        </BlurFade>
      </main>

      <p data-shell-label className="relative px-4 pb-6 text-center text-caption text-official">
        {t('shell.credit')}
      </p>
      <Toaster position={isDesktop ? 'bottom-right' : 'bottom-center'} />
    </div>
  )
}
