// Wraps `@devon/ui`'s `CommandPalette` "shell" (structure/keyboard/`role` semantics are real there;
// this file wires the sources it filters over).
//
// Rebuilt for UI-OVERHAUL.md §2 row 2 (Raycast, Linear): sections in a fixed order -- Recent,
// Go to, Actions, Settings, Account -- every row with an icon, keyboard hints on the rows that have
// one, and "Recent" fed by the routes this browser actually visited.
//
// spec.md §5's nested pages ("Interfeys tilini oʻzgartirish" and "Mavzuni oʻzgartirish" each open a
// listing of their four/three options) survive as the same small `root | locale | theme` mode
// switch inside the one dialog.
import * as React from 'react'
import { Globe, LogOut, Monitor, Moon, Sun } from 'lucide-react'
import { useT } from '@devon/i18n'
import { CommandPalette, resolveNavEntries, type CommandPaletteGroup } from '@devon/ui'
import { LOCALES, LOCALE_LABEL, type Locale } from '@devon/i18n'
import { navigate, useRoutePath } from '../lib/router.js'
import { setThemePreference, type ThemePreference } from '../lib/theme.js'
import { getFeatureCommandEntries, getFeatureQuickAddEntries } from '../features/registry.js'
import { NAV_ENTRIES } from './nav.js'

const RECENT_STORAGE_KEY = 'wp.palette.recent'
const RECENT_MAX = 4

export interface CommandPaletteControllerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  isSuperAdmin: boolean
  onChangeLocale: (locale: Locale) => void
  onOpenShortcuts: () => void
  onSignOut: () => void
  variant: 'dialog' | 'sheet'
}

type Mode = 'root' | 'locale' | 'theme'

const THEME_ICON: Record<ThemePreference, React.ComponentType<React.SVGProps<SVGSVGElement>>> = {
  light: Sun,
  dark: Moon,
  system: Monitor,
}

// Written as a literal map, not a template-literal call, because `agentic/scripts/check-i18n.mjs`
// only detects a `t(...)` call whose argument is a plain quoted string starting right at the open
// paren (`packages/i18n/src/t.ts`) -- an interpolated key would silently stop being checked at all.
function themeLabel(t: (key: string) => string, pref: ThemePreference): string {
  if (pref === 'light') return t('shell.theme.light')
  if (pref === 'dark') return t('shell.theme.dark')
  return t('shell.theme.system')
}

function readRecent(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

/** "Recent" is the top section of every palette people already use (Raycast, Linear, VS Code), and
 * it is the single thing that makes a palette feel like it knows them. Kept to visited *routes*, in
 * this browser only: it is a convenience, never a record, so it lives in localStorage and never
 * reaches the server. */
function useRecentRoutes(): string[] {
  const route = useRoutePath()
  const [recent, setRecent] = React.useState<string[]>(readRecent)

  React.useEffect(() => {
    setRecent((prev) => {
      const next = [route, ...prev.filter((p) => p !== route)].slice(0, RECENT_MAX + 1)
      try {
        window.localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(next))
      } catch {
        // Storage disabled -- recents simply do not persist past this session.
      }
      return next
    })
  }, [route])

  // The current route is never its own "recent" destination.
  return recent.filter((p) => p !== route).slice(0, RECENT_MAX)
}

