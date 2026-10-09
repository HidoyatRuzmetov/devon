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
  MessageSquareText,
  Monitor,
  Moon,
  Sun,
  Users,
} from 'lucide-react'
import { useT } from '@devon/i18n'
import {
  CommandPalette,
  resolveNavEntries,
  type CommandPaletteGroup,
  type CommandPaletteItem,
  type NavContext,
} from '@devon/ui'
import { LOCALES, LOCALE_LABEL, type Locale } from '@devon/i18n'
import { useDepartment } from '../lib/session.js'
import { useNavCan } from '../lib/can.js'
import { navigate, useRoutePath } from '../lib/router.js'
import { setThemePreference, type ThemePreference } from '../lib/theme.js'
import { getFeatureCommandEntries, getFeatureQuickAddEntries } from '../features/registry.js'
import type { Card } from '../features/work/api.js'
import type { EventDto } from '../features/events/schemas.js'
import type { Project } from '../features/projects/api.js'
import type { PageSummary } from '../features/pages/types.js'
import type { Member } from '../features/structure/api.js'
import { useDepartmentSearchQuery } from '../features/ai/use-ai.js'
import { searchHitHref } from '../features/ai/types.js'
import { NAV_ENTRIES } from './nav.js'

/** How many rows a single async source contributes to the palette before typing narrows them --
 * enough that "type a few letters, see it" holds for a department of ordinary size, never so many
 * that the untyped palette is a wall of everything the department has ever created. */
const SOURCE_LIMIT = 8

/** One shared empty array behind every "still loading" fallback -- see `usePaletteEntities`. A
 * fresh `[]` per render would give the palette's `useMemo` a new dependency on every render and
 * defeat it entirely. */
const EMPTY_ROWS: never[] = []

const RECENT_STORAGE_KEY = 'wp.palette.recent'
const RECENT_MAX = 4

/** The palette renders nothing while it is closed, so the group builder short-circuits to this one
 * array instead of allocating a fresh empty one per render. */
const EMPTY_GROUPS: never[] = []

/** Long enough that typing does not fire a request per keystroke, short enough that the section
 * appears while the hand is still on the keyboard. */
const SEARCH_DEBOUNCE_MS = 220

/** SPEC §8 / HANDOFFS #2: the palette's "Qidiruv" section. `useDepartmentSearchQuery` is the same
 * server search the Ask panel runs (`GET /ai/search`), so Ctrl+K reaches the *contents* of cards,
 * comments, pages and events -- not only the eight most recent rows of each list the palette already
 * prefetches. The icon per kind matches the one that kind carries everywhere else in the product. */
const SEARCH_HIT_ICON: Record<string, React.ComponentType<React.SVGProps<SVGSVGElement>>> = {
  card: KanbanSquare,
  comment: MessageSquareText,
  page: FileText,
  event: CalendarDays,
}

function useDebounced(value: string, ms: number): string {
  const [debounced, setDebounced] = React.useState(value)
  React.useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), ms)
    return () => window.clearTimeout(id)
  }, [value, ms])
  return debounced
}

