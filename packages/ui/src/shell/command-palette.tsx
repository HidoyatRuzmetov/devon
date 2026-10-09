import * as React from 'react'
import { Command, useCommandState } from 'cmdk'
import { CornerDownLeft, Search } from 'lucide-react'
import { Dialog, DialogContent } from '../primitives/dialog.js'
import { Sheet, SheetContent } from '../primitives/sheet.js'
import { Skeleton } from '../primitives/skeleton.js'
import { Button } from '../primitives/button.js'
import { Kbd } from '../primitives/kbd.js'
import { comboboxScore } from '../primitives/combobox.js'
import { cn } from '../lib/cn.js'
import { motion } from 'motion/react'
import { useReducedMotion } from '../lib/use-reduced-motion.js'
import { springSettle } from '../motion/tokens.js'
import { Stagger, StaggerItem } from '../motion/stagger.js'

export interface CommandPaletteItem {
  id: string
  label: string
  icon?: React.ComponentType<React.SVGProps<SVGSVGElement>>
  /** Rendered under the label instead of the one-line layout, for a row that genuinely carries a
   * second line -- a search snippet, an excerpt. Used by the semantic-search section; a plain
   * navigation row never sets it. */
  description?: string
  /** Small text badge before the label, e.g. the kind of record a search hit is ("Vazifa"). */
  badge?: string
  /** Opt out of cmdk's client-side fuzzy filter for this row: the server already decided it matches
   * the query, and re-scoring a snippet against the same query only ever removes real hits. */
  alwaysVisible?: boolean
  /** Right-aligned context under Raycast's convention: the section a result belongs to, a person's
   * unit, a card's column. Never a second line -- palette rows stay one line tall. */
  hint?: string
  /** Keycap shown at the right edge, e.g. `G H`. */
  shortcut?: string
  /** Extra words this item should match on that are not in its label (a login, a card number, an
   * English synonym for an Uzbek label). */
  keywords?: readonly string[]
  onSelect: () => void
}

export interface CommandPaletteGroup {
  heading: string
  items: readonly CommandPaletteItem[]
}

export interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Controlled callers capture the opener before opening (including keyboard shortcuts). */
  onCloseAutoFocus?: (event: Event) => void
  /** Accessible name, e.g. `t('search.aria')` = "Qidirish va amallar" -- not shown visually
   * (spec.md §5: the palette's own structure starts with the input, no heading above it). */
  title: string
  placeholder: string
  emptyMessage: string
  emptyActionLabel: string
  onEmptyAction: () => void
  /** "↑↓ tanlash · ↵ ochish · Esc yopish" (spec.md §5, §9.2 `cmd.hint`). */
  hint: string
  groups: readonly CommandPaletteGroup[]
  /** spec.md §5: "Loading (nested async pages): three 40px skeleton rows, never a spinner." */
  loading?: boolean
  /** Controlled search text. Supply both this and `onQueryChange` when the caller needs to *see*
   * what was typed -- the semantic-search section (SPEC §8, HANDOFFS #2) queries the server with it.
   * Omit both and the input stays uncontrolled exactly as before. */
  query?: string
  onQueryChange?: (value: string) => void
  /** >=768 centred dialog vs. 390 bottom sheet (spec.md §5). The breakpoint decision belongs to the
   * caller (`apps/web`) -- this package does not sniff viewport width. */
  variant?: 'dialog' | 'sheet'
  /** Label for the "Enter to open" affordance in the footer. */
  openHintLabel?: string
}

const GROUP_HEADING_CLASS =
  '[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-3 ' +
  '[&_[cmdk-group-heading]]:text-eyebrow [&_[cmdk-group-heading]]:uppercase ' +
  '[&_[cmdk-group-heading]]:tracking-(--text-eyebrow--letter-spacing) ' +
  '[&_[cmdk-group-heading]]:text-muted-foreground'

