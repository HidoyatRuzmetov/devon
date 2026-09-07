// The full shell for every signed-in route (design.md §3, spec.md §3-§5), rebuilt to
// UI-OVERHAUL.md §2 row 1: a Linear/Huly-style full-height sidebar with grouped entries, counts, a
// department switcher on top and a user block at the foot; a top bar over the content column
// carrying quick-add, search/⌘K, the inbox bell, the theme toggle, the locale switcher and the
// avatar menu; a bottom tab bar instead of the sidebar at 390 px. `/login`, `/register`, `/setup`
// and `/join` use the lighter `AuthShell` instead.
import * as React from 'react'
import { Menu, PanelLeftClose, PanelLeftOpen, Settings, UserCog } from 'lucide-react'
import { useT, useLocale, LOCALES, LOCALE_LABEL, type Locale } from '@devon/i18n'
import { avatarUrl } from '../lib/avatar.js'
import {
  Avatar,
  AvatarMenu,
  BottomTabBar,
  DemoChip,
  DepartmentSwitcher,
  IconButton,
  InboxBell,
  LocaleMenu,
  OfflineBanner,
  PageContainer,
  PageTransition,
  QuickAdd,
  SearchTrigger,
  Sheet,
  SheetContent,
  ShortcutOverlay,
  Sidebar,
  SidebarUserBlock,
  StateView,
  ThemeToggle,
  TopBar,
  Toaster,
  initialsFromName,
  resolveNavEntries,
  toast,
  type ThemeToggleValue,
} from '@devon/ui'
import {
  useDepartment,
  useInstanceQuery,
  useLocaleMutation,
  useLogoutMutation,
  useMeQuery,
} from '../lib/session.js'
import { useOnline } from '../lib/use-online.js'
import { useIsViewingAs, ViewAsBanner } from '../features/admin/view-as-banner.js'
import { useMediaQuery } from '../lib/use-media-query.js'
import { useThemePreference, setThemePreference, type ThemePreference } from '../lib/theme.js'
import { navigate, RouterLink, useRoutePath } from '../lib/router.js'
import { WORDMARK, SIDEBAR_COLLAPSED_STORAGE_KEY } from '../lib/constants.js'
import { getFeatureQuickAddEntries, useFeatureSidebarCounts } from '../features/registry.js'
import { MOBILE_TAB_SHORT_LABEL_KEYS, NAV_ENTRIES, NAV_GROUPS, mobileTabEntries } from './nav.js'
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
  const { department, memberships, setDepartmentId } = useDepartment()
  const counts = useFeatureSidebarCounts()

  const [drawerOpen, setDrawerOpen] = React.useState(false)
  const [collapsed, setCollapsed] = React.useState(readCollapsed)
  const [paletteOpen, setPaletteOpen] = React.useState(false)
  const [shortcutsOpen, setShortcutsOpen] = React.useState(false)

  useShellShortcuts({
    onOpenPalette: () => setPaletteOpen(true),
    onOpenShortcuts: () => setShortcutsOpen(true),
    onToggleSidebar: () => toggleCollapsed(),
  })

  // The drawer is a 390px affordance; leaving it mounted-open across a resize would trap focus in a
  // sheet nobody can see.
  React.useEffect(() => {
    if (isDesktop) setDrawerOpen(false)
  }, [isDesktop])

  // Navigating from inside the drawer closes it -- the sheet is the menu, not a second window.
  React.useEffect(() => {
    setDrawerOpen(false)
  }, [route])

  const user = meQuery.data?.user ?? null
  const role = user?.role ?? 'member'
  const isDemo = instanceQuery.data?.isDemo ?? false
  // round2 SEV2: a super_admin with no department membership still saw all nine department-scoped
  // sidebar entries -- `nav.ts`'s `requireDepartmentFor` is the gate, this is where the fact comes
  // from (the same `memberships` the department switcher itself reads).
  const navCtx = { role, isDemo, hasDepartment: memberships.length > 0 }
  const visibleEntries = resolveNavEntries(NAV_ENTRIES, navCtx)
  const inboxCount = counts['inbox'] ?? 0

  // TECH-SPEC §11 "pause switch": every page renders the maintenance message except the super
  // admin's own console (`/admin*`) and login/setup, which never reach `AppShell` at all
  // (`app.tsx`'s `AuthShell` branch) -- so gating here, the one shell every other route passes
  // through, is what "everywhere except super admin login/console" actually means client-side. The
  // server enforces the same exemption independently (`modules/admin/availability-gate.ts`); this is
  // the UX half, never the security boundary.
  const maintenance = instanceQuery.data?.maintenance
  const maintenanceBlocksThisRoute =
    Boolean(maintenance?.enabled) && role !== 'super_admin' && !route.startsWith('/admin')
  const maintenanceMessage = maintenance?.message ?? null

  // Package `demo-super-admin`, live-verified: starting view-as (`features/admin/departments-
  // screen.tsx`) navigates to `/` -- the department's own screens are the whole point of "view as" --
  // but the only exit control lived inside `AdminScreen`'s chrome (`/admin/*` only), so a super admin
  // who started view-as and landed on Home had no visible sign they were in view-as mode and no
  // reachable way back except typing `/admin` from memory. Same shape of bug, same fix, as the
  // maintenance notice below (rendered by the one shell every non-admin route passes through);
  // `/admin/*` keeps rendering its own copy (`AdminScreen`) so the two never double up on one page.
  const isViewingAs = useIsViewingAs()
  const showViewAsBanner = isViewingAs && !route.startsWith('/admin')

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
  const themeOptions = THEME_ORDER.map((value) => ({
    value,
    label: t(
      value === 'light'
        ? 'shell.theme.light'
        : value === 'dark'
          ? 'shell.theme.dark'
          : 'shell.theme.system',
    ),
  }))

  const userAvatar = user ? (
    <Avatar
      src={avatarUrl(user.avatarKey, 64)}
      alt={`${user.givenName} ${user.familyName}`}
      initials={initialsFromName(user.givenName, user.familyName)}
      hueSeed={user.id}
      size="sm"
    />
  ) : null

  const sidebarNode = (
    <Sidebar
      entries={NAV_ENTRIES}
      ctx={navCtx}
      groups={NAV_GROUPS}
      counts={counts}
      activeRoute={route}
      linkAs={RouterLink}
      wordmark={WORDMARK}
      creditText={t('shell.credit')}
      collapsed={isDesktop ? collapsed : false}
      header={
        memberships.length > 0 ? (
          <DepartmentSwitcher
            departments={memberships.map((m) => ({
              id: m.departmentId,
              name: m.name,
              roleLabel: t(
                m.role === 'head' ? 'shell.department.role.head' : 'shell.department.role.member',
              ),
            }))}
            activeId={department?.departmentId ?? null}
            onSelect={(id) => setDepartmentId(id)}
            label={t('shell.department.aria')}
            heading={t('shell.department.heading')}
            emptyLabel={t('shell.department.empty')}
            addLabel={t('shell.department.add')}
            onAdd={() => navigate('/departments')}
            collapsed={isDesktop ? collapsed : false}
          />
        ) : null
      }
      footer={
        user && userAvatar ? (
          <SidebarUserBlock
            avatar={userAvatar}
            name={`${user.givenName} ${user.familyName}`}
            secondary={user.login}
            label={t('shell.account.aria')}
            collapsed={isDesktop ? collapsed : false}
            actions={[
              {
                id: 'account',
                label: t('shell.account.settings'),
                icon: UserCog,
                onSelect: () => navigate('/account'),
              },
              {
                id: 'shortcuts',
                label: t('shell.shortcuts.title'),
                icon: Settings,
                onSelect: () => setShortcutsOpen(true),
              },
              {
                id: 'signout',
                label: t('shell.account.signout'),
                onSelect: handleSignOut,
                danger: true,
              },
            ]}
          />
        ) : null
      }
    />
  )

  const quickAddActions = getFeatureQuickAddEntries().map((entry) => ({
    id: entry.id,
    label: t(entry.labelKey),
    ...(entry.icon ? { icon: entry.icon } : {}),
    ...(entry.shortcut ? { shortcut: entry.shortcut } : {}),
    onSelect: () => navigate(entry.path),
  }))

  const trailing = (
    <>
      {isDemo ? (
        <DemoChip
          // Full label at >=768; the short one below that (spec.md §3.5: "using the short label
          // ('Demo'), never a truncated long label").
          label={isDesktop ? t('shell.demo.chip.label') : t('shell.demo.chip.short')}
          popoverText={t('shell.demo.popover')}
        />
      ) : null}
      {/* round2 SEV2: every quick-add action creates something inside a department (a card, an
          event, ...), so a membership-less super_admin session -- confirmed live navigating to
          /work -- gets no working destination for any of them; the button itself is gated the same
          way the sidebar's department groups are (`navCtx.hasDepartment`). */}
      {user && navCtx.hasDepartment ? (
        <QuickAdd
          actions={quickAddActions}
          label={t('shell.quickAdd.aria')}
          shortLabel={t('shell.quickAdd.label')}
          compact={!isDesktop}
        />
      ) : null}
      {user ? (
        <InboxBell
          count={inboxCount}
          label={t('shell.inbox.aria')}
          active={route.startsWith('/inbox')}
          onClick={() => navigate('/inbox')}
        />
      ) : null}
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
      {user && userAvatar ? (
        <AvatarMenu
          avatarLabel={`${user.givenName} ${user.familyName}`}
          avatar={userAvatar}
          themeLabel={t('shell.theme.label')}
          themeOptions={themeOptions}
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
    <div className="flex min-h-full bg-background">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-sm focus:bg-card focus:px-4 focus:py-2 focus:text-body focus:shadow-2"
      >
        {t('shell.skip')}
      </a>

      {isDesktop ? (
        <aside className="sticky top-0 hidden h-dvh shrink-0 md:block">{sidebarNode}</aside>
      ) : (
        <Sheet direction="left" open={drawerOpen} onOpenChange={setDrawerOpen}>
          <SheetContent
            title={t('shell.menu.open')}
            side="left"
            className="w-(--width-sidebar) p-0"
          >
            {sidebarNode}
          </SheetContent>
        </Sheet>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
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
          <OfflineBanner
            hasCachedContent={Boolean(user)}
            onRetry={() => window.location.reload()}
          />
        ) : null}

        {showViewAsBanner ? (
          <div className="px-4 pt-4 sm:px-6 md:px-8">
            <ViewAsBanner />
          </div>
        ) : null}

        <main id="main" className="min-w-0 flex-1 px-4 pb-24 pt-6 sm:px-6 md:px-8 md:pb-10 md:pt-8">
          <PaletteProvider onOpen={() => setPaletteOpen(true)}>
            <PageContainer>
              {/* UI-OVERHAUL.md §3 row 1: the route swap is a crossfade + 8 px slide -- View
                  Transitions where the browser has them, an AnimatePresence fallback otherwise. */}
              <PageTransition routeKey={route}>
                {renderMainContent({
                  meQueryIsError: meQuery.isError,
                  onRetry: () => meQuery.refetch(),
                  maintenanceBlocksThisRoute,
                  maintenanceMessage,
                  locale,
                  children,
                })}
              </PageTransition>
            </PageContainer>
          </PaletteProvider>
        </main>
      </div>

      {!isDesktop && user ? (
        <BottomTabBar
          entries={mobileTabEntries(visibleEntries)}
          activeRoute={route}
          linkAs={RouterLink}
          counts={counts}
          labelOverrides={Object.fromEntries(
            Object.entries(MOBILE_TAB_SHORT_LABEL_KEYS).map(([id, key]) => [id, t(key)]),
          )}
          label={t('shell.nav.aria')}
        />
      ) : null}

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
          {
            keys: ['Ctrl/⌘', 'K'],
            description: t('shell.shortcuts.search'),
            group: t('shell.shortcuts.group.general'),
          },
          {
            keys: ['/'],
            description: t('shell.shortcuts.search'),
            group: t('shell.shortcuts.group.general'),
          },
          {
            keys: ['?'],
            description: t('shell.shortcuts.help'),
            group: t('shell.shortcuts.group.general'),
          },
          {
            keys: ['Ctrl/⌘', 'B'],
            description: t('shell.shortcuts.sidebar'),
            group: t('shell.shortcuts.group.general'),
          },
          {
            keys: ['Esc'],
            description: t('shell.shortcuts.close'),
            group: t('shell.shortcuts.group.general'),
          },
          {
            keys: ['g', 'h'],
            description: t('shell.shortcuts.home'),
            group: t('shell.shortcuts.group.goto'),
          },
          {
            keys: ['g', 'i'],
            description: t('shell.shortcuts.inbox'),
            group: t('shell.shortcuts.group.goto'),
          },
        ]}
      />

      {/* Package report item 34: at <768px this shell renders `BottomTabBar`, a 60px
          (`--height-tabbar`) fixed bar with its own safe-area padding -- Sonner's default mobile
          offset put every toast right on top of it. `mobileOffset` lifts the stack clear of the bar
          plus its own safe-area inset (the tab bar's padding-bottom is a *visual* inset, not extra
          height Sonner's own layout knows about) with one gap token of breathing room above it. */}
      <Toaster
        position={isDesktop ? 'bottom-right' : 'bottom-center'}
        mobileOffset={{
          bottom: 'calc(var(--height-tabbar) + env(safe-area-inset-bottom) + var(--space-3))',
        }}
      />
    </div>
  )
}