export interface CommandPaletteControllerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCloseAutoFocus: (event: Event) => void
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
    queryFn: () =>
      import('../features/structure/api.js').then(({ fetchMembers }) =>
        fetchMembers(departmentId!),
      ),
    enabled,
    staleTime: 60_000,
  })
  const cardsQuery = useQuery({
    queryKey: ['palette', 'cards'],
    queryFn: () =>
      import('../features/work/api.js').then(({ fetchCards }) =>
        fetchCards({ limit: SOURCE_LIMIT }),
      ),
    enabled,
    staleTime: 30_000,
  })
  const eventsQuery = useQuery({
    queryKey: ['palette', 'events'],
    queryFn: () => import('../features/events/api.js').then(({ fetchEvents }) => fetchEvents({})),
    enabled,
    staleTime: 30_000,
  })
  const pagesQuery = useQuery({
    queryKey: ['palette', 'pages'],
    queryFn: () => import('../features/pages/api.js').then(({ fetchPages }) => fetchPages()),
    enabled,
    staleTime: 30_000,
  })
  // v1.1 (WALKTHROUGH-FINDINGS 2.3): projects were the one thing a search for "hisobot" obviously
  // should have found and did not -- "Yillik hisobot 2026" is a project, not a card.
  const projectsQuery = useQuery({
    queryKey: ['palette', 'projects'],
    queryFn: () =>
      import('../features/projects/api.js').then(({ fetchProjects }) => fetchProjects()),
    enabled,
    staleTime: 30_000,
  })

  // Memoised, and every fallback is the one frozen `EMPTY_ROWS` rather than a fresh `[]`, so the
  // five arrays below are referentially stable while a query is still pending. The palette's whole
  // item list is built in a `React.useMemo` keyed on exactly these (verdict F2) -- a fresh `[]` per
  // render would defeat it on every app-shell re-render.
  const { data: members } = membersQuery
  const { data: cards } = cardsQuery
  const { data: events } = eventsQuery
  const { data: pages } = pagesQuery
  const { data: projects } = projectsQuery
  return React.useMemo(
    () => ({
      members: members ?? EMPTY_ROWS,
      cards: cards?.items ?? EMPTY_ROWS,
      events: events?.items ?? EMPTY_ROWS,
      pages: pages ?? EMPTY_ROWS,
      projects: projects ?? EMPTY_ROWS,
    }),
    [members, cards, events, pages, projects],
  )
}

/** v1.1 critique SEV2 #11. Two manifest registrations pointing at the same destination are one
 * action -- `events` declares "Tadbir yaratish" as both a `command` and a `quickAdd`, and the
 * AMALLAR section listed it twice. The destination is the identity; the first registration keeps its
 * icon and label. `path` is dropped from the item afterwards because `CommandPaletteItem` has no
 * such field -- it exists only to compare on. */
type PathedItem = CommandPaletteItem & { path: string }

function dedupeByPath(items: readonly PathedItem[]): Omit<PathedItem, 'path'>[] {
  const seen = new Set<string>()
  const out: Omit<PathedItem, 'path'>[] = []
  for (const item of items) {
    if (seen.has(item.path)) continue
    seen.add(item.path)
    const { path: _path, ...rest } = item
    out.push(rest)
  }
  return out
}

