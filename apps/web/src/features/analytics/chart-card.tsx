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
import { useT } from '@devon/i18n'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
  cn,
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
}: ChartCardProps) {
  const t = useT()
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
                  if (bodyRef.current) void downloadPng(bodyRef.current, `${chartKey}.png`)
                }}
              >
                <Download className="size-3.5" aria-hidden="true" />
                {t('analytics.actions.exportPng')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <IconButton
            aria-label={t(pinned ? 'analytics.actions.unpin' : 'analytics.actions.pin')}
            aria-pressed={pinned}
            disabled={pinBusy}
            onClick={onTogglePin}
          >
            {pinned ? (
              <PinOff className="size-4" aria-hidden="true" />
            ) : (
              <Pin className="size-4" aria-hidden="true" />
            )}
          </IconButton>
        </div>
      </header>

      {/* `flex-1 min-h-0`: gives ResponsiveContainer's own `height="100%"` (sections.tsx) a real,
          definite height to resolve against -- filling whatever extra room the grid's row-stretch
          handed this card, while `minHeight` (also sections.tsx, per chart) keeps a short card from
          collapsing below its own data-appropriate floor. */}
      <div ref={bodyRef} className="flex min-h-0 flex-1 flex-col rounded-sm bg-card">
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
          chartBody
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
