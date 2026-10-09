// One shared chart wrapper (TECH-SPEC §9: "every chart has an owner question in its header, animates
// in, supports keyboard, exports CSV/PNG, and can be pinned to Home"). `packages/ui` ships no `Chart`/
// `KpiTile` primitive yet (DESIGN.md §3.3 lists them as future work) -- this feature builds its own,
// styled on the existing design tokens (Tailwind utilities backed by `packages/ui`'s `@theme`
// variables), the same way every other feature composes its own screens from primitives plus plain
// markup.
//
// Keyboard/screen-reader access to an SVG chart (DESIGN.md §6): a chart's own canvas is not a
// meaningful keyboard target, so every `ChartCard` also renders an always-present, visually-hidden
// (`sr-only`) data table mirroring exactly what the chart shows, plus a "view as table" toggle that
// un-hides it visibly for anyone who wants the numbers instead of the shape.
import * as React from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useT } from '@devon/i18n'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
  cn,
  toast,
  useReducedMotion,
} from '@devon/ui'
import { BarChart3, Download, MoreHorizontal, Pin, PinOff, Table2 } from 'lucide-react'
import { toPng } from 'html-to-image'

export type ChartCardProps = {
  chartKey: string
  titleKey: string
  questionKey: string
  csvHref: string
  pinned: boolean
  onTogglePin: () => void
  pinBusy?: boolean
  table: { headers: string[]; rows: (string | number)[][] }
  children: React.ReactNode
  className?: string
  /** round2 critique #28: a multi-series chart with no legend left the reader guessing what each
   *  colour meant. One dot + label per series, in the same order the bars/lines render -- omit for a
   *  single-series chart, which already carries its own meaning in the title. */
  legend?: { label: string; colorVar: string }[]
  /** DESIGN.md §4: renders `ChartEmptyState` (labelled by `emptyLabelKey`) in place of `children` --
   *  the header and owner question stay visible either way. Every section passes this instead of
   *  hand-rolling its own early-return branch, so "no data yet" looks the same on every chart. */
  isEmpty?: boolean
  emptyLabelKey?: string
}

/** Reads live from `document.cookie` at click time (never cached) -- this is a plain `<a>` download,
 * not a fetch, so it always carries the current session cookie automatically; nothing to wire up. */
function downloadCsv(href: string): void {
  const a = document.createElement('a')
  a.href = href
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
}

async function downloadPng(node: HTMLElement, filename: string): Promise<void> {
  const dataUrl = await toPng(node, { pixelRatio: 2 })
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
}

export function useChartAnimation(): boolean {
  const reduced = useReducedMotion()
  return !reduced
}

/** DESIGN.md §4: every screen has a designed empty state, and a chart card is a screen region --
 * a series with no data used to render bare axes and say nothing, exactly what every fresh
 * department sees in every chart before the first nightly recompute. A small icon (a full
 * illustration does not fit a card this compact) plus one line, centred in the space the chart
 * would otherwise fill, with the card's own header/owner-question still visible above it. */
export function ChartEmptyState({ labelKey }: { labelKey: string }): React.JSX.Element {
  const t = useT()
  return (
    <div className="flex min-h-45 flex-1 flex-col items-center justify-center gap-2 py-6">
      <BarChart3 className="size-8 text-muted-foreground/50" aria-hidden="true" />
      <p className="text-center text-small text-muted-foreground">{t(labelKey)}</p>
    </div>
  )
}