/**
 * cmdk keys its selection on an item's `value`, not on its React key -- so two rows that happen to
 * share a label are ONE value to cmdk, and both render highlighted and both fire on Enter. That is
 * exactly what WALKTHROUGH-FINDINGS 2.3 caught: "Boʻlimlar" and "AI" each appear twice in the
 * default palette (once under Recent, once under Go to) and both copies lit up together.
 *
 * The value therefore has to be unique, while still being the text cmdk's fuzzy filter scores
 * against -- so the label leads (and the keywords follow), and a disambiguating suffix is appended
 * only to the second and later occurrences of a label. A first occurrence is unchanged, which keeps
 * scoring identical to before for every palette that has no duplicates at all.
 */
function uniqueValue(
  item: { id: string; label: string; keywords?: readonly string[] },
  seen: Map<string, number>,
): string {
  // Trimmed because cmdk trims a `value` before it stores it (`dist/index.mjs`, `useValue`) -- an
  // untrimmed value here would never `===` the `state.value` that `PaletteCursor` compares against.
  const base = [item.label, ...(item.keywords ?? [])].join(' ').trim()
  const count = seen.get(base) ?? 0
  seen.set(base, count + 1)
  return count === 0 ? base : `${base} \u200b${count}`
}

/** The one moving part of the palette's selection (motion verdict F1).
 *
 * The previous shape rendered this pill inside *every* row and hid all but one with
 * `hidden group-data-[selected=true]:block`. `display:none` is not unmounting: all 66 `motion.span`s
 * carried the same `layoutId` and were mounted at once, so framer-motion's shared layout had no
 * unmount -> mount pair to FLIP between, silently degraded to an instant 44 px jump, and still paid
 * for 66 projection nodes on every open.
 *
 * So the row asks cmdk who is selected and mounts the pill *only* in the winning row -- exactly one
 * node with this `layoutId` at any moment, which is the precondition shared layout has always had,
 * and the same device the sidebar and the tab strip use (DESIGN.md §8, §10).
 *
 * It is its own component on purpose: this subscription is the only thing that re-renders when the
 * selection moves, so an ArrowDown re-renders N near-empty cursors instead of N full rows. */
function PaletteCursor({
  value,
  cursorId,
  reduced,
}: {
  value: string
  cursorId: string
  reduced: boolean
}): React.JSX.Element | null {
  const selected = useCommandState((state) => state.value === value)
  if (!selected) return null
  return (
    <span aria-hidden="true" className="absolute inset-0 -z-10 rounded-sm">
      {reduced ? (
        <span className="block size-full rounded-sm bg-accent" />
      ) : (
        <motion.span
          layoutId={`${cursorId}-cursor`}
          className="block size-full rounded-sm bg-accent"
          transition={springSettle}
        />
      )}
    </span>
  )
}

/** One palette row. `React.memo` because `Command.Item` itself subscribes to cmdk's store for its
 * own `aria-selected`, so it re-renders on every ArrowDown -- memoising the row body means that
 * re-render reconciles one identical element instead of rebuilding the icon tile, the label, the
 * hint, the keycap and the "↵" affordance for all 66 rows (verdict F2). */
