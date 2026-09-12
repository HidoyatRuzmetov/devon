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
import { useQuery } from '@tanstack/react-query'
import {
  CalendarDays,
  FileText,
  FolderKanban,
  Globe,
  KanbanSquare,
  LogOut,
  Monitor,
  Moon,
  Sun,
  Users,
} from 'lucide-react'
import { useT } from '@devon/i18n'
import { CommandPalette, resolveNavEntries, type CommandPaletteGroup } from '@devon/ui'
import { LOCALES, LOCALE_LABEL, type Locale } from '@devon/i18n'
import { useDepartment } from '../lib/session.js'
import { navigate, useRoutePath } from '../lib/router.js'
import { setThemePreference, type ThemePreference } from '../lib/theme.js'
import { getFeatureCommandEntries, getFeatureQuickAddEntries } from '../features/registry.js'
import { fetchCards, type Card } from '../features/work/api.js'
import { fetchEvents } from '../features/events/api.js'
import type { EventDto } from '../features/events/schemas.js'
import { fetchProjects } from '../features/projects/api.js'
import type { Project } from '../features/projects/api.js'
import { fetchPages } from '../features/pages/api.js'
import type { PageSummary } from '../features/pages/types.js'
import { fetchMembers, type Member } from '../features/structure/api.js'
import { NAV_ENTRIES } from './nav.js'

/** How many rows a single async source contributes to the palette before typing narrows them --
 * enough that "type a few letters, see it" holds for a department of ordinary size, never so many
 * that the untyped palette is a wall of everything the department has ever created. */
const SOURCE_LIMIT = 8

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

interface PaletteEntities {
  members: Member[]
  cards: Card[]
  events: EventDto[]
  pages: PageSummary[]
  projects: Project[]
}

/** The palette's real, async sources -- people, cards, events, pages -- each fetched once the
 * palette opens (never while it is closed: `enabled` gates every query on `open`) and only when a
 * department is active. `cmdk`'s own fuzzy filter (already wired in `@devon/ui`'s `CommandPalette`)
 * narrows this candidate set as the user types, exactly as it narrows every other group here -- this
 * hook's only job is fetching the rows; the caller turns them into `CommandPaletteItem`s so their
 * `onSelect` can close the palette the same way every other row's does. */
function usePaletteEntities(open: boolean, departmentId: string | null): PaletteEntities {
  const enabled = open && departmentId !== null

  const membersQuery = useQuery({
    queryKey: ['palette', 'members', departmentId],
    queryFn: () => fetchMembers(departmentId!),
    enabled,
    staleTime: 60_000,
  })
  const cardsQuery = useQuery({
    queryKey: ['palette', 'cards'],
    queryFn: () => fetchCards({ limit: SOURCE_LIMIT }),
    enabled,
    staleTime: 30_000,
  })
  const eventsQuery = useQuery({
    queryKey: ['palette', 'events'],
    queryFn: () => fetchEvents({}),
    enabled,
    staleTime: 30_000,
  })
  const pagesQuery = useQuery({
    queryKey: ['palette', 'pages'],
    queryFn: () => fetchPages(),
    enabled,
    staleTime: 30_000,
  })
  // v1.1 (WALKTHROUGH-FINDINGS 2.3): projects were the one thing a search for "hisobot" obviously
  // should have found and did not -- "Yillik hisobot 2026" is a project, not a card.
  const projectsQuery = useQuery({
    queryKey: ['palette', 'projects'],
    queryFn: () => fetchProjects(),
    enabled,
    staleTime: 30_000,
  })

  return {
    members: membersQuery.data ?? [],
    cards: cardsQuery.data?.items ?? [],
    events: eventsQuery.data?.items ?? [],
    pages: pagesQuery.data ?? [],
    projects: projectsQuery.data ?? [],
  }
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
  const { departmentId, memberships } = useDepartment()
  const entities = usePaletteEntities(open, departmentId)

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
  // round2 SEV2: a membership-less super_admin's palette must drop the same nine department-scoped
  // destinations the sidebar does (`nav.ts`'s `requireDepartmentFor`), or "Oʻtish" would still offer
  // a shortcut to a screen the sidebar just hid.
  const navEntries = resolveNavEntries(NAV_ENTRIES, {
    role: isSuperAdmin ? 'super_admin' : 'member',
    hasDepartment: memberships.length > 0,
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

  const peopleItems = entities.members.slice(0, SOURCE_LIMIT).map((member) => ({
    id: `person:${member.userId}`,
    label: [member.familyName, member.givenName].filter(Boolean).join(' '),
    icon: Users,
    ...(member.title ? { hint: member.title } : {}),
    onSelect: () => go('/people'),
  }))
  const cardItems = entities.cards.slice(0, SOURCE_LIMIT).map((card) => ({
    id: `card:${card.id}`,
    label: card.title,
    icon: KanbanSquare,
    onSelect: () => go(`/work/card?id=${encodeURIComponent(card.id)}`),
  }))
  const eventItems = entities.events.slice(0, SOURCE_LIMIT).map((event) => ({
    id: `event:${event.id}`,
    label: event.title,
    icon: CalendarDays,
    onSelect: () => go(`/events?event=${encodeURIComponent(event.id)}`),
  }))
  const projectItems = entities.projects.slice(0, SOURCE_LIMIT).map((project) => ({
    id: `project:${project.id}`,
    label: project.title,
    icon: FolderKanban,
    onSelect: () => go(`/projects/view?id=${encodeURIComponent(project.id)}`),
  }))
  const pageItems = entities.pages.slice(0, SOURCE_LIMIT).map((page) => ({
    id: `page:${page.id}`,
    label: page.title,
    icon: FileText,
    onSelect: () => go(`/pages?page=${encodeURIComponent(page.id)}`),
  }))
  const entityGroups: CommandPaletteGroup[] = [
    ...(peopleItems.length > 0 ? [{ heading: t('cmd.group.people'), items: peopleItems }] : []),
    ...(cardItems.length > 0 ? [{ heading: t('cmd.group.cards'), items: cardItems }] : []),
    ...(projectItems.length > 0 ? [{ heading: t('cmd.group.projects'), items: projectItems }] : []),
    ...(eventItems.length > 0 ? [{ heading: t('cmd.group.events'), items: eventItems }] : []),
    ...(pageItems.length > 0 ? [{ heading: t('cmd.group.pages'), items: pageItems }] : []),
  ]

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
    ...entityGroups,
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