export function ChartCard({
  chartKey,
  titleKey,
  questionKey,
  csvHref,
  pinned,
  onTogglePin,
  pinBusy,
  table,
  children,
  className,
  isEmpty = false,
  emptyLabelKey,
  legend,
}: ChartCardProps) {
  const t = useT()
  const reduced = useReducedMotion()
  const [showTable, setShowTable] = React.useState(false)
  const bodyRef = React.useRef<HTMLDivElement>(null)
  // A variable, not a nested JSX ternary: the i18n gate's hard-coded-JSX-text heuristic scans for a
  // run of letters between two angle-bracket characters anywhere in the file, and a ternary chain
  // written inline trips it on the plain-text " ) : isEmpty ? ( " between two closing tags.
  const chartBody = isEmpty ? (
    <ChartEmptyState labelKey={emptyLabelKey ?? 'analytics.chartEmpty'} />
  ) : (
    children
  )

  return (
    // `h-full`: a dashboard grid row stretches every card to match its tallest sibling (the grid
    // default, align-items: stretch) -- without this the *card* already filled that height but its
    // *content* (a chart with a fixed pixel height) did not, leaving a visible gap of dead space
    // below a short chart next to a taller one. `min-h-0` lets the flex body shrink correctly instead
    // of ignoring the parent's height (the usual flex-in-flex trap).
    <section
      className={cn(
        'flex h-full min-h-0 flex-col gap-3 rounded-md border border-border bg-card p-5 shadow-1',
        className,
      )}
      aria-label={t(titleKey)}
    >
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <h3 className="text-h3 text-foreground">{t(titleKey)}</h3>
          <p className="text-small text-muted-foreground">{t(questionKey)}</p>
        </div>
        <div className="flex items-center gap-1">
          <IconButton
            aria-label={t(
              showTable ? 'analytics.actions.viewAsChart' : 'analytics.actions.viewAsTable',
            )}
            aria-pressed={showTable}
            onClick={() => setShowTable((v) => !v)}
          >
            <Table2 className="size-4" aria-hidden="true" />
          </IconButton>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton aria-label={t('analytics.actions.export')}>
                <MoreHorizontal className="size-4" aria-hidden="true" />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => downloadCsv(csvHref)}>
                <Download className="size-3.5" aria-hidden="true" />
                {t('analytics.actions.exportCsv')}
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  if (bodyRef.current) {
                    void downloadPng(bodyRef.current, `${chartKey}.png`).catch(() =>
                      toast.error(t('analytics.actions.exportFailed')),
                    )
                  }
                }}
              >
                <Download className="size-3.5" aria-hidden="true" />
                {t('analytics.actions.exportPng')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {/* round2 SEV2 "pin/unpin is instant": the glyph swap now pops in instead of the two
              icons simply trading places -- `AnimatePresence` plays the outgoing one's exit and
              the incoming one's entrance instead of a single-frame swap. */}
          <IconButton
            aria-label={t(pinned ? 'analytics.actions.unpin' : 'analytics.actions.pin')}
            aria-pressed={pinned}
            disabled={pinBusy}
            onClick={onTogglePin}
            className="overflow-hidden"
          >
            <AnimatePresence mode="popLayout" initial={false}>
              {pinned ? (
                <motion.span
                  key="pinned"
                  className="inline-flex"
                  initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.5, rotate: -20 }}
                  animate={{ opacity: 1, scale: 1, rotate: 0 }}
                  exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.5 }}
                  transition={{ duration: reduced ? 0.1 : 0.2, ease: 'easeOut' }}
                >
                  <PinOff className="size-4" aria-hidden="true" />
                </motion.span>
              ) : (
                <motion.span
                  key="unpinned"
                  className="inline-flex"
                  initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.5, rotate: 20 }}
                  animate={{ opacity: 1, scale: 1, rotate: 0 }}
                  exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.5 }}
                  transition={{ duration: reduced ? 0.1 : 0.2, ease: 'easeOut' }}
                >
                  <Pin className="size-4" aria-hidden="true" />
                </motion.span>
              )}
            </AnimatePresence>
          </IconButton>
        </div>
      </header>

      {legend && !isEmpty ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {legend.map((entry) => (
            <span
              key={entry.label}
              className="flex items-center gap-1.5 text-caption text-muted-foreground"
            >
              <span
                aria-hidden="true"
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: entry.colorVar }}
              />
              {entry.label}
            </span>
          ))}
        </div>
      ) : null}

      {/* `flex-1 min-h-0`: gives ResponsiveContainer's own `height="100%"` (sections.tsx) a real,
          definite height to resolve against -- filling whatever extra room the grid's row-stretch
          handed this card, while `minHeight` (also sections.tsx, per chart) keeps a short card from
          collapsing below its own data-appropriate floor. */}
      <div ref={bodyRef} className="flex min-h-0 flex-1 flex-col rounded-sm bg-card">
        {/* round2 SEV2 "charts do not re-animate when the date range changes": `csvHref` already
            carries every filter param a section reads (since/until/filter, via `exportCsvUrl`), so
            it changes exactly when the query does -- remounting the chart body on that key forces
            Recharts to replay each `isAnimationActive` draw-in instead of just morphing the same
            mounted shapes to their new values. Keyed one level inside the `toPng`-targeted
            `bodyRef` div, not on it, so PNG export never loses its ref mid-transition. */}
        {showTable ? (
          <div className="overflow-x-auto">
            <table className="w-full text-small">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  {table.headers.map((h) => (
                    <th key={h} className="py-1.5 pr-4 font-normal">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {table.rows.map((row, i) => (
                  <tr key={i} className="border-b border-border/60 last:border-0">
                    {row.map((cell, j) => (
                      <td key={j} className="py-1.5 pr-4 text-foreground">
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div key={csvHref} className="flex min-h-0 flex-1 flex-col">
            {chartBody}
          </div>
        )}
      </div>

      {/* Always-present accessible fallback for a screen reader over the SVG chart above (DESIGN.md
          §6): visually hidden whenever the visible table toggle is already showing the same data. */}
      {!showTable ? (
        // The wrapper, not the table, carries `sr-only`: a table's used width is at least its
        // min-content width, so `width:1px` on the table itself is ignored by layout and it still
        // occupies its natural box at its static position -- on /analytics that pushed
        // document.scrollWidth past the 390px viewport. Clipping happens one level up instead.
        <div className="sr-only">
          <table>
            <caption>{t(titleKey)}</caption>
            <thead>
              <tr>
                {table.headers.map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (
                    <td key={j}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  )
}