const PaletteRow = React.memo(function PaletteRow({
  item,
  value,
  cursorId,
  reduced,
  openHintLabel,
}: {
  item: CommandPaletteItem
  value: string
  cursorId: string
  reduced: boolean
  openHintLabel?: string | undefined
}) {
  return (
    <Command.Item
      value={value}
      {...(item.alwaysVisible ? { forceMount: true } : {})}
      onSelect={item.onSelect}
      className={cn(
        'group relative isolate flex min-h-11 cursor-pointer items-center gap-3 rounded-sm px-3 py-1.5 text-body text-foreground',
        // No `data-[selected=true]:bg-accent` any more: the fill is the gliding pill above, and
        // painting both meant the old row stayed lit for the length of the glide. Reduced motion
        // renders the pill without the shared layout, i.e. it appears under the selected row --
        // identical to the tint it replaces.
        'transition-colors duration-(--dur-micro)',
      )}
    >
      <PaletteCursor value={value} cursorId={cursorId} reduced={reduced} />
      {item.icon ? (
        <span className="flex size-7 shrink-0 items-center justify-center rounded-sm bg-muted text-muted-foreground group-data-[selected=true]:bg-card group-data-[selected=true]:text-foreground">
          <item.icon className="size-4" aria-hidden="true" />
        </span>
      ) : null}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-2">
          {item.badge ? (
            <span
              data-shell-label
              className="shrink-0 rounded-xs bg-muted px-1.5 py-0.5 text-caption text-muted-foreground"
            >
              {item.badge}
            </span>
          ) : null}
          {/* No `truncate`: design.md §3.5 forbids ellipsis in the shell, and the
              `devon/no-shell-truncate` lint rule enforces it here. A long row label wraps, which is
              what that rule asks for. */}
          <span data-shell-label className="min-w-0 flex-1">
            {item.label}
          </span>
        </span>
        {item.description ? (
          <span data-shell-label className="line-clamp-1 text-caption text-muted-foreground">
            {item.description}
          </span>
        ) : null}
      </span>
      {item.hint ? (
        <span data-shell-label className="shrink-0 text-caption text-muted-foreground">
          {item.hint}
        </span>
      ) : null}
      {item.shortcut ? <Kbd className="shrink-0">{item.shortcut}</Kbd> : null}
      {openHintLabel ? (
        <span className="hidden shrink-0 items-center gap-1 text-caption text-muted-foreground group-data-[selected=true]:flex">
          <span data-shell-label>{openHintLabel}</span>
          <CornerDownLeft className="size-3" aria-hidden="true" />
        </span>
      ) : null}
    </Command.Item>
  )
})

