// Saved views as a tab strip (v1.1 SPEC §4.3; DESIGN.md §8 "Filters: saved views as tabs, the URL
// is the state").
//
// The dirty state is explicit and reversible: changing a column or a filter never silently rewrites
// the view you are standing on. The strip shows "oʻzgartirildi", and you choose -- put it back, save
// over this view, or save it as a new one. That is the Linear/Notion behaviour a head has already
// met somewhere else, which is exactly why it is the one used here.
import * as React from 'react'
import { useT } from '@devon/i18n'
import type { PeopleView } from '@devon/contracts'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Switch,
  cn,
} from '@devon/ui'
import { Check, MoreHorizontal, Plus, RotateCcw, Star } from 'lucide-react'

export type ViewTabsProps = {
  views: readonly PeopleView[]
  activeViewId: string | null
  dirty: boolean
  busy: boolean
  onSelect: (view: PeopleView | null) => void
  onRevert: () => void
  onSaveOver: (view: PeopleView) => void
  onSaveAs: (input: { name: string; shared: boolean; makeDepartmentDefault: boolean }) => void
  onMakeDefault: (view: PeopleView) => void
  onToggleShared: (view: PeopleView) => void
  onDelete: (view: PeopleView) => void
  /** Reset to the built-in default columns, shown as the first tab. */
  baseTabLabel: string
}

export function ViewTabs({
  views,
  activeViewId,
  dirty,
  busy,
  onSelect,
  onRevert,
  onSaveOver,
  onSaveAs,
  onMakeDefault,
  onToggleShared,
  onDelete,
  baseTabLabel,
}: ViewTabsProps): React.JSX.Element {
  const t = useT()
  const [name, setName] = React.useState('')
  const [shared, setShared] = React.useState(false)
  const [makeDefault, setMakeDefault] = React.useState(false)
  const [open, setOpen] = React.useState(false)
  const active = views.find((v) => v.id === activeViewId) ?? null

  function saveAs(): void {
    const trimmed = name.trim()
    if (trimmed.length === 0) return
    onSaveAs({ name: trimmed, shared, makeDepartmentDefault: makeDefault })
    setName('')
    setShared(false)
    setMakeDefault(false)
    setOpen(false)
  }

  return (
    <div
      className="flex flex-wrap items-center gap-1.5 border-b border-border pb-2"
      role="group"
      aria-label={t('people.table.views.label')}
    >
      <button
        type="button"
        onClick={() => onSelect(null)}
        aria-current={activeViewId === null ? 'true' : undefined}
        className={cn(
          'inline-flex min-h-9 items-center gap-1.5 rounded-sm px-3 text-small',
          'transition-colors duration-(--dur-micro) ease-out hover:bg-accent',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          activeViewId === null && 'bg-accent font-medium text-foreground',
        )}
      >
        {baseTabLabel}
      </button>

      {views.map((view) => (
        <span key={view.id} className="inline-flex items-center">
          <button
            type="button"
            onClick={() => onSelect(view)}
            aria-current={view.id === activeViewId ? 'true' : undefined}
            className={cn(
              'inline-flex min-h-9 items-center gap-1.5 rounded-sm px-3 text-small',
              'transition-colors duration-(--dur-micro) ease-out hover:bg-accent',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              view.id === activeViewId && 'bg-accent font-medium text-foreground',
            )}
          >
            {view.isDepartmentDefault ? (
              <Star aria-hidden="true" className="size-3.5 text-attention" />
            ) : null}
            {view.name}
          </button>
          {view.id === activeViewId ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton aria-label={t('people.table.views.menu', { name: view.name })}>
                  <MoreHorizontal aria-hidden="true" />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem onSelect={() => onMakeDefault(view)}>
                  {view.isDepartmentDefault
                    ? t('people.table.views.isDefault')
                    : t('people.table.views.makeDefault')}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onToggleShared(view)}>
                  {view.shared ? t('people.table.views.unshare') : t('people.table.views.share')}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => onDelete(view)}>
                  {t('people.table.views.delete')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </span>
      ))}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm">
            <Plus aria-hidden="true" className="size-4" />
            {t('people.table.views.saveAs')}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="flex w-80 flex-col gap-3">
          <p className="text-small font-medium">{t('people.table.views.saveAsHeading')}</p>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('people.table.views.namePlaceholder')}
            aria-label={t('people.table.views.namePlaceholder')}
            maxLength={60}
          />
          <label className="flex min-h-11 items-center justify-between gap-3 text-small">
            <span>{t('people.table.views.shareLabel')}</span>
            <Switch checked={shared} onCheckedChange={setShared} />
          </label>
          <label className="flex min-h-11 items-center justify-between gap-3 text-small">
            <span>{t('people.table.views.defaultLabel')}</span>
            <Switch checked={makeDefault} onCheckedChange={setMakeDefault} />
          </label>
          <Button onClick={saveAs} disabled={busy || name.trim().length === 0} loading={busy}>
            {t('people.table.views.saveAsSubmit')}
          </Button>
        </PopoverContent>
      </Popover>

      {dirty ? (
        <span className="ml-auto flex items-center gap-2">
          <span className="text-caption text-muted-foreground">
            {t('people.table.views.dirty')}
          </span>
          <Button variant="ghost" size="sm" onClick={onRevert}>
            <RotateCcw aria-hidden="true" className="size-4" />
            {t('people.table.views.revert')}
          </Button>
          {active ? (
            <Button size="sm" onClick={() => onSaveOver(active)} loading={busy} disabled={busy}>
              <Check aria-hidden="true" className="size-4" />
              {t('people.table.views.saveOver')}
            </Button>
          ) : null}
        </span>
      ) : null}
    </div>
  )
}
