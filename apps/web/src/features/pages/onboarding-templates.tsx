// The onboarding checklist template editor (TECH-SPEC §3.5: "onboarding checklist template that
// becomes a newcomer's personal tasks on join, opt-in per department"). A head or member builds the
// list once; `apps/api/src/modules/pages/onboarding.ts` applies every `ownerRole: 'newcomer'` item to
// a joining member's own personal tasks automatically -- this panel only ever edits the template.
import * as React from 'react'
import { useT } from '@devon/i18n'
import { Button, Input, StateView, toast } from '@devon/ui'
import { Plus, Trash2 } from 'lucide-react'
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

function TemplateCard({ template }: { template: OnboardingTemplate }) {
  const t = useT()
  const patchTemplate = usePatchOnboardingTemplateMutation()
  const deleteTemplate = useDeleteOnboardingTemplateMutation()
  const [items, setItems] = React.useState<OnboardingItem[]>(template.items)
  const [newText, setNewText] = React.useState('')
  const [newRole, setNewRole] = React.useState<OnboardingOwnerRole>('newcomer')
  const dirty = JSON.stringify(items) !== JSON.stringify(template.items)

  React.useEffect(() => setItems(template.items), [template.items])

  const save = (patch: { enabled?: boolean; items?: OnboardingItem[] }) => {
    patchTemplate.mutate(
      { id: template.id, input: { ...patch, version: template.version } },
      { onSuccess: () => toast(t('pages.onboarding.saved')) },
    )
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border bg-card p-5 shadow-1">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-h3 text-foreground">{template.name}</h3>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-small text-foreground">
            <input
              type="checkbox"
              checked={template.enabled}
              onChange={(e) => save({ enabled: e.target.checked })}
              className="size-4 rounded-sm border-border"
            />
            {t(template.enabled ? 'pages.onboarding.enabled' : 'pages.onboarding.disabled')}
          </label>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => deleteTemplate.mutate(template.id)}
            aria-label={t('pages.onboarding.removeItem')}
          >
            <Trash2 className="size-4" aria-hidden="true" />
          </Button>
        </div>
      </div>

      <ul className="flex flex-col gap-1">
        {items.map((item) => (
          <li
            key={item.id}
            className="flex items-center gap-2 rounded-sm border border-border px-2 py-1.5"
          >
            <span className="flex-1 text-small text-foreground">{item.text}</span>
            <select
              value={item.ownerRole}
              onChange={(e) =>
                setItems((prev) =>
                  prev.map((it) =>
                    it.id === item.id
                      ? { ...it, ownerRole: e.target.value as OnboardingOwnerRole }
                      : it,
                  ),
                )
              }
              className="h-8 rounded-sm border border-border bg-card px-1.5 text-small text-foreground"
            >
              {OWNER_ROLES.map((role) => (
                <option key={role} value={role}>
                  {t(`pages.onboarding.ownerRole.${role}`)}
                </option>
              ))}
            </select>
            <button
              type="button"
              aria-label={t('pages.onboarding.removeItem')}
              className="text-muted-foreground hover:text-destructive"
              onClick={() => setItems((prev) => prev.filter((it) => it.id !== item.id))}
            >
              <Trash2 className="size-3.5" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>

      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (!newText.trim()) return
          setItems((prev) => [
            ...prev,
            { id: newItemId(), text: newText.trim(), ownerRole: newRole, sort: prev.length },
          ])
          setNewText('')
        }}
      >
        <Input
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
          placeholder={t('pages.onboarding.itemPlaceholder')}
          aria-label={t('pages.onboarding.itemPlaceholder')}
          className="max-w-64"
        />
        <select
          value={newRole}
          onChange={(e) => setNewRole(e.target.value as OnboardingOwnerRole)}
          className="h-9 rounded-sm border border-border bg-card px-2 text-small text-foreground"
        >
          {OWNER_ROLES.map((role) => (
            <option key={role} value={role}>
              {t(`pages.onboarding.ownerRole.${role}`)}
            </option>
          ))}
        </select>
        <Button type="submit" variant="secondary" size="sm">
          <Plus className="mr-1 size-4" aria-hidden="true" />
          {t('pages.onboarding.addItem')}
        </Button>
      </form>

      {dirty ? (
        <Button
          size="sm"
          className="self-start"
          loading={patchTemplate.isPending}
          onClick={() => save({ items })}
        >
          {t('pages.onboarding.save')}
        </Button>
      ) : null}
    </div>
  )
}

export function OnboardingTemplatesPanel() {
  const t = useT()
  const templatesQuery = useOnboardingTemplatesQuery()
  const createTemplate = useCreateOnboardingTemplateMutation()
  const [newName, setNewName] = React.useState('')

  if (templatesQuery.isPending) return <StateView kind="loading" titleKey="state.loading" />
  const templates = templatesQuery.data ?? []

  return (
    <div className="flex flex-col gap-4">
      <p className="text-small text-muted-foreground">{t('pages.onboarding.subtitle')}</p>

      {templates.length === 0 ? (
        <StateView kind="empty" titleKey="pages.onboarding.empty" />
      ) : (
        templates.map((template) => <TemplateCard key={template.id} template={template} />)
      )}

      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (!newName.trim()) return
          createTemplate.mutate({ name: newName.trim() }, { onSuccess: () => setNewName('') })
        }}
      >
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder={t('pages.onboarding.namePlaceholder')}
          aria-label={t('pages.onboarding.namePlaceholder')}
          className="max-w-64"
        />
        <Button type="submit" variant="secondary" size="sm" loading={createTemplate.isPending}>
          <Plus className="mr-1.5 size-4" aria-hidden="true" />
          {t('pages.onboarding.newTemplate')}
        </Button>
      </form>
    </div>
  )
}