export function CommandPaletteController({
  open,
  onOpenChange,
  isSuperAdmin,
  onChangeLocale,
  onOpenShortcuts,
  onSignOut,
  variant,
}: CommandPaletteControllerProps) {
  const t = useT()
  const [mode, setMode] = React.useState<Mode>('root')
  const recentRoutes = useRecentRoutes()

  React.useEffect(() => {
    if (!open) setMode('root')
  }, [open])

  function close(): void {
    onOpenChange(false)
  }

  function go(path: string): void {
    close()
    navigate(path)
  }

  // Every destination in the product, with the icon it already carries in the sidebar -- so a
  // palette row and a nav row are recognisably the same thing (Jakob's Law inside one product).
  const navEntries = resolveNavEntries(NAV_ENTRIES, {
    role: isSuperAdmin ? 'super_admin' : 'member',
  })
  const navByRoute = new Map(navEntries.map((entry) => [entry.route, entry]))

  const recentItems = recentRoutes
    .map((path) => navByRoute.get(path))
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    .map((entry) => ({
      id: `recent:${entry.id}`,
      label: t(entry.labelKey),
      icon: entry.icon,
      onSelect: () => go(entry.route),
    }))

  const gotoItems = navEntries.map((entry) => ({
    id: entry.id,
    label: t(entry.labelKey),
    icon: entry.icon,
    ...(entry.route === '/' ? { shortcut: 'G H' } : {}),
    ...(entry.route === '/inbox' ? { shortcut: 'G I' } : {}),
    onSelect: () => go(entry.route),
  }))

  // "Create" first (that is what a palette is reached for mid-task), then everything else a feature
  // registered.
  const actionItems = [
    ...getFeatureQuickAddEntries().map((entry) => ({
      id: `quick:${entry.id}`,
      label: t(entry.labelKey),
      ...(entry.icon ? { icon: entry.icon } : {}),
      onSelect: () => go(entry.path),
    })),
    ...getFeatureCommandEntries()
      // A command that only repeats a sidebar destination is already in "Go to" above.
      .filter((entry) => !navByRoute.has(entry.path))
      .map((entry) => ({
        id: entry.id,
        label: t(entry.labelKey),
        ...(entry.icon ? { icon: entry.icon } : {}),
        onSelect: () => go(entry.path),
      })),
  ]

  const rootGroups: CommandPaletteGroup[] = [
    ...(recentItems.length > 0 ? [{ heading: t('cmd.group.recent'), items: recentItems }] : []),
    { heading: t('cmd.group.goto'), items: gotoItems },
    ...(actionItems.length > 0 ? [{ heading: t('cmd.group.actions'), items: actionItems }] : []),
    {
      heading: t('cmd.group.settings'),
      items: [
        {
          id: 'locale',
          label: t('cmd.item.locale'),
          icon: Globe,
          onSelect: () => setMode('locale'),
        },
        {
          id: 'theme',
          label: t('cmd.item.theme'),
          icon: Monitor,
          onSelect: () => setMode('theme'),
        },
        {
          id: 'shortcuts',
          label: t('cmd.item.shortcuts'),
          shortcut: '?',
          onSelect: () => {
            close()
            onOpenShortcuts()
          },
        },
      ],
    },
    {
      heading: t('cmd.group.account'),
      items: [
        {
          id: 'signout',
          label: t('cmd.item.signout'),
          icon: LogOut,
          onSelect: () => {
            close()
            onSignOut()
          },
        },
      ],
    },
  ]

  const localeGroups: CommandPaletteGroup[] = [
    {
      heading: t('cmd.item.locale'),
      items: LOCALES.map((locale) => ({
        id: locale,
        label: LOCALE_LABEL[locale],
        icon: Globe,
        onSelect: () => {
          close()
          onChangeLocale(locale)
        },
      })),
    },
  ]

  const themeGroups: CommandPaletteGroup[] = [
    {
      heading: t('cmd.item.theme'),
      items: (['light', 'dark', 'system'] as const).map((pref) => ({
        id: pref,
        label: themeLabel(t, pref),
        icon: THEME_ICON[pref],
        onSelect: () => {
          close()
          setThemePreference(pref)
        },
      })),
    },
  ]

  const groups = mode === 'locale' ? localeGroups : mode === 'theme' ? themeGroups : rootGroups

  return (
    <CommandPalette
      open={open}
      onOpenChange={onOpenChange}
      title={t('shell.search.aria')}
      placeholder={t('cmd.placeholder')}
      emptyMessage={t('cmd.empty.message')}
      emptyActionLabel={t('cmd.empty.action')}
      onEmptyAction={() => setMode('root')}
      hint={t('cmd.hint')}
      openHintLabel={t('shell.search.openHint')}
      groups={groups}
      variant={variant}
    />
  )
}
