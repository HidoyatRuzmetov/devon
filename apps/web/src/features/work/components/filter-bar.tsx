// The filter bar (TECH-SPEC §4/§5, UI-OVERHAUL.md §8 "Filters"): removable chips for the parsed
// filter grammar (`@devon/contracts`'s `parseFilterQuery`/`serializeFilterQuery`), a "+ Filtr"
// popover (field -> value, cmdk-style scoring) to add another clause without ever typing the
// grammar, the raw text kept one toggle away for anyone who prefers it, and saved views as a row of
// tabs -- all of it still just the `?q=` search param, so a filter typed here survives switching
// Board/Table/Timeline/Calendar/Mine and is exactly what "share this view" means.
import * as React from 'react'
import { Bookmark, ChevronDown, Filter as FilterIcon, Save, Trash2 } from 'lucide-react'
import { useT } from '@devon/i18n'
import { Button, cn, Input, Popover, PopoverContent, PopoverTrigger, toast } from '@devon/ui'
import { navigate, replaceSearchParam, useSearchParams } from '../../../lib/router.js'
import {
  useCreateSavedViewMutation,
  useDeleteSavedViewMutation,
  useSavedViewsQuery,
} from '../hooks.js'
import { FilterClauseChips } from './filter-clause-chips.js'
import type { SavedViewLayout } from '../api.js'

const LAYOUT_ROUTE: Record<SavedViewLayout, string> = {
  people_board: '/work',
  table: '/work/table',
  timeline: '/work/timeline',
  calendar: '/work/calendar',
  mine: '/work/mine',
}

export function FilterBar({ layout }: { layout: SavedViewLayout }) {
  const t = useT()
  const search = useSearchParams()
  const q = search.get('q') ?? ''
  const [text, setText] = React.useState(q)
  const [advanced, setAdvanced] = React.useState(false)
  const [saveName, setSaveName] = React.useState('')
  const [saveOpen, setSaveOpen] = React.useState(false)

  React.useEffect(() => setText(q), [q])

  const savedViews = useSavedViewsQuery().data ?? []
  const createView = useCreateSavedViewMutation()
  const deleteView = useDeleteSavedViewMutation()

  function applyFilter(next: string) {
    replaceSearchParam('q', next.trim().length > 0 ? next : null)
  }

  function applySavedView(view: (typeof savedViews)[number]) {
    const route = LAYOUT_ROUTE[view.layout]
    navigate(view.filter ? `${route}?q=${encodeURIComponent(view.filter)}` : route)
  }

  async function saveCurrentFilter() {
    if (saveName.trim().length === 0) return
    try {
      await createView.mutateAsync({ name: saveName.trim(), filter: q, layout })
      setSaveName('')
      setSaveOpen(false)
      toast(t('work.filter.saved'))
    } catch {
      toast(t('work.filter.saveError'))
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <FilterClauseChips query={q} onChange={applyFilter} />

        <Popover open={saveOpen} onOpenChange={setSaveOpen}>
          <PopoverTrigger asChild>
            <Button size="sm" variant="ghost" disabled={q.length === 0}>
              <Save className="size-4" aria-hidden="true" />
              {t('work.filter.saveAs')}
            </Button>
          </PopoverTrigger>
          <PopoverContent>
            <p className="mb-2 text-small font-medium text-foreground">{t('work.filter.saveAs')}</p>
            <div className="flex gap-2">
              <Input
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                placeholder={t('work.filter.viewName')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void saveCurrentFilter()
                }}
                autoFocus
              />
              <Button
                size="sm"
                onClick={() => void saveCurrentFilter()}
                loading={createView.isPending}
              >
                {t('work.action.save')}
              </Button>
            </div>
          </PopoverContent>
        </Popover>

        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="ml-auto"
          aria-expanded={advanced}
          aria-controls="work-filter-advanced"
          onClick={() => setAdvanced((v) => !v)}
        >
          {t('work.filter.showAdvanced')}
          <ChevronDown
            className={cn(
              'size-3.5 transition-transform duration-(--dur-micro)',
              advanced && 'rotate-180',
            )}
            aria-hidden="true"
          />
        </Button>
      </div>

      {savedViews.length > 0 ? (
        <nav
          className="flex flex-wrap items-center gap-1 border-b border-border"
          aria-label={t('work.filter.savedViews')}
        >
          <Bookmark className="mr-1 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          {savedViews.map((view) => {
            const active = view.layout === layout && view.filter === q
            return (
              <span key={view.id} className="group relative -mb-px inline-flex items-center">
                <button
                  type="button"
                  onClick={() => applySavedView(view)}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'inline-flex min-h-9 items-center whitespace-nowrap border-b-2 px-3 pr-6 text-small font-medium transition-colors duration-(--dur-micro)',
                    active
                      ? 'border-primary text-foreground'
                      : 'border-transparent text-muted-foreground hover:text-foreground',
                  )}
                >
                  {view.name}
                </button>
                <button
                  type="button"
                  aria-label={t('work.action.delete')}
                  onClick={() => void deleteView.mutateAsync(view.id)}
                  className="absolute right-1 inline-flex size-4 items-center justify-center rounded-full text-muted-foreground opacity-0 hover:bg-foreground/10 hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                >
                  <Trash2 className="size-3" aria-hidden="true" />
                </button>
              </span>
            )
          })}
        </nav>
      ) : null}

      {advanced ? (
        <div
          id="work-filter-advanced"
          className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-border p-2"
        >
          <FilterIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                applyFilter(text)
              }
            }}
            placeholder={t('work.filter.placeholder')}
            aria-label={t('work.filter.placeholder')}
            className="max-w-96 flex-1"
          />
          <Button size="sm" variant="secondary" onClick={() => applyFilter(text)}>
            {t('work.filter.apply')}
          </Button>
          {q.length > 0 ? (
            <Button size="sm" variant="ghost" onClick={() => applyFilter('')}>
              {t('work.filter.clear')}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