/** Extracted to a plain function (never an inline ternary chain in the JSX above) so a closing angle
 * bracket from one branch's element is never immediately followed, on the next source line, by plain
 * conditional-expression code before the next opening bracket -- `agentic/scripts/check-i18n.mjs`'s
 * hard-coded-text heuristic bridges a newline with its own whitespace match and false-positives on
 * exactly that shape, as it did here before this refactor. */
function renderMainContent(props: {
  meQueryIsError: boolean
  onRetry: () => void
  maintenanceBlocksThisRoute: boolean
  maintenanceMessage: Record<string, string> | null
  locale: Locale
  children: React.ReactNode
}): React.ReactNode {
  if (props.meQueryIsError) {
    return (
      <StateView
        kind="error"
        titleKey="state.error.title"
        bodyKey="state.error.body"
        action={{ labelKey: 'state.error.action', onAction: props.onRetry }}
      />
    )
  }
  if (props.maintenanceBlocksThisRoute) {
    return <MaintenanceNotice message={props.maintenanceMessage} locale={props.locale} />
  }
  return props.children
}

/** TECH-SPEC §11: the branded page every route renders while maintenance is on, for everyone except
 * the super admin. `message` is the super admin's own, live, four-locale text (`GET /api/v1/instance`,
 * set from `/admin/settings` -- `features/admin/settings-screen.tsx`'s `MaintenanceCard`); only the
 * heading is a fixed i18n string, kept in the admin module's own message namespace (never the core
 * catalogue a module must not edit) since this component itself is the one necessary exception to
 * "features never edit the shell". */
function MaintenanceNotice({
  message,
  locale,
}: {
  message: Record<string, string> | null
  locale: Locale
}) {
  const t = useT()
  const text = message?.[locale] || message?.['uz-Latn'] || null
  return (
    <div
      role="alert"
      className="mx-auto flex max-w-140 flex-col items-center gap-3 rounded-md border border-border bg-card p-10 text-center"
    >
      <h1 className="text-h3 text-foreground">{t('admin.console.maintenanceNotice.title')}</h1>
      {text ? <p className="max-w-100 text-body text-muted-foreground">{text}</p> : null}
    </div>
  )
}
