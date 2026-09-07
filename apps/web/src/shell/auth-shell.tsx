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
  Reveal,
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
    // No `bg-background` here (unlike most shells): `AmbientGradient`'s own `-z-10` escapes to the
    // nearest ancestor stacking context, since `position: relative` alone (no `z-index`) does not
    // create one -- an opaque background painted on THIS div sits, in stacking terms, above that
    // escaped layer and hid the wash completely. `body` already paints `--color-background`
    // (styles.css), so this div can stay transparent and let it show through underneath the gradient.
    <div className="relative flex min-h-full flex-col overflow-hidden">
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
          // round2 SEV2 "the locale/theme controls are static": a small delayed reveal so they
          // settle in a beat after the wordmark rather than being simply present on first paint.
          <Reveal delay={0.08} className="flex items-center gap-2">
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
          </Reveal>
        }
      />

      <main id="main" className="flex flex-1 flex-col items-center justify-center px-4 py-10">
        {/* The card's own width is the screen's business (a sign-in form and a registration form are
            not the same size); this shell only centres it and puts the same greeting above it. */}
        <BlurFade className="flex w-full flex-col items-center">
          <div className="mb-6 flex max-w-115 flex-col items-center gap-1 text-center">
            <h2 className="font-display text-h2 text-foreground">{WORDMARK}</h2>
            <p className="text-body text-muted-foreground">{t('auth.tagline')}</p>
          </div>
          <div className="w-full">{children}</div>
        </BlurFade>
      </main>

      <p
        data-shell-label
        className="relative px-4 pb-6 text-center text-caption text-official-foreground"
      >
        {t('shell.credit')}
      </p>
      <Toaster position={isDesktop ? 'bottom-right' : 'bottom-center'} />
    </div>
  )
}
