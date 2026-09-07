// The analytics filter bar (TECH-SPEC §9): a text field over the Work module's own filter grammar
// (`@devon/contracts`'s `parseFilterQuery` -- person/unit/project/giver/label/status), a date range,
// and saved filters. Keyboard-complete: every control is a native `<input>`/`<button>`, tabbable in
// document order, `Enter` in the text field applies the filter (form submit) exactly like every other
// search input in this app.
import * as React from 'react'
import { useT } from '@devon/i18n'
import {
  Button,
  Input,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@devon/ui'
import { Bookmark, ChevronDown, Save, Trash2 } from 'lucide-react'
import {
  useCreateSavedFilterMutation,
  useDeleteSavedFilterMutation,
  useSavedFiltersQuery,
} from './use-analytics.js'

export type FilterBarValue = { filter: string; since: string; until: string }

export function FilterBar({
  value,
  onChange,
}: {
  value: FilterBarValue
  onChange: (next: FilterBarValue) => void
}) {
  const t = useT()
  const [draft, setDraft] = React.useState(value.filter)
  const [saveOpen, setSaveOpen] = React.useState(false)
  const [saveName, setSaveName] = React.useState('')

  const savedFiltersQuery = useSavedFiltersQuery()
  const createSavedFilter = useCreateSavedFilterMutation()
  const deleteSavedFilter = useDeleteSavedFilterMutation()

  React.useEffect(() => setDraft(value.filter), [value.filter])

  const applyDraft = (e: React.FormEvent) => {
    e.preventDefault()
    onChange({ ...value, filter: draft })
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border bg-card p-4 shadow-1">
      <form className="flex flex-wrap items-center gap-2" onSubmit={applyDraft}>
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t('analytics.filterBar.placeholder')}
          aria-label={t('analytics.filterBar.placeholder')}
          className="min-w-64 flex-1"
        />
        <label className="flex items-center gap-1.5 text-small text-muted-foreground">
          {t('analytics.filterBar.since')}
          <Input
            type="date"
            value={value.since}
            onChange={(e) => onChange({ ...value, since: e.target.value })}
            className="h-9 w-auto"
            aria-label={t('analytics.filterBar.since')}
          />
        </label>
        <label className="flex items-center gap-1.5 text-small text-muted-foreground">
          {t('analytics.filterBar.until')}
          <Input
            type="date"
            value={value.until}
            onChange={(e) => onChange({ ...value, until: e.target.value })}
            className="h-9 w-auto"
            aria-label={t('analytics.filterBar.until')}
          />
        </label>
        <Button type="submit" variant="secondary" size="sm">
          {t('analytics.filterBar.apply')}
        </Button>
        {value.filter ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setDraft('')
              onChange({ ...value, filter: '' })
            }}
          >
            {t('analytics.filterBar.clear')}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setSaveName(draft)
            setSaveOpen((v) => !v)
          }}
        >
          <Save className="mr-1.5 size-4" aria-hidden="true" />
          {t('analytics.savedFilters.new')}
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="sm">
              <Bookmark className="mr-1.5 size-4" aria-hidden="true" />
              {t('analytics.savedFilters.title')}
              <ChevronDown className="ml-1 size-3.5" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {(savedFiltersQuery.data ?? []).length === 0 ? (
              <DropdownMenuItem disabled>{t('analytics.savedFilters.empty')}</DropdownMenuItem>
            ) : (
              savedFiltersQuery.data!.map((sf) => (
                <DropdownMenuItem
                  key={sf.id}
                  className="flex items-center justify-between gap-2"
                  onSelect={() => {
                    const since = new Date(Date.now() - sf.sinceDays * 24 * 60 * 60_000)
                      .toISOString()
                      .slice(0, 10)
                    const until = new Date().toISOString().slice(0, 10)
                    setDraft(sf.query)
                    onChange({ filter: sf.query, since, until })
                  }}
                >
                  <span className="truncate">{sf.name}</span>
                  <button
                    type="button"
                    aria-label={t('analytics.savedFilters.delete')}
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={(e) => {
                      e.stopPropagation()
                      deleteSavedFilter.mutate(sf.id)
                    }}
                  >
                    <Trash2 className="size-3.5" aria-hidden="true" />
                  </button>
                </DropdownMenuItem>
              ))
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </form>

      {saveOpen ? (
        <form
          className="flex flex-wrap items-center gap-2 border-t border-border pt-3"
          onSubmit={(e) => {
            e.preventDefault()
            if (!saveName.trim()) return
            const sinceDays = Math.max(
              1,
              Math.round(
                (new Date(value.until).getTime() - new Date(value.since).getTime()) /
                  (24 * 60 * 60_000),
              ),
            )
            createSavedFilter.mutate(
              { name: saveName.trim(), query: draft, sinceDays },
              { onSuccess: () => setSaveOpen(false) },
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
    </div>
  )
}
