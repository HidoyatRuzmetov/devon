# Frontend stack deep-dive: exact versions, what changed in 2025–2026, and the code patterns we'll actually write

**TL;DR:** The stack chosen in `frontend-architecture-and-sync.md` — Vite + React 19 + TanStack Router/Query/Table/Form/Virtual, Tailwind v4, shadcn/ui, Paraglide, date-fns v4, Zod, cmdk, Motion — holds up under a code-level audit, but four things changed since that dimension was researched and materially affect how we build: (1) **TanStack Table shipped v9 stable on August 4, 2026** — five weeks before this report — with a TanStack Store-based architecture, renamed hooks (`useReactTable` → `useTable`), and tree-shakable features; it is the right target but the freshest piece of the stack, so expect tutorials, Stack Overflow answers, and AI-assistant training data to still default to v8 syntax for a while. (2) **A real npm supply-chain attack hit the TanStack Router/Start monorepo on May 11–12, 2026** — 84 malicious versions across 42 packages, caused by a chained GitHub Actions vulnerability, not a code flaw in Router itself — which is a concrete argument for lockfile pinning and provenance checks, not a reason to avoid Router. (3) **Base UI reached 1.0 on December 11, 2025 and became shadcn/ui's default primitive layer in July 2026**, built by the same engineers who built Radix; the two are not a "pick one forever" decision because shadcn's copy-into-your-repo model means we can mix both. (4) **Zod's roadmap did not ship `z.interface()`** — the anticipated API does not exist in the current v4.5.x docs; the equivalent need (matching TypeScript's `exactOptionalPropertyTypes`) is instead met by `.exactOptional()` on `z.object()`. Everything else below is exact versions, release dates, licences, sizes, and the actual TypeScript we will write for each pattern the product needs: routed loaders, optimistic mutations, a virtualised editable grid, shared-schema forms, plural-aware i18n, a command registry, tenant-aware theme tokens, and kanban-card motion.

## 1. Version and licence matrix

All MIT-licensed unless noted; sizes are gzipped where the vendor publishes a figure, "n/a" where none was found in this pass.

