// v1.1 SPEC §7.2 -- the template gallery: card templates and project templates, department ones the
// head curates plus everyone's own personal ones.
//
// The distinction is the whole feature. A *department* template is the head saying "this is how we
// do a quarterly report here", visible to all twenty-six people; a *personal* template is one
// person's own shortcut, visible to nobody else. `canManage` comes from the server per row, so the
// gallery never guesses which of the two a given viewer may edit.
import * as React from 'react'
import { AnimatePresence } from 'motion/react'
import { Building2, Loader2, Plus, Trash2, User } from 'lucide-react'
import { useT } from '@devon/i18n'
import {
  Button,
  HoverLift,
  IconButton,
  PageHeader,
  SegmentedControl,
  Skeleton,
  Stagger,
  StaggerItem,
  StateView,
  cn,
  toast,
} from '@devon/ui'
import { navigate, replaceSearchParam } from '../../../lib/router.js'
import { useDepartment } from '../../../lib/session.js'
import {
  useCreateCardFromTemplateMutation,
  useDeleteTemplateMutation,
  useWorkTemplatesQuery,
} from '../hooks-plus.js'
import { TemplatePreview } from './template-preview.js'
import type { WorkTemplate } from '../api-plus.js'

type KindFilter = 'card' | 'project'

function TemplateCard({
  template,
  onUse,
  onDelete,
  busy,
}: {
  template: WorkTemplate
  onUse: () => void
  onDelete: () => void
  busy: boolean
}): React.JSX.Element {
  const t = useT()
  const isDepartment = template.scope === 'department'
  return (
    <HoverLift className="h-full rounded-md">
      <article className="flex h-full flex-col gap-3 rounded-md border border-border bg-card p-4">
        <div className="flex items-start gap-2">
          <span
            aria-hidden="true"
            className={cn(
              'inline-flex size-8 shrink-0 items-center justify-center rounded-md',
              isDepartment ? 'bg-accent text-accent-foreground' : 'bg-muted text-muted-foreground',
            )}
          >
            {isDepartment ? <Building2 className="size-4" /> : <User className="size-4" />}
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-body font-medium text-foreground">{template.name}</h3>
            <p className="text-caption text-muted-foreground">
              {isDepartment
                ? t('work.templates.scopeDepartment')
                : t('work.templates.scopePersonal')}
            </p>
          </div>
          {template.canManage ? (
            <IconButton
              aria-label={t('work.templates.delete', { name: template.name })}
              onClick={onDelete}
              disabled={busy}
              className="shrink-0"
            >
              <Trash2 className="size-4" aria-hidden="true" />
            </IconButton>
          ) : null}
        </div>

        {template.description ? (
          <p className="line-clamp-2 text-small text-muted-foreground">{template.description}</p>
        ) : null}

        <TemplatePreview template={template} />

        <div className="mt-auto flex items-center justify-between gap-2 pt-1">
          <span className="text-caption text-muted-foreground">
            {t('work.templates.useCount', { count: template.useCount })}
          </span>
          <Button size="sm" onClick={onUse} disabled={busy}>
            {busy ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Plus className="size-4" aria-hidden="true" />
            )}
            {template.kind === 'card'
              ? t('work.templates.createCard')
              : t('work.templates.createProject')}
          </Button>
        </div>
      </article>
    </HoverLift>
  )
}

export default function TemplatesScreen(): React.JSX.Element {
  const t = useT()
  const { department } = useDepartment()
  const isHead = department?.role === 'head'
  const [kind, setKind] = React.useState<KindFilter>('card')

  const query = useWorkTemplatesQuery(kind)
  const createFromTemplate = useCreateCardFromTemplateMutation()
  const deleteTemplate = useDeleteTemplateMutation()
  const [pending, setPending] = React.useState<string | null>(null)

  const templates = query.data ?? []
  const departmentTemplates = templates.filter((tpl) => tpl.scope === 'department')
  const personalTemplates = templates.filter((tpl) => tpl.scope === 'personal')

  function use(template: WorkTemplate): void {
    if (template.kind === 'project') {
      // A project template is applied by the project stepper, which needs a title, a lead and dates
      // this gallery has no business inventing -- so "use" hands off to it with the template chosen.
      navigate(`/projects?new=1&template=${encodeURIComponent(template.id)}`)
      return
    }
    setPending(template.id)
    createFromTemplate.mutate(
      { id: template.id, input: {} },
      {
        onSettled: () => setPending(null),
        onSuccess: (created) => {
          toast.success(t('work.templates.created', { name: template.name }))
          replaceSearchParam('card', created.id)
        },
        onError: () => toast.error(t('work.templates.createFailed')),
      },
    )
  }

  function remove(template: WorkTemplate): void {
    setPending(template.id)
    deleteTemplate.mutate(template.id, {
      onSettled: () => setPending(null),
      onSuccess: () => toast.success(t('work.templates.deleted')),
      onError: () => toast.error(t('work.templates.deleteFailed')),
    })
  }

  function Group({
    title,
    description,
    list,
  }: {
    title: string
    description: string
    list: WorkTemplate[]
  }): React.JSX.Element | null {
    if (list.length === 0) return null
    return (
      <section className="flex flex-col gap-2">
        <div>
          <h2 className="text-body font-semibold text-foreground">{title}</h2>
          <p className="text-caption text-muted-foreground">{description}</p>
        </div>
        <AnimatePresence initial={false}>
          <Stagger
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
            animateKey={`${kind}-${list.length}`}
          >
            {list.map((template) => (
              <StaggerItem key={template.id} exit="hidden" layout className="h-full">
                <TemplateCard
                  template={template}
                  busy={pending === template.id}
                  onUse={() => use(template)}
                  onDelete={() => remove(template)}
                />
              </StaggerItem>
            ))}
          </Stagger>
        </AnimatePresence>
      </section>
    )
  }

  let body: React.ReactNode
  if (query.isPending) {
    body = (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <Skeleton key={i} className="h-44 w-full" />
        ))}
      </div>
    )
  } else if (query.isError) {
    body = (
      <StateView
        kind="error"
        titleKey="state.error.title"
        bodyKey="state.error.body"
        action={{ labelKey: 'state.error.action', onAction: () => void query.refetch() }}
      />
    )
  } else if (templates.length === 0) {
    body = (
      <StateView
        kind="empty"
        titleKey="work.templates.emptyTitle"
        bodyKey={isHead ? 'work.templates.emptyBodyHead' : 'work.templates.emptyBody'}
      />
    )
  } else {
    body = (
      <div className="flex flex-col gap-6">
        <Group
          title={t('work.templates.departmentTitle')}
          description={t('work.templates.departmentDescription')}
          list={departmentTemplates}
        />
        <Group
          title={t('work.templates.personalTitle')}
          description={t('work.templates.personalDescription')}
          list={personalTemplates}
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        eyebrow={t('work.eyebrow')}
        title={t('work.templates.title')}
        description={t('work.templates.description')}
        tabs={
          <SegmentedControl
            value={kind}
            onValueChange={(v) => setKind(v)}
            label={t('work.templates.kindLabel')}
            options={[
              { value: 'card', label: t('work.templates.kindCard') },
              { value: 'project', label: t('work.templates.kindProject') },
            ]}
          />
        }
      />
      {body}
    </div>
  )
}
