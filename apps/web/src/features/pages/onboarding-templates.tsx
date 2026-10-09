// The onboarding checklist template editor (TECH-SPEC §3.5: "onboarding checklist template that
// becomes a newcomer's personal tasks on join, opt-in per department"). A head builds the
// list once; `apps/api/src/modules/pages/onboarding.ts` applies every `ownerRole: 'newcomer'` item to
// a joining member's own personal tasks automatically -- this panel only ever edits the template.
import * as React from 'react'
import { useT } from '@devon/i18n'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  IconButton,
  Input,
  StateView,
  Switch,
  toast,
} from '@devon/ui'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { ApiError } from '../../lib/api-client.js'
import {
  useCreateOnboardingTemplateMutation,
  useDeleteOnboardingTemplateMutation,
  useOnboardingTemplatesQuery,
  usePatchOnboardingTemplateMutation,
} from './use-pages.js'
import type { OnboardingItem, OnboardingOwnerRole, OnboardingTemplate } from './types.js'

const OWNER_ROLES: OnboardingOwnerRole[] = ['newcomer', 'head', 'buddy']

function newItemId(): string {
  return `item-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function TemplateCard({
  template,
  onRefresh,
  onDeleteRequested,
}: {
  template: OnboardingTemplate
  onRefresh: () => void
  onDeleteRequested: () => void
}) {
  const t = useT()
  const patchTemplate = usePatchOnboardingTemplateMutation()
  const deleteTemplate = useDeleteOnboardingTemplateMutation()
  const [items, setItems] = React.useState<OnboardingItem[]>(template.items)
  const baseline = React.useRef(template.items)
  const [changedElsewhere, setChangedElsewhere] = React.useState(false)
  const [editingItem, setEditingItem] = React.useState<string | null>(null)
  const [editingName, setEditingName] = React.useState(false)
  const [name, setName] = React.useState(template.name)
  const nameBaseline = React.useRef(template.name)
  const [newText, setNewText] = React.useState('')
  const [newRole, setNewRole] = React.useState<OnboardingOwnerRole>('newcomer')
  const [error, setError] = React.useState<string | null>(null)
  const [deleteOpen, setDeleteOpen] = React.useState(false)
  const [deleteError, setDeleteError] = React.useState(false)
  const busyRef = React.useRef(false)
  const removeOpener = React.useRef<HTMLButtonElement>(null)
  const itemInput = React.useRef<HTMLInputElement>(null)
  const nameInput = React.useRef<HTMLInputElement>(null)
  const editItemInput = React.useRef<HTMLInputElement>(null)
  const id = React.useId()
  const dirty =
    JSON.stringify(items) !== JSON.stringify(baseline.current) || name !== nameBaseline.current
  const busy = patchTemplate.isPending || deleteTemplate.isPending
  const valid = name.trim().length > 0 && items.every((item) => item.text.trim().length > 0)

  React.useEffect(() => {
    if (editingName) nameInput.current?.focus()
  }, [editingName])
  React.useEffect(() => {
    if (editingItem) editItemInput.current?.focus()
  }, [editingItem])

  React.useEffect(() => {
    const same = (a: OnboardingItem[], b: OnboardingItem[]) =>
      JSON.stringify(a) === JSON.stringify(b)
    // A query refresh or a successful toggle must not erase a different unsaved item array.
    if (same(items, baseline.current) || same(items, template.items)) {
      baseline.current = template.items
      setItems(template.items)
    } else if (!same(template.items, baseline.current)) setChangedElsewhere(true)
    if (name === nameBaseline.current || name === template.name) {
      nameBaseline.current = template.name
      setName(template.name)
    } else if (template.name !== nameBaseline.current) setChangedElsewhere(true)
    // Incoming server changes trigger hydration; local keystrokes must not trigger it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template.items, template.name])

  const save = (patch: { enabled?: boolean; items?: OnboardingItem[]; name?: string }) => {
    if (busyRef.current) return
    busyRef.current = true
    setError(null)
    patchTemplate.mutate(
      { id: template.id, input: { ...patch, version: template.version } },
      {
        onSuccess: () => {
          toast(t('pages.onboarding.saved'))
          if (patch.items) {
            baseline.current = patch.items
            nameBaseline.current = patch.name ?? nameBaseline.current
            if (patch.name !== undefined) setName(patch.name)
            setItems(patch.items)
            setChangedElsewhere(false)
            setEditingItem(null)
            setEditingName(false)
          }
        },
        onError: (err) => {
          setError('pages.onboarding.saveFailed')
          if (err instanceof ApiError && err.status === 409) {
            setChangedElsewhere(true)
            onRefresh()
          }
        },
        onSettled: () => {
          busyRef.current = false
        },
      },
    )
  }

  function cancelChanges() {
    if (busyRef.current) return
    baseline.current = template.items
    nameBaseline.current = template.name
    setItems(template.items)
    setName(template.name)
    setNewText('')
    setError(null)
    setChangedElsewhere(false)
    setEditingItem(null)
    setEditingName(false)
    itemInput.current?.focus()
  }

  return (
    <section
      aria-labelledby={id}
      className="flex min-w-0 flex-col gap-3 rounded-md border border-border bg-card p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={id} className="min-w-0 break-words text-h3 text-foreground">
          {template.name}
        </h3>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-small text-foreground">
            <Switch
              checked={template.enabled}
              disabled={busy}
              onCheckedChange={(checked) => save({ enabled: checked })}
              aria-label={t(
                template.enabled ? 'pages.onboarding.enabled' : 'pages.onboarding.disabled',
              )}
            />
            {t(template.enabled ? 'pages.onboarding.enabled' : 'pages.onboarding.disabled')}
          </label>
          <IconButton
            aria-label={t('pages.onboarding.editTemplate')}
            tooltip={t('pages.onboarding.editTemplate')}
            disabled={busy}
            onClick={() => setEditingName(true)}
          >
            <Pencil className="size-4" aria-hidden="true" />
          </IconButton>
          <IconButton
            ref={removeOpener}
            disabled={busy}
            onClick={() => {
              setDeleteError(false)
              setDeleteOpen(true)
            }}
            aria-label={t('pages.onboarding.deleteTemplate')}
            tooltip={t('pages.onboarding.deleteTemplate')}
          >
            <Trash2 className="size-4" aria-hidden="true" />
          </IconButton>
        </div>
      </div>
      {editingName ? (
        <Input
          ref={nameInput}
          value={name}
          maxLength={200}
          disabled={busy}
          aria-label={t('pages.onboarding.namePlaceholder')}
          aria-invalid={!name.trim() || undefined}
          aria-describedby={!name.trim() ? `${id}-name-error` : undefined}
          onChange={(e) => setName(e.target.value)}
        />
      ) : null}
      {editingName && !name.trim() ? (
        <p id={`${id}-name-error`} role="alert" className="text-small text-destructive">
          {t('pages.onboarding.nameRequired')}
        </p>
      ) : null}

      <ul className="flex flex-col gap-1">
        {items.map((item) => (
          <li
            key={item.id}
            className="flex flex-wrap items-center gap-2 border-b border-border py-2 last:border-b-0"
          >
            {editingItem === item.id ? (
              <Input
                ref={editItemInput}
                value={item.text}
                maxLength={500}
                disabled={busy}
                aria-label={t('pages.onboarding.itemLabel')}
                aria-invalid={!item.text.trim() || undefined}
                aria-describedby={!item.text.trim() ? `${id}-item-error` : undefined}
                className="min-w-0 flex-1 basis-48 max-md:basis-full"
                onChange={(e) =>
                  setItems((prev) =>
                    prev.map((it) => (it.id === item.id ? { ...it, text: e.target.value } : it)),
                  )
                }
              />
            ) : (
              <span className="min-w-0 flex-1 basis-48 break-words text-small text-foreground max-md:basis-full">
                {item.text}
              </span>
            )}
            {editingItem === item.id && !item.text.trim() ? (
              <p
                id={`${id}-item-error`}
                role="alert"
                className="basis-full text-small text-destructive"
              >
                {t('pages.onboarding.itemRequired')}
              </p>
            ) : null}
            <select
              value={item.ownerRole}
              aria-label={`${t('pages.onboarding.ownerLabel')}: ${item.text}`}
              disabled={busy}
              onChange={(e) =>
                setItems((prev) =>
                  prev.map((it) =>
                    it.id === item.id
                      ? { ...it, ownerRole: e.target.value as OnboardingOwnerRole }
                      : it,
                  ),
                )
              }
              className="min-h-9 min-w-0 max-w-full rounded-sm border border-border bg-card px-2 text-small text-foreground max-md:min-h-11"
            >
              {OWNER_ROLES.map((role) => (
                <option key={role} value={role}>
                  {t(`pages.onboarding.ownerRole.${role}`)}
                </option>
              ))}
            </select>
            <IconButton
              disabled={busy}
              aria-label={t('pages.onboarding.editItem')}
              tooltip={t('pages.onboarding.editItem')}
              onClick={() => setEditingItem(item.id)}
            >
              <Pencil className="size-4" aria-hidden="true" />
            </IconButton>
            <IconButton
              disabled={busy}
              aria-label={t('pages.onboarding.removeItem')}
              tooltip={t('pages.onboarding.removeItem')}
              className="ml-auto text-muted-foreground hover:text-destructive"
              onClick={() => {
                setItems((prev) => prev.filter((it) => it.id !== item.id))
                requestAnimationFrame(() => itemInput.current?.focus())
              }}
            >
              <Trash2 className="size-3.5" aria-hidden="true" />
            </IconButton>
          </li>
        ))}
      </ul>

      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (!newText.trim() || busyRef.current || items.length >= 100) return
          setItems((prev) => [
            ...prev,
            { id: newItemId(), text: newText.trim(), ownerRole: newRole, sort: prev.length },
          ])
          setNewText('')
        }}
      >
        <Input
          ref={itemInput}
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
          placeholder={t('pages.onboarding.itemPlaceholder')}
          aria-label={t('pages.onboarding.itemPlaceholder')}
          maxLength={500}
          disabled={busy || items.length >= 100}
          className="min-w-0 max-w-64"
        />
        <select
          value={newRole}
          aria-label={t('pages.onboarding.ownerLabel')}
          disabled={busy || items.length >= 100}
          onChange={(e) => setNewRole(e.target.value as OnboardingOwnerRole)}
          className="min-h-9 min-w-0 max-w-full rounded-sm border border-border bg-card px-2 text-small text-foreground max-md:min-h-11"
        >
          {OWNER_ROLES.map((role) => (
            <option key={role} value={role}>
              {t(`pages.onboarding.ownerRole.${role}`)}
            </option>
          ))}
        </select>
        <Button
          type="submit"
          variant="secondary"
          size="sm"
          disabled={busy || !newText.trim() || items.length >= 100}
        >
          <Plus className="mr-1 size-4" aria-hidden="true" />
          {t('pages.onboarding.addItem')}
        </Button>
      </form>

      {items.length >= 100 ? (
        <p role="status" className="text-small text-muted-foreground">
          {t('pages.onboarding.itemLimit')}
        </p>
      ) : null}
      {changedElsewhere ? (
        <p role="status" className="text-small text-muted-foreground">
          {t('pages.onboarding.changedElsewhere')}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-small text-destructive">
          {t(error)}
        </p>
      ) : null}
      {dirty || editingName || editingItem ? (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            className="self-start"
            loading={patchTemplate.isPending}
            disabled={!dirty || !valid || deleteTemplate.isPending}
            onClick={() =>
              save({
                items: items.map((item, sort) => ({ ...item, text: item.text.trim(), sort })),
                name: name.trim(),
              })
            }
          >
            {t('pages.onboarding.save')}
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={cancelChanges}>
            {t('pages.onboarding.cancelChanges')}
          </Button>
        </div>
      ) : null}
      <Dialog
        open={deleteOpen}
        onOpenChange={(open) => {
          if (!busyRef.current) setDeleteOpen(open)
        }}
      >
        <DialogContent
          title={t('pages.onboarding.deleteTitle')}
          showClose={!deleteTemplate.isPending}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            removeOpener.current?.focus()
          }}
        >
          <DialogDescription className="mt-3 text-small text-muted-foreground">
            {t('pages.onboarding.deleteBody')}
          </DialogDescription>
          <p className="mt-3 break-words font-medium">{template.name}</p>
          {deleteError ? (
            <p role="alert" className="mt-3 text-small text-destructive">
              {t('pages.onboarding.deleteFailed')}
            </p>
          ) : null}
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <Button
              variant="ghost"
              disabled={deleteTemplate.isPending}
              onClick={() => setDeleteOpen(false)}
            >
              {t('common.cancel')}
            </Button>
            <Button
              variant="destructive"
              loading={deleteTemplate.isPending}
              onClick={() => {
                if (busyRef.current) return
                busyRef.current = true
                setDeleteError(false)
                onDeleteRequested()
                deleteTemplate.mutate(template.id, {
                  onError: () => setDeleteError(true),
                  onSettled: () => {
                    busyRef.current = false
                  },
                })
              }}
            >
              {t('pages.onboarding.deleteTemplate')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  )
}

export function OnboardingTemplatesPanel() {
  const t = useT()
  const templatesQuery = useOnboardingTemplatesQuery()
  const createTemplate = useCreateOnboardingTemplateMutation()
  const [newName, setNewName] = React.useState('')
  const [createError, setCreateError] = React.useState(false)
  const createBusy = React.useRef(false)
  const newNameInput = React.useRef<HTMLInputElement>(null)
  const pendingDelete = React.useRef<string | null>(null)
  React.useEffect(() => {
    if (
      pendingDelete.current &&
      templatesQuery.data &&
      !templatesQuery.data.some((template) => template.id === pendingDelete.current)
    ) {
      pendingDelete.current = null
      requestAnimationFrame(() => newNameInput.current?.focus())
    }
  }, [templatesQuery.data])

  if (templatesQuery.isPending) return <StateView kind="loading" titleKey="state.loading" />
  if (templatesQuery.isError)
    return (
      <StateView
        kind="error"
        titleKey="state.error.title"
        bodyKey="state.error.body"
        action={{ labelKey: 'state.error.action', onAction: () => templatesQuery.refetch() }}
      />
    )
  const templates = templatesQuery.data ?? []

  return (
    <div className="flex flex-col gap-4">
      <p className="text-small text-muted-foreground">{t('pages.onboarding.subtitle')}</p>

      {templates.length === 0 ? (
        <StateView kind="empty" titleKey="pages.onboarding.empty" />
      ) : (
        templates.map((template) => (
          <TemplateCard
            key={template.id}
            template={template}
            onRefresh={() => {
              void templatesQuery.refetch()
            }}
            onDeleteRequested={() => {
              pendingDelete.current = template.id
            }}
          />
        ))
      )}

      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (!newName.trim() || createBusy.current) return
          createBusy.current = true
          setCreateError(false)
          createTemplate.mutate(
            { name: newName.trim() },
            {
              onSuccess: () => setNewName(''),
              onError: () => setCreateError(true),
              onSettled: () => {
                createBusy.current = false
              },
            },
          )
        }}
      >
        <Input
          ref={newNameInput}
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder={t('pages.onboarding.namePlaceholder')}
          aria-label={t('pages.onboarding.namePlaceholder')}
          className="max-w-64"
          maxLength={200}
          disabled={createTemplate.isPending}
        />
        <Button
          type="submit"
          variant="secondary"
          size="sm"
          loading={createTemplate.isPending}
          disabled={!newName.trim()}
        >
          <Plus className="mr-1.5 size-4" aria-hidden="true" />
          {t('pages.onboarding.newTemplate')}
        </Button>
        {createError ? (
          <p role="alert" className="basis-full text-small text-destructive">
            {t('pages.onboarding.createFailed')}
          </p>
        ) : null}
      </form>
    </div>
  )
}