function CommandPaletteBody({
  placeholder,
  emptyMessage,
  emptyActionLabel,
  onEmptyAction,
  hint,
  groups,
  loading,
  openHintLabel,
  query,
  onQueryChange,
}: Omit<CommandPaletteProps, 'open' | 'onOpenChange' | 'title' | 'variant'>) {
  const reduced = useReducedMotion()
  // The cursor is one object moving between rows (a shared `layoutId`), the same device the sidebar
  // and the tab strip use -- so the palette's selection reads as the *same* mechanism the rest of
  // the shell uses, which is the whole point of a Jakob's-Law map (DESIGN.md §8).
  const cursorId = React.useId()
  // Verdict F2: the value pass runs once per *group list*, not once per render. It is walked in
  // render order so the "first occurrence keeps the plain value" disambiguation rule stays stable,
  // and the resulting rows are referentially stable, which is what lets `PaletteRow`'s `React.memo`
  // actually hold across a selection change.
  const valuedGroups = React.useMemo(() => {
    const seen = new Map<string, number>()
    return groups.map((group) => ({
      heading: group.heading,
      forceMount: group.items.some((item) => item.alwaysVisible),
      rows: group.items.map((item) => ({ item, value: uniqueValue(item, seen) })),
    }))
  }, [groups])
  return (
    <Command
      shouldFilter
      // The same Uzbek-apostrophe- and Cyrillic-aware scorer the Combobox uses, so "o'tish" finds
      // "Oʻtish" here exactly as it does in a person picker.
      filter={comboboxScore}
      loop
      className="flex h-full flex-col"
    >
      <div className="flex items-center gap-2 border-b border-border px-3">
        <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <Command.Input
          placeholder={placeholder}
          {...(onQueryChange ? { value: query ?? '', onValueChange: onQueryChange } : {})}
          className="h-13 w-full border-0 bg-transparent text-lead text-foreground outline-none placeholder:text-muted-foreground"
        />
      </div>
      <Command.List className="flex-1 overflow-y-auto p-1.5">
        {loading ? (
          <div className="flex flex-col gap-1 p-2" aria-hidden="true">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : (
          <>
            <Command.Empty className="flex flex-col items-center gap-3 p-10 text-center">
              <span data-shell-label className="text-body text-muted-foreground">
                {emptyMessage}
              </span>
              <Button data-primary size="sm" variant="secondary" onClick={onEmptyAction}>
                <span data-shell-label>{emptyActionLabel}</span>
              </Button>
            </Command.Empty>
            {/* DESIGN.md §10, "Command palette ... results re-stagger on query" -- read against
                §2.5, "repeated actions (palette open, row select) animate at `--dur-micro` or not at
                all". Re-staggering on every keystroke would satisfy the first rule by breaking the
                second: the rows a person is *reading while they type* would re-enter under their
                eyes six times a word, and `<Stagger animateKey>` re-keys its container, so each of
                those would remount every cmdk row and reset the selection with it.
                So the stagger fires on the *mode* change instead -- the one moment the list is
                genuinely a different list: default sections (Recent / Go to / Actions) becoming
                search results, and back again. At most twice per visit to the palette, never under
                the typing hand. */}
            <Stagger animateKey={query ? 'results' : 'sections'} delay={0}>
              {valuedGroups.map((group) => (
                <StaggerItem key={`stagger-${group.heading}`}>
                  <Command.Group
                    key={group.heading}
                    heading={<span data-shell-label>{group.heading}</span>}
                    // cmdk hides a whole group whose items all score zero against the typed text, and
                    // `forceMount` on an item does not rescue it from that -- the group has to be
                    // mounted too. A group of server-matched rows (the semantic-search section) would
                    // otherwise be filtered away by the client using the very query the server just
                    // answered, which is how that section rendered nothing at all the first time.
                    {...(group.forceMount ? { forceMount: true } : {})}
                    className={GROUP_HEADING_CLASS}
                  >
                    {group.rows.map(({ item, value }) => (
                      <PaletteRow
                        key={item.id}
                        item={item}
                        value={value}
                        cursorId={cursorId}
                        reduced={reduced}
                        openHintLabel={openHintLabel}
                      />
                    ))}
                  </Command.Group>
                </StaggerItem>
              ))}
            </Stagger>
          </>
        )}
      </Command.List>
      <div
        data-shell-label
        className="flex items-center justify-between gap-3 border-t border-border bg-muted/40 px-4 py-2 text-caption text-muted-foreground"
      >
        {hint}
      </div>
    </Command>
  )
}

/** design.md §3 CommandPalette / spec.md §5, restyled to UI-OVERHAUL.md §2 row 2 (Raycast, Linear):
 * sections with small-caps headings, an icon tile per row, right-aligned hints and keycaps, and an
 * "↵" affordance on the highlighted row.
 *
 * The *sources* it filters over are still wired by `apps/web` via the `groups` prop -- this package
 * ships no navigation, no routing and no fetch. */
export function CommandPalette({
  open,
  onOpenChange,
  onCloseAutoFocus,
  title,
  variant = 'dialog',
  ...body
}: CommandPaletteProps) {
  if (variant === 'sheet') {
    return (
      <Sheet direction="bottom" open={open} onOpenChange={onOpenChange} autoFocus>
        <SheetContent
          title={title}
          side="bottom"
          className="flex h-[70vh] flex-col p-0"
          onCloseAutoFocus={onCloseAutoFocus}
        >
          {/* Verdict F2: the list is built only while the palette is actually open, never kept warm
              behind a closed overlay -- so a Ctrl/Cmd+K costs one mount, and a route change while the
              palette is shut costs nothing at all. */}
          {open ? <CommandPaletteBody {...body} /> : null}
        </SheetContent>
      </Sheet>
    )
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={title}
        onCloseAutoFocus={onCloseAutoFocus}
        titleHidden
        showClose={false}
        className="top-[12vh] flex h-125 max-h-[76vh] max-w-160 -translate-y-0 flex-col overflow-hidden p-0"
      >
        {/* See the sheet branch: mounted only while open. */}
        {open ? <CommandPaletteBody {...body} /> : null}
      </DialogContent>
    </Dialog>
  )
}
