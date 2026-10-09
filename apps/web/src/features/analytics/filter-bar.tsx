// The analytics filter bar (TECH-SPEC §9): the exact same removable-chips + "+ Filtr" popover editor
// the work views use over the shared filter grammar (`@devon/contracts`'s `parseFilterQuery` --
// person/unit/project/giver/label/status), a date range with quick presets, and saved filters as a
// chip row (UI-OVERHAUL.md §2 "Filters": "chips with type-ahead, a '+ Filter' popover, saved views as
// tabs"). Round 1 rejected a bare query-syntax text box here; round 2 found it still shipping --
// `FilterClauseChips` (work/components/filter-clause-chips.tsx) is reused verbatim rather than a
// second implementation of the same grammar editor, with the raw text kept one "Kengaytirilgan"
// toggle away for anyone who prefers it, same as the work views. Keyboard-complete: every control is
// a native `<input>`/`<button>`, tabbable in document order.
import * as React from 'react'
import { useT, useLocale } from '@devon/i18n'
import { Button, chipVariants, cn, DatePicker, FilterChip, Input, toast } from '@devon/ui'
import { Filter as FilterIcon, Save } from 'lucide-react'
import { FilterClauseChips } from '../work/components/filter-clause-chips.js'
import {
  useCreateSavedFilterMutation,
  useDeleteSavedFilterMutation,
  useSavedFiltersQuery,
} from './use-analytics.js'

export type FilterBarValue = { filter: string; since: string; until: string }

const PRESET_DAYS = [7, 30, 90] as const

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60_000).toISOString().slice(0, 10)
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

/** `value.since`/`value.until` are plain `YYYY-MM-DD` (the API's own query param shape) -- parsed as
 *  local midnight, not `new Date(iso)` (which reads a bare date as UTC midnight and can display a day
 *  off in a timezone west of UTC, which Tashkent, UTC+5, never is, but the component should not rely
 *  on that). */
function parseIsoDate(iso: string): Date | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return undefined
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

function toIsoDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function FilterBar({
  value,
  onChange,
}: {
  value: FilterBarValue
  onChange: (next: FilterBarValue) => void
}) {
  const t = useT()
  const locale = useLocale()
  const [draft, setDraft] = React.useState(value.filter)
  const [advanced, setAdvanced] = React.useState(false)
  const [saveOpen, setSaveOpen] = React.useState(false)
  const [saveName, setSaveName] = React.useState('')

  const savedFiltersQuery = useSavedFiltersQuery()
  const createSavedFilter = useCreateSavedFilterMutation()
  const deleteSavedFilter = useDeleteSavedFilterMutation()

  React.useEffect(() => setDraft(value.filter), [value.filter])

  function applyFilter(next: string) {
    onChange({ ...value, filter: next })
  }

  const activePresetDays = PRESET_DAYS.find(
    (d) => value.since === isoDaysAgo(d) && value.until === today(),
  )

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border bg-card p-4 shadow-1">
      {/* round2 SEV2: this used to be a bare input pre-filled with the raw filter-grammar syntax
          ("assignee:@me status:active due:<today") -- the same removable-chips + "+ Filtr" popover
          editor the work views use (`FilterClauseChips`) replaces it; the raw text is still reachable
          for anyone who prefers it, one "Kengaytirilgan" toggle away, exactly like there. */}
      <div className="flex flex-wrap items-center gap-1.5">
        <FilterClauseChips query={value.filter} onChange={applyFilter} className="flex-1" />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={value.filter.trim().length === 0}
          onClick={() => {
            setSaveName(value.filter)
            setSaveOpen((v) => !v)
          }}
        >
          <Save className="mr-1.5 size-4" aria-hidden="true" />
          {t('analytics.savedFilters.new')}
        </Button>
        <button
          type="button"
          onClick={() => setAdvanced((v) => !v)}
          className="rounded-sm px-2 py-1 text-caption font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          {advanced ? t('analytics.filterBar.hideAdvanced') : t('analytics.filterBar.showAdvanced')}
        </button>
      </div>

      {advanced ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-border p-2">
          <FilterIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                applyFilter(draft)
              }
            }}
            placeholder={t('analytics.filterBar.placeholder')}
            aria-label={t('analytics.filterBar.placeholder')}
            className="max-w-96 flex-1"
          />
          <Button size="sm" variant="secondary" onClick={() => applyFilter(draft)}>
            {t('analytics.filterBar.apply')}
          </Button>
          {value.filter.length > 0 ? (
            <Button size="sm" variant="ghost" onClick={() => applyFilter('')}>
              {t('analytics.filterBar.clear')}
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-caption text-muted-foreground">
          {t('analytics.filterBar.dateRange')}
        </span>
        {PRESET_DAYS.map((days) => (
          <FilterChip
            key={days}
            active={activePresetDays === days}
            onClick={() => onChange({ ...value, since: isoDaysAgo(days), until: today() })}
          >
            {t('analytics.filterBar.presetDays', { count: days })}
          </FilterChip>
        ))}
        {/* DESIGN.md §5: DD.MM.YYYY, never the browser's own locale format -- a native
            <input type="date"> renders US M/D/Y regardless of app locale and carries its own
            un-tokenised chrome (calendar icon, popup, focus ring). The shared DatePicker
            (react-day-picker, Monday-start, Intl month names) replaces both fields. */}
        <span className="ml-2 flex items-center gap-1.5 text-small text-muted-foreground">
          {t('analytics.filterBar.since')}
          <DatePicker
            locale={locale}
            label={t('analytics.filterBar.since')}
            placeholder={t('analytics.filterBar.since')}
            selected={parseIsoDate(value.since)}
            onSelect={(date) => date && onChange({ ...value, since: toIsoDate(date) })}
            triggerClassName="h-8 w-auto min-w-0 py-0"
          />
        </span>
        <span className="flex items-center gap-1.5 text-small text-muted-foreground">
          {t('analytics.filterBar.until')}
          <DatePicker
            locale={locale}
            label={t('analytics.filterBar.until')}
            placeholder={t('analytics.filterBar.until')}
            selected={parseIsoDate(value.until)}
            onSelect={(date) => date && onChange({ ...value, until: toIsoDate(date) })}
            triggerClassName="h-8 w-auto min-w-0 py-0"
          />
        </span>
      </div>

      {saveOpen ? (
        <form
          className="flex flex-wrap items-center gap-2 border-t border-border pt-3"
          onSubmit={(e) => {
            e.preventDefault()
            if (!saveName.trim() || createSavedFilter.isPending) return
            const sinceDays = Math.max(
              1,
              Math.round(
                (new Date(value.until).getTime() - new Date(value.since).getTime()) /
                  (24 * 60 * 60_000),
              ),
            )
            createSavedFilter.mutate(
              { name: saveName.trim(), query: value.filter, sinceDays },
              {
                onSuccess: () => setSaveOpen(false),
                onError: () => toast.error(t('analytics.savedFilters.saveFailed')),
              },
            )
          }}
        >
          <Input
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            placeholder={t('analytics.savedFilters.namePlaceholder')}
            aria-label={t('analytics.savedFilters.namePlaceholder')}
            className="max-w-64"
            autoFocus
          />
          <Button type="submit" size="sm" loading={createSavedFilter.isPending}>
            {t('analytics.savedFilters.save')}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setSaveOpen(false)}>
            {t('analytics.filterBar.clear')}
          </Button>
        </form>
      ) : null}

      {(savedFiltersQuery.data ?? []).length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-border pt-3">
          <span className="text-caption text-muted-foreground">
            {t('analytics.savedFilters.title')}
          </span>
          {savedFiltersQuery.data!.map((sf) => (
            <span
              key={sf.id}
              className={cn(
                chipVariants({ tone: value.filter === sf.query ? 'primary' : 'outline' }),
                'h-8 gap-1 rounded-full pr-1 text-small',
              )}
            >
              <button
                type="button"
                className="min-w-0 max-w-40 truncate"
                onClick={() => {
                  const since = isoDaysAgo(sf.sinceDays)
                  const until = today()
                  setDraft(sf.query)
                  onChange({ filter: sf.query, since, until })
                }}
              >
                {sf.name}
              </button>
              <button
                type="button"
                aria-label={t('analytics.savedFilters.deleteNamed', { name: sf.name })}
                className="inline-flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-foreground/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                disabled={deleteSavedFilter.isPending}
                onClick={() =>
                  deleteSavedFilter.mutate(sf.id, {
                    onError: () => toast.error(t('analytics.savedFilters.deleteFailed')),
                  })
                }
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
}
