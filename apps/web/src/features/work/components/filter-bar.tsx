// The filter bar (TECH-SPEC §4/§5): free text in this feature's filter grammar
// (`assignee:@me giver:@x status:active due:<=friday project:"..." label:x unit:"..." free text`,
// `@devon/contracts`'s `parseFilterQuery`), kept in the `?q=` search param of whichever view route is
// current -- so the exact same URL a person is looking at is what "share this view" means (TECH-SPEC:
// "shareable URLs"), and switching Board/Table/Timeline/Calendar/Mine never drops the filter. Saved
// views (`GET/POST/DELETE /api/v1/views`) are shortcuts into that same mechanism: applying one just
// navigates to its `layout` route with its `filter` string as `?q=`.
import * as React from 'react'
import { Bookmark, Save, Trash2, X } from 'lucide-react'
import { useT } from '@devon/i18n'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  toast,
} from '@devon/ui'
import { navigate, replaceSearchParam, useSearchParams } from '../../../lib/router.js'
import {
  useCreateSavedViewMutation,
  useDeleteSavedViewMutation,
  useSavedViewsQuery,
} from '../hooks.js'
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
    <div className="flex flex-wrap items-center gap-2">
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
        className="max-w-96"
      />
      <Button size="sm" variant="secondary" onClick={() => applyFilter(text)}>
        {t('work.filter.apply')}
      </Button>
      {q.length > 0 ? (
        <IconButton
          aria-label={t('work.filter.clear')}
          onClick={() => {
            setText('')
            applyFilter('')
          }}
        >
          <X className="size-4" />
        </IconButton>
      ) : null}

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

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="ghost">
            <Bookmark className="size-4" aria-hidden="true" />
            {t('work.filter.savedViews')}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto">
          <DropdownMenuLabel>{t('work.filter.savedViews')}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {savedViews.length === 0 ? (
            <p className="px-2 py-3 text-small text-muted-foreground">
              {t('work.filter.noSavedViews')}
            </p>
          ) : (
            savedViews.map((view) => (
              <DropdownMenuItem
                key={view.id}
                className="justify-between"
                onSelect={() => applySavedView(view)}
              >
                <span>{view.name}</span>
                <IconButton
                  aria-label={t('work.action.delete')}
                  onClick={(e) => {
                    e.stopPropagation()
                    void deleteView.mutateAsync(view.id)
                  }}
                >
                  <Trash2 className="size-3.5" />
                </IconButton>
              </DropdownMenuItem>
            ))
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