| Library | Version (as of 2026-09-05) | Released | Gzip size | 2025–2026 headline change |
|---|---|---|---|---|
| Vite | 8.0 | 2026-03-12 | n/a (build tool) | Rolldown (Rust) is now the single default bundler, replacing the esbuild-dev/Rollup-build split; 10–30x faster builds reported by early adopters ([vite.dev/blog/announcing-vite8](https://vite.dev/blog/announcing-vite8)) |
| React + react-dom | 19.2.x | 2025-10-01 (19.2.0); patched through mid-2026 | ~44KB (react-dom, historical figure, unconfirmed for 19.2) | `<Activity>`, `useEffectEvent`, React Performance Tracks in DevTools ([react.dev/blog/2025/10/01/react-19-2](https://react.dev/blog/2025/10/01/react-19-2)) |
| React Compiler | 1.0 (stable) | 2025-10-07 | n/a (build-time) | First stable release; auto-memoization no longer experimental |
| @tanstack/react-router | actively released; supply-chain incident May 2026 | rolling | n/a | Compromise + hardening (see §1a); search-param validation and `loaderDeps` unchanged in shape |
| @tanstack/react-query | v5.x (5.101.x line) | rolling | ~13KB core (unconfirmed for latest patch) | Mutation callbacks now receive a shared `context` object (`context.client`) as the final argument, so `onMutate`/`onError`/`onSettled` no longer need a closed-over `queryClient` |
| @tanstack/react-table | v9.0 (stable) | 2026-08-04 | ~5KB minimal (tree-shaken) | New TanStack Store-based state, opt-in tree-shakable features, renamed hooks, up to 86% less retained heap on million-row benchmarks ([tanstack.com/blog/announcing-tanstack-table-v9](https://tanstack.com/blog/announcing-tanstack-table-v9)) |
| @tanstack/react-form | v1.x | GA 2025-03-03 | n/a | Standard Schema support (Zod/Valibot/ArkType) built in, 5 framework adapters |
| @tanstack/react-virtual | 3.14.x (react-virtual) / 3.17.x (virtual-core) | rolling | small (~3KB core) | End-anchored virtualization for chat/stream-style append-and-stay-pinned lists |
| Tailwind CSS | v4.0 | 2025-01-22 | n/a (build tool + utility CSS) | CSS-first config (`@theme`), OKLCH default palette, native `@container` queries (no plugin) ([tailwindcss.com/blog/tailwindcss-v4](https://tailwindcss.com/blog/tailwindcss-v4)) |
| shadcn CLI | v4 (March 2026), registry features through August 2026 | 2026-03 | n/a (codegen CLI, not a runtime dep) | "Built for you and your coding agents" — `shadcn/skills`, multi/private registries, dynamic search, Base UI as default primitive (July 2026) ([ui.shadcn.com/docs/changelog](https://ui.shadcn.com/docs/changelog)) |
| Base UI | 1.8.x (post-1.0) | 1.0 on 2025-12-11 | n/a | Ex-Radix/Floating UI/MUI team's second take; `render` prop instead of `asChild`; 35 components at 1.0 ([base-ui.com](https://base-ui.com/react/overview/quick-start)) |
| Radix UI (Primitives) | maintained, not deprecated | — | n/a | Still shadcn's secondary option; not being sunset |
| Paraglide JS | 2.x (GA) | beta Jan 2026 → GA | ~47KB for 5 locales / 200 messages (vs ~205KB i18next equivalent) | Compiled ESM message functions; "variants" (plural/gender/A-B) via `Intl.PluralRules` ([paraglidejs.com](https://paraglidejs.com/)) |
| date-fns | 4.4.x (4.0 baseline) | 2024-09-16 | ~6-13KB per locale (unconfirmed) | First-class time zones via `@date-fns/tz`; ESM-first; ships `uz`, `uz-Cyrl`, `ru` locales |
| Zod | 4.5.x (4.5.4 latest seen) | v4 stable 2025; 4.5.0 on 2026-08-28 | 5.36KB core / 1.88KB `zod/mini` | `z.compile()` (~9x faster parse), `z.validate()` (~16x faster boolean check), 9x memory-footprint cut; **no `z.interface()`** — use `.exactOptional()` instead ([zod.dev/v4](https://zod.dev/v4), [zod.dev/api](https://zod.dev/api)) |
| cmdk | actively maintained | — | small, unstyled | Powers shadcn's `Command`; handles 2,000–3,000 items without virtualization ([github.com/pacocoursey/cmdk](https://github.com/pacocoursey/cmdk)) |
| Motion (was Framer Motion) | 13.1.1 | 2026-08-18 | n/a | Axis-locked layout animations (`layout="x"`/`"y"`), `animateView()` for the View Transitions API, improved React 19 strict-mode compatibility ([motion.dev/changelog](https://motion.dev/changelog?lib=motion)) |

### 1a. The TanStack npm supply-chain incident — what actually happened

Between **May 10–12, 2026**, an attacker chained three weaknesses in TanStack's GitHub Actions release pipeline for the **Router/Start monorepo only**: a `pull_request_target`-triggered workflow (`bundle-size.yml`) ran untrusted fork code, that code poisoned the GitHub Actions cache, and the poisoned cache was restored during a legitimate release, extracting an OIDC publish token from runner memory. **84 malicious versions across 42 packages** were published directly to npm between 19:20–19:26 UTC on May 11; an external researcher disclosed it within 20 minutes; all versions were deprecated within two hours and tarballs removed by npm within a day. **Query, Table, Form, and Virtual were not affected** — only Router/Start. TanStack's public postmortem lists concrete hardening: workflows restructured to never execute untrusted fork code, repository-owner verification guards, third-party GitHub Actions pinned to commit SHAs, and a full cache purge ([tanstack.com/blog/npm-supply-chain-compromise-postmortem](https://tanstack.com/blog/npm-supply-chain-compromise-postmortem), [tanstack.com/blog/incident-followup](https://tanstack.com/blog/incident-followup)). **What this means for us, concretely:** pin exact versions in the lockfile (no `^`/`~` ranges on `@tanstack/*`), enable `npm audit signatures` / provenance verification in CI, and treat this as the argument *for* Renovate/Dependabot with a human-reviewed PR rather than auto-merge on patch bumps — not as a reason to avoid TanStack, whose response was fast and transparent.

## 2. Build tool: Vite 7 → 8, and what Rolldown changes for us

Vite 7.0 (2025-06-24) raised the floor — Node 20.19+/22.12+ only, default build target moved to "baseline widely available" (Chrome 107, Firefox 104, Safari 16), and introduced **rolldown-vite** as an opt-in drop-in bundler. Vite 8.0 (2026-03-12) made Rolldown the **only** bundler, collapsing the historical esbuild-for-dev/Rollup-for-build split into one Rust binary, with reported real-world gains (Linear: 46s → 6s production build; Beehiiv: 64% reduction) and a compatibility shim so most existing plugins keep working unmodified ([vite.dev/blog/announcing-vite8](https://vite.dev/blog/announcing-vite8)). For a 23-person team this mostly means faster CI and faster local rebuilds for free on upgrade — no config changes expected for a standard TanStack Router + Tailwind v4 setup. The one thing to verify before adopting: any Vite plugin we pick up later (a PDF export tool, a chart library's bundler plugin) should be checked against the Rolldown compatibility notes, since a handful of Rollup-specific plugin hooks aren't 1:1.

## 3. React 19.2 and the Compiler

React 19.2 (2025-10-01) adds `<Activity mode="visible" | "hidden">` — a first-class way to keep a subtree mounted-but-paused (state preserved, effects torn down) instead of the classic `{isVisible && <Page/>}` unmount pattern. This maps directly onto our **right-side detail panel** (§13): closing it should feel instant on reopen, which `<Activity mode="hidden">` gives us without a bespoke cache. `useEffectEvent` extracts non-reactive logic out of `useEffect` dependency arrays — useful for the notification-toast-on-connect pattern in our inbox drawer. React Compiler reached **1.0 stable on 2025-10-07**, work back to React 17, and auto-memoizes safely-compilable components; adoption is directory-scoped (`compiler: { include: [...] }` or exclude lists), so we can turn it on for `apps/web/src/routes` first and expand ([react.dev/blog/2025/10/01/react-19-2](https://react.dev/blog/2025/10/01/react-19-2)).

```tsx
// right-side detail panel: instant reopen via Activity instead of unmount
import { unstable_Activity as Activity } from 'react'

function AppShell({ selectedTaskId }: { selectedTaskId: string | null }) {
  return (
    <div className="flex">
      <MainList />
      <Activity mode={selectedTaskId ? 'visible' : 'hidden'}>
        {selectedTaskId && <TaskDetailPanel taskId={selectedTaskId} />}
      </Activity>
    </div>
  )
}
```

## 4. TanStack Router: file-based routes, loaders, URL-as-state

Route files under `routes/` compile to a fully-typed route tree; `validateSearch` (a Zod schema) makes filter/tab state in the URL first-class and type-checked end-to-end, and `loaderDeps` lets a loader re-run only when the search params it actually cares about change ([tanstack.com/router/latest/docs/guide/search-params](https://tanstack.com/router/latest/docs/guide/search-params)).

```tsx
// apps/web/src/routes/projects.$projectId.tsx
import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { projectQueryOptions, projectCommentsQueryOptions } from '@/queries/projects'

const searchSchema = z.object({
  tab: z.enum(['overview', 'tasks', 'comments']).default('overview'),
})

export const Route = createFileRoute('/projects/$projectId')({
  validateSearch: searchSchema,
  loaderDeps: ({ search: { tab } }) => ({ tab }),
  loader: async ({ context: { queryClient }, params, deps }) => {
    // ensureQueryData resolves instantly from cache if fresh — no spinner
    // for data we already have from the list view's prefetch.
    await queryClient.ensureQueryData(projectQueryOptions(params.projectId))
    if (deps.tab === 'comments') {
      // don't block navigation on the secondary tab's data
      void queryClient.prefetchQuery(projectCommentsQueryOptions(params.projectId))
    }
  },
  component: ProjectDetail,
})

function ProjectDetail() {
  const { projectId } = Route.useParams()
  const { tab } = Route.useSearch()
  const navigate = Route.useNavigate()
  const { data: project } = useSuspenseQuery(projectQueryOptions(projectId))

  return (
    <Tabs value={tab} onValueChange={(v) => navigate({ search: (prev) => ({ ...prev, tab: v as typeof tab }) })}>
      {/* ... */}
    </Tabs>
  )
}
```

This is also our **URL-as-state for filters/views** answer (§14 below): the Projects register's status/assignee/date-range filters and the People directory's grouping mode live in `validateSearch`-typed search params, so a filtered view is a shareable, bookmarkable, back-button-correct URL — no separate client-side filter store needed.

## 5. TanStack Query v5: optimistic mutations with rollback, and persistence

The current documented pattern passes a shared `context` object as the last argument to every mutation callback, carrying `context.client` (the `QueryClient` instance) so callbacks don't need a closed-over reference ([tanstack.com/query/latest/docs/framework/react/guides/optimistic-updates](https://tanstack.com/query/latest/docs/framework/react/guides/optimistic-updates)). Applied to a kanban status change:

```tsx
const updateTaskStatus = useMutation({
  mutationFn: (input: { taskId: string; status: TaskStatus }) =>
    api.tasks.updateStatus(input),

  onMutate: async ({ taskId, status }, { client }) => {
    await client.cancelQueries({ queryKey: ['tasks', 'board'] })
    const previous = client.getQueryData<Task[]>(['tasks', 'board'])
    client.setQueryData<Task[]>(['tasks', 'board'], (old) =>
      old?.map((t) => (t.id === taskId ? { ...t, status, _pending: true } : t)),
    )
    return { previous } // becomes the third arg to onError
  },

  onError: (_err, _vars, onMutateResult, { client }) => {
    if (onMutateResult?.previous) {
      client.setQueryData(['tasks', 'board'], onMutateResult.previous)
    }
    toast.error(m.tasks_status_update_failed())
  },

  onSettled: (_data, _err, _vars, _ctx, { client }) =>
    client.invalidateQueries({ queryKey: ['tasks', 'board'] }),
})
```

For persistence (the "app opens instantly with last-seen data" behaviour), `@tanstack/query-sync-storage-persister` + `persistQueryClient` write the whole cache to `localStorage`/IndexedDB on a debounce and rehydrate it before first paint — this is the mechanism behind our offline read-cache (§18).

## 6. TanStack Table v9 + TanStack Virtual: the editable, virtualised grid

Table v9 went stable **August 4, 2026**, five weeks before this report — it is the right long-term target, but be aware AI assistants, tutorials, and most Stack Overflow answers currently in circulation still show v8's `useReactTable`/`flexRender` API; expect to correct generated code during the early-adoption window. The headline architectural change is a move to **TanStack Store** for state (fine-grained subscriptions instead of one big re-render), **opt-in tree-shakable features** (a table using only client pagination pulls in only that row model, starting around 5KB), and renamed hooks (`useReactTable` → `useTable`) across all ten framework adapters ([tanstack.com/blog/announcing-tanstack-table-v9](https://tanstack.com/blog/announcing-tanstack-table-v9)). Reported gains: up to 86% less retained heap on a million-row/8-column paginated benchmark, and 1.5–3.9x faster core operations. Combined with `@tanstack/react-virtual` for row virtualization, this is the People directory and Projects register's foundation:

```tsx
function EditablePeopleTable({ rows, columns }: { rows: Person[]; columns: ColumnDef<Person>[] }) {
  const table = useTable({
    data: rows,
    columns,
    getRowId: (row) => row.id,
    getCoreRowModel: getCoreRowModel(),
    meta: {
      updateData: (rowIndex, columnId, value) =>
        savePersonField.mutate({ id: rows[rowIndex].id, field: columnId, value }),
    },
  })

  const parentRef = useRef<HTMLDivElement>(null)
  const rowVirtualizer = useVirtualizer({
    count: table.getRowModel().rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 36,
    overscan: 8,
  })

  return (
    <div ref={parentRef} className="h-full overflow-auto">
      <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const row = table.getRowModel().rows[virtualRow.index]
          return (
            <div
              key={row.id}
              style={{ position: 'absolute', top: 0, transform: `translateY(${virtualRow.start}px)`, width: '100%' }}
              className="flex border-b border-border"
            >
              {row.getVisibleCells().map((cell) => flexRender(cell.column.columnDef.cell, cell.getContext()))}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// column def uses an inline-edit cell component
function EditableCell({ getValue, row, column, table }: CellContext<Person, string>) {
  const initial = getValue()
  const [draft, setDraft] = useState(initial)
  return (
    <input
      className="w-full rounded bg-transparent px-1 focus:bg-surface-raised focus:ring-1 focus:ring-accent"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => table.options.meta?.updateData(row.index, column.id, draft)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') setDraft(initial)
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
      }}
    />
  )
}
```

The blur-to-commit / Escape-to-cancel / Enter-to-commit pattern above is the same shape as the autosave pattern in §17 — one mental model for "inline field, saved without a Save button" across the table and the form layer.

## 7. TanStack Form v1 + Zod: one schema, both sides

TanStack Form reached GA on **2025-03-03**, supports five frameworks, and natively accepts any **Standard Schema** validator (Zod, Valibot, ArkType) without an adapter package ([tanstack.com/blog/announcing-tanstack-form-v1](https://tanstack.com/blog/announcing-tanstack-form-v1)). The schema lives once, in `packages/contracts`, and is imported by both the React form and the API's input validation — eliminating client/server validation drift as a bug category entirely:

```ts
// packages/contracts/src/person.ts
import { z } from 'zod'

export const personSchema = z.object({
  fullName: z.string().min(2),
  position: z.string().min(1),
  startDate: z.iso.date(),
  email: z.email().optional(),
})
export type PersonInput = z.infer<typeof personSchema>
```

```tsx
// apps/web: create-person form
import { useForm } from '@tanstack/react-form'
import { personSchema, type PersonInput } from '@dokon24/contracts'

function CreatePersonForm() {
  const form = useForm({
    defaultValues: { fullName: '', position: '', startDate: '', email: undefined } satisfies PersonInput,
    validators: { onChange: personSchema },
    onSubmit: async ({ value }) => api.people.create(value),
  })

  return (
    <form onSubmit={(e) => { e.preventDefault(); form.handleSubmit() }}>
      <form.Field name="fullName">
        {(field) => (
          <Field label={m.person_full_name()} error={field.state.meta.errors[0]}>
            <Input
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(e) => field.handleChange(e.target.value)}
              aria-invalid={field.state.meta.errors.length > 0}
            />
          </Field>
        )}
      </form.Field>
      {/* position, startDate, email fields follow the same shape */}
    </form>
  )
}
```

**On Zod's `z.interface()`:** the original brief for this dimension anticipated it as a Zod 4 feature. Checked directly against `zod.dev/v4` and `zod.dev/api`, **it does not exist** in the current stable docs. What Zod 4 actually shipped for the adjacent problem (matching TypeScript's `exactOptionalPropertyTypes` compiler flag, where `{ nick?: string }` must reject an explicit `nick: undefined`) is `.exactOptional()` as a modifier on ordinary `z.object()` fields:

```ts
const User = z.object({
  name: z.string().optional(),      // absent OR undefined — normal TS optional
  nick: z.string().exactOptional(), // absent only — matches exactOptionalPropertyTypes
})
```

Recent Zod releases (4.5.0, 2026-08-28) added `z.compile()` (~9x faster parsing via ahead-of-time compilation) and `z.validate()` (~16x faster boolean-only validity checks, useful for a keystroke-level "is this field valid" indicator without building the full error tree) — both worth reaching for once a schema is on a hot path like the Projects register's inline-edit cells.

## 8. Tailwind v4: CSS-first tokens, OKLCH, and per-tenant theming

Tailwind v4 (2025-01-22) replaced `tailwind.config.js` with an `@theme` block in CSS; every token becomes a real CSS custom property, which is the mechanism that makes light/dark and **per-tenant** overrides trivial — override the variable, not the utility class ([tailwindcss.com/blog/tailwindcss-v4](https://tailwindcss.com/blog/tailwindcss-v4)):

```css
@import "tailwindcss";

@theme {
  --color-surface: oklch(0.99 0 0);
  --color-surface-raised: oklch(0.97 0 0);
  --color-ink: oklch(0.2 0.02 260);
  --color-accent: oklch(0.6 0.18 260); /* MinDigital indigo, our default */
  --radius-control: 0.5rem;
}

:root:not([data-theme="light"]) {
  @media (prefers-color-scheme: dark) {
    --color-surface: oklch(0.18 0.01 260);
    --color-surface-raised: oklch(0.24 0.01 260);
    --color-ink: oklch(0.95 0 0);
  }
}
:root[data-theme="dark"] {
  --color-surface: oklch(0.18 0.01 260);
  --color-surface-raised: oklch(0.24 0.01 260);
  --color-ink: oklch(0.95 0 0);
}

/* per-tenant override: a second ministry gets its own accent, no rebuild */
:root[data-tenant="moh"] {
  --color-accent: oklch(0.62 0.15 150); /* Ministry of Health green */
}
```

Because tokens are CSS variables, `bg-surface text-ink` utilities resolve correctly regardless of `data-theme`/`data-tenant` attributes on `<html>` — the same compiled CSS serves every tenant and both colour schemes; only the attribute set at the root changes, which is exactly the multi-tenant + dark-mode combination this project needs as it "spreads across ministries." Native `@container` queries (no plugin, since v4.0) are the right tool for the right-side detail panel and the Projects register's cards, which need to reflow based on their own box width, not the viewport — a detail panel docked at 380px and the same card rendered full-width in a modal should use one component with `@sm:`/`@lg:` container variants, not two components.

## 9. Component layer: shadcn CLI, Base UI vs Radix

shadcn/ui ships no runtime package — its CLI copies component source into the repo, so the "vs Radix vs Base UI" question is really "which primitive does the copied code import," and shadcn now supports **both** in the same project. CLI v4 (March 2026) added `shadcn/skills` (structured context so a coding agent gets both Radix's and Base UI's current APIs right) and multi/private registries; as of the **July 2026 changelog entry**, Base UI is the **default** primitive for newly generated components, though Radix remains fully supported and is not deprecated — shadcn's own adoption number is roughly 2:1 in favour of Base UI for new projects run through `shadcn/create` ([ui.shadcn.com/docs/changelog](https://ui.shadcn.com/docs/changelog)). Base UI 1.0 (2025-12-11) comes from the same engineers who built Radix, Floating UI, and Material UI, shipped 35 accessible components at launch, and uses a `render` prop for composition where Radix uses `asChild`:

```tsx
// Base UI: render prop makes the rendered element explicit
import { Popover } from '@base-ui/react/popover'

<Popover.Root>
  <Popover.Trigger render={<Button variant="ghost" />}>Notifications</Popover.Trigger>
  <Popover.Portal>
    <Popover.Positioner sideOffset={8}>
      <Popover.Popup>
        <Popover.Arrow />
        <Popover.Title>{m.notifications_title()}</Popover.Title>
      </Popover.Popup>
    </Popover.Positioner>
  </Popover.Portal>
</Popover.Root>
```

**Recommendation:** generate new components against Base UI (it is now shadcn's own default, has broader coverage — multi-select and combobox natively, which Radix lacks), but don't rip out any Radix-based component already in the repo just to match; the copy-in model means both coexist without a runtime conflict.

## 10. Paraglide 2: compiled i18n and plural rules for uz/ru/en

Paraglide compiles message files into tree-shakable ESM functions at build time rather than doing runtime dictionary lookups — the vendor's own benchmark shows **47KB for 5 locales/200 messages vs ~205KB for the equivalent i18next setup**, with Paraglide's bundle staying flat as message count grows because unused messages are simply not emitted ([paraglidejs.com](https://paraglidejs.com/)). Version 2 (GA after a January 2026 beta) added **variants** — plural, gender, and A/B message forms — resolved through `Intl.PluralRules`, which is the load-bearing detail for Russian's three-way plural system (one/few/many/other) and the reason to never hand-roll `count === 1 ? ... : ...` logic.

```json
// messages/ru.json — Russian needs all four CLDR categories
{
  "tasks_overdue": {
    "match": {
      "count": {
        "one": "{count} задача просрочена",
        "few": "{count} задачи просрочены",
        "many": "{count} задач просрочено",
        "other": "{count} задачи просрочены"
      }
    }
  }
}
```

```json
// messages/en.json — English needs two
{
  "tasks_overdue": { "match": { "count": { "one": "{count} task is overdue", "other": "{count} tasks are overdue" } } }
}
```

```json
// messages/uz.json — Uzbek has no grammatical plural distinction (CLDR: "other" only)
{
  "tasks_overdue": "{count} ta vazifa muddati o'tgan"
}
```

The Uzbek entry is deliberately a single string, not a `match` block: CLDR classifies Uzbek as having exactly one plural category ("other") for cardinal numbers, so the same string is grammatically correct whether `count` is 1 or 50 — a genuinely easy thing for an English- or Russian-speaking developer to get wrong by assuming every locale needs multiple forms (or, just as likely, assuming Uzbek needs *none* and hardcoding the count with no pluralization key at all, which breaks the moment a fourth locale is added later). Usage is a plain function call with full type inference on the variable names:

```ts
import * as m from '@/paraglide/messages'
m.tasks_overdue({ count: overdueTasks.length })
```

## 11. date-fns v4: three locales, one API

date-fns 4.0 (2024-09-16) is ESM-first and added first-class time zone support via the separate `@date-fns/tz` package (a `TZDate` class and a `context: { in: tz(...) }` option threaded through the relevant functions) rather than baking Moment-style mutable time zone state into the core ([blog.date-fns.org/v40-with-time-zone-support](https://blog.date-fns.org/v40-with-time-zone-support/)). It ships `uz`, `uz-Cyrl`, and `ru` locale files out of the box (confirmed at 4.4.0 against the published package in the earlier research pass) — a real advantage over Day.js's thinner, community-maintained Uzbek pack. Standard usage:

```ts
import { format } from 'date-fns'
import { ru, uz } from 'date-fns/locale'

format(task.dueDate, 'PPP', { locale: locale === 'ru' ? ru : uz })
```

## 12. cmdk + Motion: command registry and kanban card motion

**Command palette entry registry.** cmdk is unstyled, powers shadcn's `Command` component, and does its own fuzzy filtering/keyboard nav without virtualization up to roughly 2,000–3,000 items ([github.com/pacocoursey/cmdk](https://github.com/pacocoursey/cmdk)) — plenty for a command set that will never exceed a few hundred entries even fully grown. The registry is a plain typed array so new commands are additions, not framework changes:

```ts
type CommandEntry = {
  id: string
  labelKey: keyof typeof import('@/paraglide/messages')
  group: 'navigate' | 'create' | 'action'
  icon: LucideIcon
  shortcut?: string
  perm?: Permission
  run: (ctx: { navigate: NavigateFn }) => void
}

export const commandRegistry: CommandEntry[] = [
  { id: 'nav.people', labelKey: 'command_go_to_people', group: 'navigate', icon: Users, shortcut: 'g p',
    run: ({ navigate }) => navigate({ to: '/people' }) },
  { id: 'create.task', labelKey: 'command_new_task', group: 'create', icon: Plus, shortcut: 'c t',
    perm: 'task:create', run: ({ navigate }) => navigate({ to: '/tasks/new' }) },
]

function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { can } = usePermissions()
  const navigate = useNavigate()
  const visible = commandRegistry.filter((c) => !c.perm || can(c.perm))
  return (
    <Command.Dialog open={open} onOpenChange={onOpenChange} label={m.command_title()}>
      <Command.Input placeholder={m.command_placeholder()} />
      <Command.List>
        <Command.Empty>{m.command_no_results()}</Command.Empty>
        {Object.entries(Object.groupBy(visible, (c) => c.group)).map(([group, entries]) => (
          <Command.Group key={group} heading={m[`command_group_${group}` as const]()}>
            {entries!.map((entry) => (
              <Command.Item key={entry.id} onSelect={() => entry.run({ navigate })}>
                <entry.icon className="size-4" />
                {m[entry.labelKey]()}
                {entry.shortcut && <Kbd>{entry.shortcut}</Kbd>}
              </Command.Item>
            ))}
          </Command.Group>
        ))}
      </Command.List>
    </Command.Dialog>
  )
}
```

**Kanban card motion.** Motion 13.1.1 (2026-08-18) improved React 19 strict-mode compatibility and continued the layout-animation work from the 12.x line — axis-locked `layout="x"`/`"y"` animations and `animateView()` for View-Transitions-backed page transitions ([motion.dev/changelog](https://motion.dev/changelog?lib=motion)). The classic `layoutId` trick is what makes a card moved from one kanban column's array to another's animate as a single continuous move rather than a delete-and-insert:

```tsx
<LayoutGroup>
  {columns.map((col) => (
    <div key={col.id} className="kanban-column">
      <AnimatePresence>
        {col.cards.map((card) => (
          <motion.div
            key={card.id}
            layoutId={card.id}
            layout
            transition={{ type: 'spring', stiffness: 500, damping: 40 }}
            className="kanban-card"
          >
            {card.title}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  ))}
</LayoutGroup>
```

Because `layoutId` is stable across the whole `LayoutGroup` regardless of which column's array currently contains the card, Motion computes the FLIP transform across the DOM re-parent automatically — no manual position math. Wrap the whole board in `useReducedMotion()`-gated logic so `prefers-reduced-motion` users get an instant snap instead of the spring.

## 13. App shell architecture: sidebar, palette, inbox, detail panel

The Linear/Height-style shell this project is explicitly modeling has four load-bearing regions, each with its own state concern:

- **Sidebar** (persistent nav + counts): local UI state only (collapsed/expanded), belongs in a small Zustand slice per `frontend-architecture-and-sync.md` — never in the URL or server cache.
- **Command palette** (§12): global keyboard-triggered overlay, mounted once at the app root, state is just `open: boolean` plus the registry above.
- **Inbox drawer** (notifications): a slide-over fed by a TanStack Query subscription (poll or SSE per `frontend-architecture-and-sync.md` §4), with its own unread-count badge synced into the sidebar.
- **Right-side detail panel**: routed, not modal-state — the panel's content (a task, a person) is a real TanStack Router route segment (`/tasks/$taskId` rendered inside a persistent layout route) so it is bookmarkable, back-button-correct, and (per §3) kept mounted-but-hidden via `<Activity>` between opens for instant reopen.

Keeping the detail panel *routed* rather than a component-local `useState<string | null>` is the single highest-leverage architecture decision here: it makes "share a link to this specific task" and "browser back closes the panel" free, and it is what lets `loader`/`loaderDeps` (§4) prefetch the panel's data before the open animation even starts.

## 14. URL-as-state for filters and views

Already demonstrated in §4's `validateSearch`, generalized: every list view's filter/sort/group/view-mode state is a Zod-validated search-param object, never component state. This gives us, for free: shareable filtered views ("here are all overdue tasks assigned to me" is a URL a manager can paste into a chat), correct browser back/forward, and a natural persistence boundary — TanStack Router's search params round-trip through `sessionStorage`/bookmarks without any custom code, whereas a `useState`-based filter panel loses its state on refresh and can't be shared at all.

## 15. Keyboard shortcut system

**react-hotkeys-hook** (MIT, `useHotkeys('cmd+k', handler)`) is the pragmatic default — declarative, scoped per-component (so a shortcut only fires while its owning view is mounted, which matters once the detail panel and the main list both want distinct `Escape` behaviour), and it composes cleanly with the command registry: every `commandRegistry` entry with a `shortcut` field registers itself once at the shell root ([github.com/JohannesKlauss/react-hotkeys-hook](https://github.com/JohannesKlauss/react-hotkeys-hook)):

```tsx
function GlobalShortcuts() {
  const navigate = useNavigate()
  commandRegistry.forEach((entry) => {
    // eslint-disable-next-line react-hooks/rules-of-hooks -- registry is a static, load-time-fixed array
    useHotkeys(entry.shortcut ?? '', () => entry.run({ navigate }), { enabled: !!entry.shortcut })
  })
  return null
}
```

(In practice, register this via a single `useHotkeys` call with a combined key map rather than one hook call per entry in a loop, to keep the rules-of-hooks linter happy — the snippet above shows the *intent*; the production version builds one `{ [combo]: handler }` object and calls `useHotkeysMap` once, or falls back to a manual `keydown` listener keyed off `commandRegistry` if that helper isn't available in the pinned version.) The two-key chords used above (`g p`, `c t` — "go to people," "create task") follow Linear's own convention and need a small sequence-buffer (a 600ms window between the two keydowns) that react-hotkeys-hook supports via its sequence syntax.

## 16. Accessibility primitives: React Aria vs Radix/Base UI

React Aria (Adobe) ships **hooks**, not styled components — `useButton`, `useDialog`, `useCombobox` — giving maximum control over markup at the cost of writing more of the DOM structure yourself; it explicitly supports over 50 components, 30+ languages with localized formatting, and multiple calendar systems ([react-aria.adobe.com](https://react-aria.adobe.com/)), which matters if a future feature needs a genuinely non-Gregorian calendar (unlikely here, since Uzbekistan's civil calendar is Gregorian, but relevant if this ever ships to a market that isn't). Radix/Base UI ship pre-composed **parts** (`Popover.Root`/`Popover.Trigger`/`Popover.Popup`) — less DOM control, faster to assemble a design system from. Since shadcn/ui (our chosen component foundation per `frontend-architecture-and-sync.md`) is built on Radix/Base UI, **the practical decision is already made**: use Radix/Base UI's accessibility floor for every standard control, and reach for React Aria's hooks only for one-off widgets neither primitive set covers well (a multi-calendar date picker, a rich combobox with async-loaded, grouped, virtualized options) — don't run both as parallel general-purpose libraries in one codebase.

## 17. Form autosave patterns

Two shapes cover everything in this product: **field-level autosave** (a single input, like the inline-edit table cell in §6 — commit on blur, cancel on Escape, no explicit Save button) and **form-level autosave** (a multi-field editor, like a task's description and metadata, where committing per-keystroke would spam the API). For the latter, debounce the TanStack Form `onChange` validator's *side effect* (not the validation itself) and show an explicit, honest status affordance rather than a fake instant "Saved":

```tsx
const form = useForm({ defaultValues: task, validators: { onChange: taskSchema } })
const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')

useEffect(() => {
  const unsubscribe = form.store.subscribe(() => {
    if (!form.state.isDirty || !form.state.isValid) return
    setStatus('saving')
    debouncedSave(form.state.values).then(
      () => setStatus('saved'),
      () => setStatus('error'),
    )
  })
  return unsubscribe
}, [])
```

Never let autosave hide a real failure — an `error` status must be as visible as `saving`/`saved`, per the reference audit's "never a silent failure" principle already established for offline writes (§18).

## 18. Offline read-cache + write-queue with visible sync

Per `frontend-architecture-and-sync.md`, we are not adopting a local-first sync engine for v1 — this section is the concrete implementation of "offline tolerance without one." Reads: `@tanstack/query-sync-storage-persister` + `persistQueryClient` snapshot the whole `QueryClient` cache to `localStorage` (or IndexedDB via a custom persister for larger caches) on every settle, and rehydrate before first paint, so a reopened tab shows last-seen data immediately, then revalidates. Writes: TanStack Query's mutation cache is itself a queue — `resumePausedMutations()` replays anything queued while `navigator.onLine` was false, and `useMutationState({ filters: { status: 'pending' } })` is what drives a literal, honest **"3 changes pending sync"** indicator in the shell's status bar:

```tsx
function PendingSyncBadge() {
  const pending = useMutationState({ filters: { status: 'pending' } })
  if (pending.length === 0) return null
  return <Badge variant="muted">{m.sync_pending({ count: pending.length })}</Badge>
}

// on regaining connectivity
window.addEventListener('online', () => queryClient.resumePausedMutations())
```

Show the optimistic value immediately (per §5) with a subtle "unconfirmed" affordance (a dot, an italicized value) until the mutation actually settles — never claim a write succeeded before the server confirms it, and never leave a stalled queue invisible.

## 19. Performance budgets, code splitting, bundle analysis

Budget: ~200KB gzipped for the initial shell (per `frontend-architecture-and-sync.md`), enforced, not aspirational — `size-limit` (ai/size-limit) as a CI gate with its GitHub Action posting the bundle-size diff as a PR comment, and `vite-bundle-visualizer` as the on-demand local diagnostic for *why* a PR blew the budget. Route-level code splitting is native to TanStack Router's file-based routes (each route file becomes its own chunk automatically when using the Vite plugin's code-splitting mode); the one thing to actively split further is any route that pulls in Motion, a chart library, or a rich-text editor — none of those belong in the initial shell bundle.

## 20. Error boundaries and Sentry

Every route needs a route-level error boundary (`errorComponent` on the TanStack Router route definition) distinct from the global app-crash boundary — a failed task load should show "couldn't load this task, try again" inline, not blank the whole app. Report both to a self-hosted, in-country Sentry-protocol collector (Sentry itself or the lighter GlitchTip, per the data-localization argument already made in `frontend-architecture-and-sync.md`); the React 19 integration is the standard `Sentry.ErrorBoundary` wrapping `<Activity>`-managed panels individually, so one panel crashing doesn't take down the sidebar or the other open panel.

## 21. i18n pluralisation in practice: Uzbek and Russian

Concretely, three things a translator handoff gets wrong if not designed for up front, all solved by Paraglide's `Intl.PluralRules`-backed variants (§10): (1) Russian's four-category system (one/few/many/other — "1 проект / 2 проекта / 5 проектов") demands all four keys be filled even though English only needs two; a partially-filled `match` block should fail CI, not silently fall back to `other` for every count. (2) Uzbek's single-category system means a translator asked to "fill in the plural forms" for Uzbek should be told explicitly that one string is correct and complete — otherwise they'll either invent a fake plural distinction or leave the field blank assuming it's unfinished. (3) Ordinals (1st/2nd/3rd-style, relevant for "3rd escalation" wording) use a *different* `Intl.PluralRules` mode (`type: 'ordinal'`) from cardinals (`type: 'cardinal'`, the default) — don't reuse a cardinal plural key for ordinal text.

## 22. Uzbek glyphs in fonts: Inter, Golos Text, Manrope

The companion report `design-systems-craft-and-motion.md` already selected **Inter** as the default UI typeface (SIL OFL, confirmed Cyrillic coverage, "147 languages") but explicitly flagged as an **open, unresolved item**: whether Inter correctly renders the two Uzbek-specific modifier letters — `oʻ`/`Oʻ` (U+02BB MODIFIER LETTER TURNED COMMA) and `gʻ`/`Gʻ` (U+02BC MODIFIER LETTER APOSTROPHE, the *tutuq belgisi*) — at UI body-text sizes on target Windows 10/11 desktops, rather than falling back to tofu or a visually-wrong straight apostrophe. This report attempted to independently verify **Golos Text** and **Manrope** (the two additional candidates named in this dimension's brief) against the same question via their Google Fonts specimen pages, and **could not** — Google Fonts' specimen pages render their language/glyph-coverage data client-side via JavaScript, which a text-mode fetch does not execute, so no character-support claim for either font could be confirmed or denied this session. This is the same category of gap the earlier report hit with Loro and Triplit: flagged as unverified rather than guessed at.

**What this means concretely:** before any production content is entered in Uzbek at scale, do the direct test the prior report already prescribed — open each candidate font (Inter, Golos Text, Manrope) in a real browser on a real Windows 10/11 machine, render the string `Oʻzbekiston respublikasi — gʻalati soʻz` at 14–16px, and visually confirm the modifier letters render as small raised comma/apostrophe marks (not tofu, not a full-height straight quote `'`). Separately, decide a **normalization strategy** now, before it's a data-migration problem: civil servants typing Uzbek text will very likely use the straight apostrophe key (U+0027) or the Cyrillic-adjacent right single quote (U+2019) instead of the correct Unicode modifier letters, since most keyboards don't have a dedicated key for them — pick one canonical codepoint, normalize on input (or at least on save), and never let three different glyphs for "the same letter" coexist silently in stored names and titles.

## 23. Testing hooks for components

- **Vitest** + **Testing Library** for unit/component tests, querying by accessible role/label (which doubles as a first-pass accessibility check, per `frontend-architecture-and-sync.md`'s gap-fill on `vitest-axe`).
- Every interactive component built against Base UI/Radix should expose the library's own `data-*` state attributes (`data-state="open"`, `data-disabled`) as the primary test/query hook instead of custom `data-testid`s where possible — it keeps tests honest about actual rendered state rather than an implementation detail.
- For the optimistic-mutation pattern in §5, test the `onError` rollback path explicitly with **MSW** returning a failure — this is the single most-skipped test case in every optimistic-UI codebase, and the one that actually protects the "never claim success before the server confirms" rule from regressing.
- **Playwright** end-to-end coverage for the three things this whole report is really in service of: opening the command palette and running a command by keyboard only, moving a kanban card between columns and confirming the position persists after reload, and going offline mid-edit and confirming the pending-sync badge appears and the change survives reconnect.

## What this means for us

1. **[ADOPT] TanStack Table v9 as the target, but pin the exact version and expect to hand-correct v8-shaped code** from tutorials/AI output during the next several months — it stable-shipped five weeks before this report and the ecosystem hasn't caught up to the renamed hooks yet.
2. **[ADOPT] Pin exact versions (no `^`/`~`) for every `@tanstack/*` package and enable npm provenance/signature checks in CI**, directly because of the May 2026 Router/Start supply-chain compromise — the response was fast and the core packages (Query/Table/Form/Virtual) were untouched, but exact pinning plus a human-reviewed update PR is now the correct default for this dependency family specifically.
3. **[ADOPT] `validateSearch` + `loaderDeps` for every filterable list view** (Projects register, People directory) — makes filtered views shareable URLs and gets loader prefetching for free; do not build a parallel client-state filter store.
4. **[ADOPT] The `context.client`-based optimistic-mutation pattern (§5)** as the one shape every write in the app follows — cancel, snapshot, optimistic-set, rollback-on-error, invalidate-on-settle — rather than ad hoc per-mutation state handling.
5. **[ADAPT] Base UI as the default new-component primitive (matches shadcn's own July 2026 default), keep any existing Radix-based component as-is** — this is not a migration, it's a going-forward default; both coexist fine since shadcn copies source rather than installing a runtime dependency.
6. **[AVOID] `z.interface()` — it does not exist in Zod 4.5.x.** Use `.exactOptional()` on `z.object()` fields for the `exactOptionalPropertyTypes` use case instead; don't let a stale assumption from planning docs make it into actual code.
7. **[ADOPT] `z.compile()` / `z.validate()` for hot-path schemas** (the Projects register's inline-edit cells, any per-keystroke validity check) once profiling shows Zod parsing on the critical path — not a default everywhere, since the ergonomic cost (an extra build step per schema) isn't worth it for one-shot form submissions.
8. **[ADOPT] Tailwind v4 CSS-variable tokens with a `data-tenant` attribute for per-ministry theming** (§8) — the same compiled CSS serves every tenant; only the root attribute changes, which is the cheapest possible multi-tenant theming mechanism as this spreads across ministries.
9. **[ADOPT] A routed (not component-state) right-side detail panel, kept mounted via `<Activity mode="hidden">` between opens** — bookmarkable, back-button-correct, and instant on reopen, for free.
10. **[ADOPT] Paraglide's `Intl.PluralRules`-backed variants for every countable string**, with an explicit CI check that Russian's `match` blocks have all four categories filled and a documented note that Uzbek legitimately needs only one — prevents both the "forgot a plural form" and "invented a fake plural form" failure modes.
11. **[ADAPT] The command-registry pattern (§12) as the single source of truth for both the command palette and keyboard shortcuts** — every entry with a `shortcut` field self-registers with react-hotkeys-hook at the shell root, so palette and hotkeys never drift out of sync with each other.
12. **[ADOPT] `layoutId`-based Motion layout animation for any card/item that moves between containers** (kanban columns today, potentially a future board/swimlane view) — gated behind `useReducedMotion()` so it degrades to an instant snap.
13. **[AVOID] Adopting React Aria as a second general-purpose component library alongside Radix/Base UI.** Use its hooks only for the rare widget neither primitive set covers well (a genuinely complex async/virtualized combobox); running two accessibility-primitive philosophies as parallel defaults is a maintenance cost with no offsetting benefit here.
14. **[ADAPT] Direct, in-browser glyph verification of Inter, Golos Text, and Manrope for `Oʻ`/`Gʻ`/tutuq belgisi rendering before any production Uzbek content entry** — this report could not verify Golos Text's or Manrope's character coverage (Google Fonts' specimen pages are JS-rendered and returned no data to a text fetch); treat all three as unverified for this specific requirement until someone opens them in a real browser on the target OS.
15. **[ADOPT] `size-limit` in CI plus `vite-bundle-visualizer` on demand**, and enforce the ~200KB gzipped shell budget as a failing check, not a written-down aspiration — matches the enforcement gap already flagged in the companion frontend-architecture report.

## Open questions

- **Golos Text and Manrope's actual Uzbek modifier-letter glyph coverage** could not be verified this session (Google Fonts specimen pages render language/character data client-side; a text-mode fetch returned only the page title). Needs a direct in-browser check before font selection is finalized — this is the same open item the companion design-systems report already flagged for Inter, now extended to the other two named candidates.
- **Whether to adopt Base UI or Radix as the primary primitive is now shadcn's decision, not really ours** — since shadcn defaults new components to Base UI as of July 2026, the practical question is only whether to proactively migrate the handful of Radix-based components that predate this research, which depends on how much UI exists by the time this is read.
- **TanStack Table v9's real-world stability** one month post-GA is unverified by anyone outside TanStack's own announcement and one InfoQ writeup; worth a short internal spike building the Projects register against it before committing fully, with a fallback plan to pin v8 if a launch-blocking bug surfaces in the first few months.
- **The exact current npm-published version numbers for `@tanstack/react-query` and `@tanstack/react-router`** could not be pinned down precisely this session (npmjs.com blocked automated fetches with HTTP 403); confirm exact versions at actual `pnpm add` time rather than trusting the approximate figures in §1's table.
- **Motion's bundle size** was not found published anywhere fetched this session (historically Framer Motion was often criticized for being large before the `LazyMotion`/`m` split); measure it directly with `size-limit` once it's actually in the bundle rather than assuming a figure.

## Sources

- [Vite 7.0 announcement](https://vite.dev/blog/announcing-vite7)
- [Vite 8.0 announcement](https://vite.dev/blog/announcing-vite8)
- [Vite migration guide](https://vite.dev/guide/migration)
- [React blog index](https://react.dev/blog)
- [React 19.2 release notes](https://react.dev/blog/2025/10/01/react-19-2)
- [TanStack Router — search params guide](https://tanstack.com/router/latest/docs/guide/search-params)
- [TanStack Query v5 — optimistic updates guide](https://tanstack.com/query/latest/docs/framework/react/guides/optimistic-updates)
- [TanStack Query v5 — persistQueryClient plugin](https://tanstack.com/query/v5/docs/react/plugins/persistQueryClient)
- [TanStack — announcing Table v9](https://tanstack.com/blog/announcing-tanstack-table-v9)
- [TanStack Table — migrating to v9](https://tanstack.com/table/latest/docs/framework/react/guide/migrating)
- [TanStack — announcing Form v1](https://tanstack.com/blog/announcing-tanstack-form-v1)
- [TanStack — npm supply-chain compromise postmortem](https://tanstack.com/blog/npm-supply-chain-compromise-postmortem)
- [TanStack — hardening follow-up](https://tanstack.com/blog/incident-followup)
- [@tanstack/react-virtual (npm)](https://www.npmjs.com/package/@tanstack/react-virtual)
- [@tanstack/virtual-core (npm)](https://www.npmjs.com/package/@tanstack/virtual-core)
- [Tailwind CSS v4.0 announcement](https://tailwindcss.com/blog/tailwindcss-v4)
- [shadcn/ui changelog index](https://ui.shadcn.com/docs/changelog)
- [shadcn/ui — Base UI as the default (July 2026)](https://ui.shadcn.com/docs/changelog/2026-07-base-ui-default)
- [shadcn/ui — CLI v4 (March 2026)](https://ui.shadcn.com/docs/changelog/2026-03-cli-v4)
- [shadcn/ui — Base UI documentation (January 2026)](https://ui.shadcn.com/docs/changelog/2026-01-base-ui)
- [Base UI — quick start](https://base-ui.com/react/overview/quick-start)
- [Paraglide JS](https://paraglidejs.com/)
- [Paraglide JS — changelog](https://paraglidejs.com/changelog)
- [Paraglide JS (GitHub)](https://github.com/opral/paraglide-js)
- [date-fns v4.0 — time zone support announcement](https://blog.date-fns.org/v40-with-time-zone-support/)
- [date-fns releases (GitHub)](https://github.com/date-fns/date-fns/releases)
- [Zod v4 release notes](https://zod.dev/v4)
- [Zod API reference](https://zod.dev/api)
- [Zod releases (GitHub)](https://github.com/colinhacks/zod/releases)
- [cmdk (GitHub)](https://github.com/pacocoursey/cmdk)
- [react-hotkeys-hook (GitHub)](https://github.com/JohannesKlauss/react-hotkeys-hook)
- [React Aria](https://react-aria.adobe.com/)
- [Motion — changelog](https://motion.dev/changelog?lib=motion)
- [Motion](https://motion.dev/)
- [Frontend architecture and sync (internal, this project)](./frontend-architecture-and-sync.md)
- [Design systems, craft and motion (internal, this project)](./design-systems-craft-and-motion.md)

*Methodology note: this session's shared WebSearch quota was exhausted (200/200) partway through research, after 15 completed queries; the remaining fact-gathering (cmdk size/license, react-hotkeys-hook usage, React Aria positioning, Zod's `z.interface()` verification, the Google Fonts glyph check) relied on direct WebFetch of primary sources instead, consistent with how other reports in this research set handled the same shared-budget constraint. `npmjs.com` blocked three direct package-page fetches with HTTP 403 (react-query, react-router, cmdk version pages); those exact current version numbers should be re-confirmed at install time rather than trusted from this report's approximate figures. Google Fonts' specimen pages for Golos Text and Manrope render language/glyph data client-side and returned no usable content to a text-mode fetch — flagged as unverified in §22 and the open questions rather than guessed at.*