export function CommandPaletteController({
  open,
  onOpenChange,
  onCloseAutoFocus,
  isSuperAdmin,
  onChangeLocale,
  onOpenShortcuts,
  onSignOut,
  variant,
}: CommandPaletteControllerProps) {
  const t = useT()
  const [mode, setMode] = React.useState<Mode>('root')
  const recentRoutes = useRecentRoutes()
  const { department, departmentId, memberships } = useDepartment()
  const navCan = useNavCan()
  const entities = usePaletteEntities(open, departmentId)
  // HANDOFFS #2: the "Qidiruv" section. The input becomes controlled only so this file can see the
  // query; cmdk keeps filtering every other group exactly as before.
  const [query, setQuery] = React.useState('')
  const debouncedQuery = useDebounced(query, SEARCH_DEBOUNCE_MS)
  const searchQuery = useDepartmentSearchQuery(
    open && departmentId ? debouncedQuery : '',
    SOURCE_LIMIT,
  )

  React.useEffect(() => {
    if (!open) setQuery('')
  }, [open])

  React.useEffect(() => {
    if (!open) setMode('root')
  }, [open])

  // Motion verdict F2, the last of it. Even with one cursor node and a memoised builder, mounting
  // all ~63 rows on the keypress costs ~210 ms in a production build -- the `Dialog`'s 220 ms
  // scale-in cannot start on a frame that has not been rendered yet, and DESIGN.md §2.5 gives this
  // interaction `--dur-micro` (140 ms) "or not at all".
  //
  // So the palette opens with what a person is actually looking at when they press the shortcut --
  // Recent, Oʻtish, Amallar, Sozlamalar, Hisob, about 23 rows -- and the ~40 entity rows (people,
  // cards, projects, events, pages) are appended one frame later inside a transition. Nothing is
  // lost: the entity rows exist to be *typed at*, and they are mounted long before a first keystroke
  // lands. `false` again on close, so the next open is equally cheap.
  const [entitiesReady, setEntitiesReady] = React.useState(false)
  React.useEffect(() => {
    if (!open) {
      setEntitiesReady(false)
      return
    }
    const frame = window.requestAnimationFrame(() => {
      React.startTransition(() => setEntitiesReady(true))
    })
    return () => window.cancelAnimationFrame(frame)
  }, [open])

  const close = React.useCallback((): void => {
    onOpenChange(false)
  }, [onOpenChange])

  const go = React.useCallback(
    (path: string): void => {
      close()
      navigate(path)
    },
    [close],
  )

  // Verdict F2: opening `Ctrl/Cmd+K` cost 350-630 ms of blocked main thread, and part of that was
  // that every one of the ~66 rows below -- their labels translated, their icons resolved, their
  // `onSelect` closures allocated -- was rebuilt on *every* render of the app shell, open or not.
  // It is now built once per meaningful input change, and not at all while the palette is shut.
  const groups = React.useMemo<CommandPaletteGroup[]>(() => {
    if (!open) return EMPTY_GROUPS
    // Every destination in the product, with the icon it already carries in the sidebar -- so a
    // palette row and a nav row are recognisably the same thing (Jakob's Law inside one product).
    // round2 SEV2: a membership-less super_admin's palette must drop the same nine department-scoped
    // destinations the sidebar does (`nav.ts`'s `requireDepartmentFor`), or "Oʻtish" would still offer
    // a shortcut to a screen the sidebar just hid.
    // HANDOFFS #1 (v1.1 integration): this used to resolve with `{ role, hasDepartment }` alone -- no
    // `departmentRole`, no `can` -- so every head-only destination the sidebar correctly hid
    // (`/people/table`, `/fields`, `/department`, `/work/workload`, `/goals`, `/automations`) was still
    // one Ctrl+K away for a xodim, and pressing it landed them on a 403. The palette now resolves with
    // exactly the context `app-shell.tsx` gives the sidebar (`lib/can.tsx`'s `useNavCan`), so the two
    // can never disagree (SPEC §2, I-6).
    const navEntries = resolveNavEntries(NAV_ENTRIES, {
      role: isSuperAdmin ? 'super_admin' : 'member',
      departmentRole: department?.role ?? null,
      can: navCan,
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
    // Server-side search over the *contents* of cards, comments, pages and events -- the one thing
    // Ctrl+K could not do before, and the reason a search for a phrase inside a card found nothing.
    // `alwaysVisible` keeps cmdk's fuzzy filter from re-scoring a snippet the server already matched.
    const searchItems = (searchQuery.data?.hits ?? []).map((hit) => ({
      id: `hit:${hit.subjectType}:${hit.subjectId}`,
      label: hit.title || t('ai.search.untitled'),
      icon: SEARCH_HIT_ICON[hit.subjectType] ?? FileText,
      badge: t(`ai.search.kind.${hit.subjectType}`),
      ...(hit.snippet ? { description: hit.snippet } : {}),
      alwaysVisible: true,
      onSelect: () => go(searchHitHref(hit)),
    }))
    const searchHeading =
      searchQuery.data?.backend === 'embeddings'
        ? t('ai.search.palette.headingSemantic')
        : t('ai.search.palette.heading')

    const entityGroups: CommandPaletteGroup[] = !entitiesReady
      ? []
      : [
          ...(searchItems.length > 0 ? [{ heading: searchHeading, items: searchItems }] : []),
          ...(peopleItems.length > 0
            ? [{ heading: t('cmd.group.people'), items: peopleItems }]
            : []),
          ...(cardItems.length > 0 ? [{ heading: t('cmd.group.cards'), items: cardItems }] : []),
          ...(projectItems.length > 0
            ? [{ heading: t('cmd.group.projects'), items: projectItems }]
            : []),
          ...(eventItems.length > 0 ? [{ heading: t('cmd.group.events'), items: eventItems }] : []),
          ...(pageItems.length > 0 ? [{ heading: t('cmd.group.pages'), items: pageItems }] : []),
        ]

    // "Create" first (that is what a palette is reached for mid-task), then everything else a feature
    // registered.
    //
    // Both lists are gated on each entry's declared `action` (HANDOFFS #1): a manifest command like
    // `work.workload` or `automations` names `work.workload.read` / `automations.read`, and an entry
    // that names nothing is a destination every member may reach. Same predicate as the sidebar.
    //
    // v1.1 critique SEV2 #11, both halves:
    //   * `visibleWhen` is honoured here exactly as the sidebar honours it, so "Boʻlim yaratish"
    //     disappears for anybody who already has a department;
    //   * the list is deduped **by destination**. `events` registers "Tadbir yaratish" once as a
    //     `command` and once as a `quickAdd` -- both are the same act, so the palette showed it twice
    //     in one section. The path is what an action *is*; two entries pointing at `/events?new=1` are
    //     one action with two registrations, and the first one wins.
    const navContextForEntries = {
      role: isSuperAdmin ? ('super_admin' as const) : ('member' as const),
      departmentRole: department?.role ?? null,
      can: navCan,
      hasDepartment: memberships.length > 0,
    }
    const entryAllowed = (entry: {
      action?: string
      visibleWhen?: (ctx: NavContext) => boolean
    }) => {
      if (entry.action && !navCan(entry.action)) return false
      if (entry.visibleWhen && !entry.visibleWhen(navContextForEntries)) return false
      return true
    }

    const actionItems = dedupeByPath([
      ...getFeatureQuickAddEntries()
        .filter(entryAllowed)
        .map((entry) => ({
          id: `quick:${entry.id}`,
          path: entry.path,
          label: t(entry.labelKey),
          ...(entry.icon ? { icon: entry.icon } : {}),
          onSelect: () => go(entry.path),
        })),
      ...getFeatureCommandEntries()
        // A command that only repeats a sidebar destination is already in "Go to" above.
        .filter((entry) => !navByRoute.has(entry.path))
        .filter(entryAllowed)
        .map((entry) => ({
          id: entry.id,
          path: entry.path,
          label: t(entry.labelKey),
          ...(entry.icon ? { icon: entry.icon } : {}),
          onSelect: () => go(entry.path),
        })),
    ])

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

    return mode === 'locale' ? localeGroups : mode === 'theme' ? themeGroups : rootGroups
  }, [
    open,
    entitiesReady,
    mode,
    t,
    recentRoutes,
    isSuperAdmin,
    department?.role,
    navCan,
    memberships.length,
    entities.members,
    entities.cards,
    entities.events,
    entities.pages,
    entities.projects,
    searchQuery.data,
    go,
    close,
    onChangeLocale,
    onOpenShortcuts,
    onSignOut,
  ])

  return (
    <CommandPalette
      open={open}
      onOpenChange={onOpenChange}
      onCloseAutoFocus={onCloseAutoFocus}
      title={t('shell.search.aria')}
      placeholder={t('cmd.placeholder')}
      emptyMessage={t('cmd.empty.message')}
      emptyActionLabel={t('cmd.empty.action')}
      onEmptyAction={() => setMode('root')}
      hint={t('cmd.hint')}
      openHintLabel={t('shell.search.openHint')}
      groups={groups}
      query={query}
      onQueryChange={setQuery}
      variant={variant}
    />
  )
}
