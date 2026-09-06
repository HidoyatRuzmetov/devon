// The full shell for `/`, `/admin` and `/404` (design.md §3, spec.md §3-§5): sidebar + top bar +
// main region + toast layer + offline banner, assembled from `@devon/ui`'s shell parts. `/login` and
// `/setup` use the lighter `AuthShell` instead (design.md §6.2/§6.3: "minimal top bar (wordmark +
// language button only)").
import * as React from 'react'
import { Menu, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { useT, useLocale, LOCALES, LOCALE_LABEL, type Locale } from '@devon/i18n'
import {
  Avatar,
  AvatarMenu,
  DemoChip,
  IconButton,
  LocaleMenu,
  OfflineBanner,
  SearchTrigger,
  Sheet,
  SheetContent,
  ShortcutOverlay,
  Sidebar,
  StateView,
  TopBar,
  Toaster,
  initialsFromName,
  resolveNavEntries,
  toast,
} from '@devon/ui'
import {
  useInstanceQuery,
  useLocaleMutation,
  useLogoutMutation,
  useMeQuery,
} from '../lib/session.js'
import { useOnline } from '../lib/use-online.js'
import { useMediaQuery } from '../lib/use-media-query.js'
import { useThemePreference, setThemePreference, type ThemePreference } from '../lib/theme.js'
import { navigate, RouterLink, useRoutePath } from '../lib/router.js'
import { WORDMARK, SIDEBAR_COLLAPSED_STORAGE_KEY } from '../lib/constants.js'
import { NAV_ENTRIES } from './nav.js'
import { CommandPaletteController } from './command-palette-controller.js'
import { PaletteProvider } from './palette-context.js'
import { useShellShortcuts } from './use-shell-shortcuts.js'

const THEME_ORDER: readonly ThemePreference[] = ['light', 'dark', 'system']

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const t = useT()
  const locale = useLocale()
  const route = useRoutePath()
  const online = useOnline()
  const isDesktop = useMediaQuery('(min-width: 768px)')
  const theme = useThemePreference()

  const meQuery = useMeQuery()
  const instanceQuery = useInstanceQuery()
  const localeMutation = useLocaleMutation()
  const logoutMutation = useLogoutMutation()

  const [drawerOpen, setDrawerOpen] = React.useState(false)
  const [collapsed, setCollapsed] = React.useState(readCollapsed)
  const [paletteOpen, setPaletteOpen] = React.useState(false)
  const [shortcutsOpen, setShortcutsOpen] = React.useState(false)

  useShellShortcuts({
    onOpenPalette: () => setPaletteOpen(true),
    onOpenShortcuts: () => setShortcutsOpen(true),
  })

  const user = meQuery.data?.user ?? null
  const role = user?.role ?? 'member'
  const isDemo = instanceQuery.data?.isDemo ?? false

  function toggleCollapsed(): void {
    setCollapsed((prev) => {
      const next = !prev
      try {
        window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, next ? '1' : '0')
      } catch {
        // Storage disabled -- the toggle still works for this session.
      }
      return next
    })
  }

  function handleLocaleChange(next: string): void {
    if (!(LOCALES as readonly string[]).includes(next)) return
    localeMutation.mutate(next as Locale, {
      onError: () => toast(t('toast.saveError')),
    })
  }

  function handleSignOut(): void {
    logoutMutation.mutate(undefined, {
      onSettled: () => navigate('/login?signedOut=1'),
    })
  }

  const localeOptions = LOCALES.map((value) => ({ value, autonym: LOCALE_LABEL[value] }))

  const sidebarNode = (
    <Sidebar
      entries={resolveNavEntries(NAV_ENTRIES, { role, isDemo })}
      ctx={{ role, isDemo }}
      activeRoute={route}
      linkAs={RouterLink}
      wordmark={WORDMARK}
      creditText={t('shell.credit')}
      collapsed={isDesktop ? collapsed : false}
    />
  )

  const trailing = (
    <>
      {isDemo ? (
        <DemoChip
          // Full label at >=768; the short one below that (spec.md §3.5: "using the short label
          // ('Demo'), never a truncated long label") -- the long label wrapped to two lines inside
          // the chip's fixed 24px height at 390px, visibly overlapping the rest of the top bar.
          label={isDesktop ? t('shell.demo.chip.label') : t('shell.demo.chip.short')}
          popoverText={t('shell.demo.popover')}
        />
      ) : null}
      <LocaleMenu
        triggerLabel={t('shell.locale.aria')}
        chip={t('shell.locale.code')}
        options={localeOptions}
        value={locale}
        onChange={handleLocaleChange}
      />
      {user ? (
        <AvatarMenu
          avatarLabel={`${user.givenName} ${user.familyName}`}
          avatar={
            <Avatar
              alt={`${user.givenName} ${user.familyName}`}
              initials={initialsFromName(user.givenName, user.familyName)}
              hueSeed={user.id}
              size="sm"
            />
          }
          themeLabel={t('shell.theme.label')}
          themeOptions={THEME_ORDER.map((value) => ({
            value,
            label: t(
              value === 'light'
                ? 'shell.theme.light'
                : value === 'dark'
                  ? 'shell.theme.dark'
                  : 'shell.theme.system',
            ),
          }))}
          themeValue={theme}
          onThemeChange={(value) => setThemePreference(value as ThemePreference)}
          shortcutsLabel={t('shell.shortcuts.title')}
          onOpenShortcuts={() => setShortcutsOpen(true)}
          signOutLabel={t('shell.account.signout')}
          onSignOut={handleSignOut}
        />
      ) : null}
    </>
  )

  return (
    <div className="flex min-h-full flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-sm focus:bg-card focus:px-4 focus:py-2 focus:text-body focus:shadow-2"
      >
        {t('shell.skip')}
      </a>

      <TopBar
        leading={
          isDesktop ? (
            <IconButton
              aria-label={t(collapsed ? 'shell.sidebar.expand' : 'shell.sidebar.toggle')}
              onClick={toggleCollapsed}
            >
              {collapsed ? (
                <PanelLeftOpen aria-hidden="true" />
              ) : (
                <PanelLeftClose aria-hidden="true" />
              )}
            </IconButton>
          ) : (
            <IconButton
              aria-label={t('shell.menu.open')}
              size="touch"
              onClick={() => setDrawerOpen(true)}
            >
              <Menu aria-hidden="true" />
            </IconButton>
          )
        }
        title={
          isDesktop ? (
            <span data-shell-label className="text-lead text-foreground">
              {WORDMARK}
            </span>
          ) : (
            // spec.md §3.5: "wordmark (mark only, no wordtext below 420 px)" -- the five 44px top-bar
            // targets (☰ · wordmark · search · language · avatar) only fit a 358px content width at
            // their full size each; the full "WorkPortal" wordtext at any size left too little room
            // for the rest of the row and forced other targets to wrap/overlap (found end-to-end at
            // 390px, 2026-09). A single-letter mark is the smallest faithful reading of "mark only"
            // without inventing a graphical logo asset nothing in this repo defines yet.
            <span
              data-shell-label
              aria-hidden="true"
              className="flex size-8 shrink-0 items-center justify-center rounded-sm bg-sidebar-accent font-display text-body text-sidebar-foreground"
            >
              {WORDMARK.charAt(0)}
            </span>
          )
        }
        search={
          <SearchTrigger
            label={t('shell.search.trigger')}
            compact={!isDesktop}
            onClick={() => setPaletteOpen(true)}
          />
        }
        trailing={trailing}
      />

      {!online ? (
        <OfflineBanner hasCachedContent={Boolean(user)} onRetry={() => window.location.reload()} />
      ) : null}

      <div className="flex flex-1">
        {isDesktop ? (
          <aside className="hidden shrink-0 md:block">{sidebarNode}</aside>
        ) : (
          <Sheet direction="left" open={drawerOpen} onOpenChange={setDrawerOpen}>
            <SheetContent title={t('shell.menu.open')} side="left" className="p-0">
              {sidebarNode}
            </SheetContent>
          </Sheet>
        )}

        <main id="main" className="min-w-0 flex-1 px-4 py-8 sm:px-6 md:px-8">
          <PaletteProvider onOpen={() => setPaletteOpen(true)}>
            {meQuery.isError ? (
              <StateView
                kind="error"
                titleKey="state.error.title"
                bodyKey="state.error.body"
                action={{ labelKey: 'state.error.action', onAction: () => meQuery.refetch() }}
              />
            ) : (
              children
            )}
          </PaletteProvider>
        </main>
      </div>

      <CommandPaletteController
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        isSuperAdmin={role === 'super_admin'}
        onChangeLocale={(next) => handleLocaleChange(next)}
        onOpenShortcuts={() => setShortcutsOpen(true)}
        onSignOut={handleSignOut}
        variant={isDesktop ? 'dialog' : 'sheet'}
      />

      <ShortcutOverlay
        title={t('shell.shortcuts.title')}
        open={shortcutsOpen}
        onOpenChange={setShortcutsOpen}
        shortcuts={[
          { keys: ['Ctrl/⌘', 'K'], description: t('shell.search.aria') },
          { keys: ['/'], description: t('shell.search.aria') },
          { keys: ['?'], description: t('shell.shortcuts.title') },
          { keys: ['g', 'h'], description: t('cmd.item.home') },
          { keys: ['Esc'], description: t('cmd.hint') },
        ]}
      />

      <Toaster position={isDesktop ? 'bottom-right' : 'bottom-center'} />
    </div>
  )
}
