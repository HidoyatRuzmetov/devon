// Wraps `@devon/ui`'s `CommandPalette` "shell" (structure/keyboard/`role` semantics are real there;
// this item wires the sources it filters over, per that package's own file comment). spec.md §5:
// "Interfeys tilini oʻzgartirish" and "Mavzuni oʻzgartirish" each "open a nested page listing" their
// four/three options -- implemented here as a small `root | locale | theme` mode switch inside the
// same dialog, since `@devon/ui`'s `LocaleMenu`/`AvatarMenu` triggers are not controllable from
// outside (DOES NOT: this item may not modify `packages/ui`), and reaching into their DOM to
// simulate a click would be more fragile than the two-line state machine below.
import * as React from 'react'
import { Globe, LogOut, Monitor, Moon, ShieldCheck, Sun } from 'lucide-react'
import { useT } from '@devon/i18n'
import { CommandPalette, type CommandPaletteGroup } from '@devon/ui'
import { LOCALES, LOCALE_LABEL, type Locale } from '@devon/i18n'
import { navigate } from '../lib/router.js'
import { setThemePreference, type ThemePreference } from '../lib/theme.js'
import { getFeatureCommandEntries } from '../features/registry.js'

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

  React.useEffect(() => {
    if (!open) setMode('root')
  }, [open])

  function close(): void {
    onOpenChange(false)
  }

  const rootGroups: CommandPaletteGroup[] = [
    {
      heading: t('cmd.group.goto'),
      items: [
        {
          id: 'home',
          label: t('cmd.item.home'),
          onSelect: () => {
            close()
            navigate('/')
          },
        },
        ...(isSuperAdmin
          ? [
              {
                id: 'admin',
                label: t('cmd.item.admin'),
                icon: ShieldCheck,
                onSelect: () => {
                  close()
                  navigate('/admin')
                },
              },
            ]
          : []),
        // Every `src/features/<name>/manifest.ts(x)`'s own `commands` (MODULE-GUIDE.md "Web
        // features") -- a feature never edits this file to appear in the palette.
        ...getFeatureCommandEntries().map((entry) => ({
          id: entry.id,
          label: t(entry.labelKey),
          ...(entry.icon ? { icon: entry.icon } : {}),
          onSelect: () => {
            close()
            navigate(entry.path)
          },
        })),
      ],
    },
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
      groups={groups}
      variant={variant}
    />
  )
}
