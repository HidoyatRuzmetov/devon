// `/structure` -- TECH-SPEC EPIC-003: bo'limlar with unlimited nesting, self-assignment, unit roles,
// an org chart correct with or without unit heads, colours, drag reorder. Rebuilt to UI-OVERHAUL.md's
// screen recipe (§9.1 page header, §9.6 empty/error) and Jakob map row "Structure / org chart" (Miro,
// Lucidchart: tree with unit colours, vacancies dashed, zoom/pan, click to open unit).
import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useT } from '@devon/i18n'
import {
  Button,
  Combobox,
  Dialog,
  DialogClose,
  DialogContent,
  EmptyStructureIllustration,
  IdleFloat,
  Input,
  RadioGroup,
  RadioOption,
  Reveal,
  StateView,
  Tabs,
  TabsList,
  TabsTrigger,
  toast,
  toastWithUndo,
} from '@devon/ui'
import { List, Network, Plus } from 'lucide-react'
import { useForcedState } from '../../lib/forced-state.js'
import { ForcedStateBlock } from '../../shell/forced-state-block.js'
import { useOnline } from '../../lib/use-online.js'
import { useMeQuery } from '../../lib/session.js'
import { ApiError } from '../../lib/api-client.js'
import {
  assignUnitRole,
  createUnit,
  deleteUnit,
  fetchMembers,
  fetchUnitRoles,
  fetchUnitsOverview,
  reorderUnits,
  restoreUnit,
  unassignUnitRole,
  updateUnit,
  type Member,
  type Unit,
} from './api.js'
import { useMyDepartments } from './use-my-departments.js'
import { DepartmentHeader } from './department-header.js'
import { UnitTree, buildTree, type TreeActions } from './unit-tree.js'
import { OrgChart } from './org-chart.js'
import { fullName } from './member-card.js'

type View = 'tree' | 'chart'

function queryKeys(departmentId: string | null) {
  return {
    overview: ['structure', 'units', departmentId] as const,
    roles: ['structure', 'unit-roles', departmentId] as const,
    members: ['structure', 'members', departmentId] as const,
  }
}

export default function StructureScreen() {
  const t = useT()
  const forced = useForcedState()
  const online = useOnline()
  const departments = useMyDepartments()
  const departmentId = departments.activeDepartmentId
  const meQuery = useMeQuery()
  const csrfToken = meQuery.data?.csrfToken ?? ''
  const currentUserId = meQuery.data?.user.id ?? ''
  const queryClient = useQueryClient()
  const keys = queryKeys(departmentId)

  const [view, setView] = React.useState<View>('tree')
  const [addParentId, setAddParentId] = React.useState<string | null | undefined>(undefined)
  const [deleteTarget, setDeleteTarget] = React.useState<Unit | null>(null)
  const [assignUnitId, setAssignUnitId] = React.useState<string | null>(null)

  const overviewQuery = useQuery({
    queryKey: keys.overview,
    queryFn: () => fetchUnitsOverview(departmentId!),
    enabled: departmentId !== null,
  })
  const rolesQuery = useQuery({
    queryKey: keys.roles,
    queryFn: () => fetchUnitRoles(departmentId!),
    enabled: departmentId !== null,
  })
  const membersQuery = useQuery({
    queryKey: keys.members,
    queryFn: () => fetchMembers(departmentId!),
    enabled: departmentId !== null,
  })

  const invalidateAll = () => {
    void queryClient.invalidateQueries({ queryKey: keys.overview })
    void queryClient.invalidateQueries({ queryKey: keys.roles })
  }

  const createMutation = useMutation({
    mutationFn: (body: { name: string; colour?: number | null; parentUnitId?: string | null }) =>
      createUnit(departmentId!, body, csrfToken),
    onSuccess: invalidateAll,
    onError: () => toast(t('state.error.title')),
  })
  const renameMutation = useMutation({
    mutationFn: ({ unitId, name }: { unitId: string; name: string }) =>
      updateUnit(departmentId!, unitId, { name }, csrfToken),
    onSuccess: invalidateAll,
    onError: () => toast(t('state.error.title')),
  })
  const colourMutation = useMutation({
    mutationFn: ({ unitId, colour }: { unitId: string; colour: number | null }) =>
      updateUnit(departmentId!, unitId, { colour }, csrfToken),
    onSuccess: invalidateAll,
    onError: () => toast(t('state.error.title')),
  })
  const reparentMutation = useMutation({
    mutationFn: ({ unitId, parentUnitId }: { unitId: string; parentUnitId: string | null }) =>
      updateUnit(departmentId!, unitId, { parentUnitId }, csrfToken),
    onSuccess: invalidateAll,
    onError: () => toast(t('state.error.title')),
  })
  const reorderMutation = useMutation({
    mutationFn: (body: { parentUnitId: string | null; orderedUnitIds: string[] }) =>
      reorderUnits(departmentId!, body, csrfToken),
    onSuccess: invalidateAll,
    onError: () => toast(t('state.error.title')),
  })
  const deleteMutation = useMutation({
    mutationFn: (unitId: string) => deleteUnit(departmentId!, unitId, csrfToken),
    onError: () => toast(t('state.error.title')),
  })
  const restoreMutation = useMutation({
    mutationFn: ({ unitId, deletedAt }: { unitId: string; deletedAt: string }) =>
      restoreUnit(departmentId!, unitId, deletedAt, csrfToken),
    onSuccess: invalidateAll,
    onError: () => toast(t('state.error.title')),
  })
  const assignMutation = useMutation({
    mutationFn: (body: { unitId: string; userId: string; role: 'head' | 'deputy' | 'member' }) =>
      assignUnitRole(departmentId!, body, csrfToken),
    onSuccess: invalidateAll,
    onError: () => toast(t('state.error.title')),
  })
  const unassignMutation = useMutation({
    mutationFn: (unitRoleId: string) => unassignUnitRole(departmentId!, unitRoleId, csrfToken),
    onSuccess: invalidateAll,
    onError: () => toast(t('state.error.title')),
  })

  if (forced) return <ForcedStateBlock kind={forced} />
  if (!online) {
    return (
      <StateView
        kind="offline"
        titleKey="state.offline.banner"
        bodyKey="state.offline.empty"
        action={{ labelKey: 'state.error.action', onAction: () => window.location.reload() }}
      />
    )
  }
  if (departments.isLoading || (departmentId && overviewQuery.isPending)) {
    return <StateView kind="loading" titleKey="structure.units.title" />
  }
  const error =
    overviewQuery.error ??
    rolesQuery.error ??
    membersQuery.error ??
    (departments.isError ? new Error() : null)
  if (error instanceof ApiError && error.code === 'forbidden') {
    return (
      <StateView
        kind="forbidden"
        titleKey="state.denied.title"
        bodyKey="state.denied.body"
        action={{ labelKey: 'state.denied.action', onAction: () => window.history.back() }}
      />
    )
  }
  if (error) {
    return (
      <StateView
        kind="error"
        titleKey="state.error.title"
        bodyKey="state.error.body"
        action={{ labelKey: 'state.error.action', onAction: () => overviewQuery.refetch() }}
      />
    )
  }
  if (!departmentId || !overviewQuery.data) {
    return (
      <StateView
        kind="empty"
        titleKey="structure.units.empty.title"
        bodyKey="structure.units.empty.body"
        illustration={
          <IdleFloat>
            <EmptyStructureIllustration className="w-36" />
          </IdleFloat>
        }
      />
    )
  }

  const { units, settings, myRole } = overviewQuery.data
  const roles = rolesQuery.data ?? []
  const members = membersQuery.data ?? []
  const rolesByUnit = new Map<string, typeof roles>()
  for (const r of roles) rolesByUnit.set(r.unitId, [...(rolesByUnit.get(r.unitId) ?? []), r])
  const membersById = new Map<string, Member>(members.map((m) => [m.userId, m]))
  // How many people belong to each unit (§25 of the departments-people-events UI pass: the tree row
  // shows a real member count, not the count of role *assignments*, which can be zero for a unit
  // everyone still belongs to).
  const memberCountByUnit = new Map<string, number>()
  for (const m of members) {
    if (m.unitId) memberCountByUnit.set(m.unitId, (memberCountByUnit.get(m.unitId) ?? 0) + 1)
  }
  const roots = buildTree(units)
  const isHead = myRole === 'head'

  const actions: TreeActions = {
    canEditStructure: isHead || settings.allowStructureEdit,
    canSelfAssign: settings.allowSelfAssign,
    isHead,
    currentUserId,
    rolesByUnit,
    membersById,
    memberCountByUnit,
    onRename: (unitId, name) => renameMutation.mutate({ unitId, name }),
    onColourChange: (unitId, colour) => colourMutation.mutate({ unitId, colour }),
    onAddChild: (parentUnitId) => setAddParentId(parentUnitId),
    onDelete: (unit) => setDeleteTarget(unit),
    onReorderSiblings: (parentUnitId, orderedUnitIds) =>
      reorderMutation.mutate({ parentUnitId, orderedUnitIds }),
    onReparent: (unitId, parentUnitId) => {
      if (unitId === parentUnitId) return
      reparentMutation.mutate({ unitId, parentUnitId })
    },
    onSelfAssign: (unitId, role) => {
      const me = membersById.get(currentUserId)
      assignMutation.mutate(
        { unitId, userId: currentUserId, role },
        {
          onSuccess: () =>
            toast(
              t('structure.roles.assignedToast', {
                name: me ? fullName(me) : '',
                role: t(`structure.roles.roleLabel.${role}`),
              }),
            ),
        },
      )
    },
    onOpenAssign: (unitId) => setAssignUnitId(unitId),
    onUnassign: (unitRoleId) => unassignMutation.mutate(unitRoleId),
  }

  const canAddRoot = isHead || settings.allowStructureEdit
  const structureEditNoticeVisible = !isHead && !settings.allowStructureEdit
  const selfAssignNoticeVisible = !isHead && !settings.allowSelfAssign

  // A plain if/else (not a JSX ternary chain) so no `>...<` boundary in the switch itself can ever be
  // mistaken for hard-coded text by `check-i18n.mjs`'s regex heuristic.
  let body: React.ReactNode
  if (units.length === 0) {
    body = (
      <StateView
        kind="empty"
        titleKey="structure.units.empty.title"
        bodyKey="structure.units.empty.body"
        illustration={
          <IdleFloat>
            <EmptyStructureIllustration className="w-36" />
          </IdleFloat>
        }
        {...(canAddRoot
          ? {
              action: {
                labelKey: 'structure.units.empty.action',
                onAction: () => setAddParentId(null),
              },
            }
          : {})}
      />
    )
  } else if (view === 'tree') {
    body = <UnitTree roots={roots} actions={actions} />
  } else {
    body = (
      <OrgChart roots={roots} actions={actions} departmentName={departments.active?.name ?? ''} />
    )
  }

  const tabs =
    units.length === 0 ? undefined : (
      <Tabs value={view} onValueChange={(v) => setView(v as View)}>
        <TabsList>
          <TabsTrigger value="tree">
            <List className="size-4" aria-hidden="true" />
            {t('structure.units.view.tree')}
          </TabsTrigger>
          <TabsTrigger value="chart">
            <Network className="size-4" aria-hidden="true" />
            {t('structure.units.view.chart')}
          </TabsTrigger>
        </TabsList>
      </Tabs>
    )

  return (
    <div className="flex flex-col gap-6">
      <DepartmentHeader
        titleKey="structure.units.title"
        subtitleKey="structure.units.subtitle"
        departments={departments}
        tabs={tabs}
      >
        {canAddRoot ? (
          <Button size="sm" onClick={() => setAddParentId(null)}>
            <Plus className="size-4" aria-hidden="true" />
            {t('structure.units.addUnit')}
          </Button>
        ) : null}
      </DepartmentHeader>

      {structureEditNoticeVisible || selfAssignNoticeVisible ? (
        <Reveal className="rounded-md border border-border bg-muted px-4 py-2 text-caption text-muted-foreground">
          {structureEditNoticeVisible
            ? t('structure.units.settingsNotice.structureEdit')
            : t('structure.units.settingsNotice.selfAssign')}
        </Reveal>
      ) : null}

      {body}

      <AddUnitDialog
        open={addParentId !== undefined}
        parentUnitId={addParentId ?? null}
        units={units}
        onClose={() => setAddParentId(undefined)}
        onCreate={(body) => {
          createMutation.mutate(body)
          setAddParentId(undefined)
        }}
      />

      <Dialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent
          title={t('structure.units.deleteConfirm.title', { name: deleteTarget?.name ?? '' })}
        >
          <p className="text-body text-muted-foreground">
            {t('structure.units.deleteConfirm.body')}
          </p>
          <div className="mt-6 flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="secondary">{t('structure.units.deleteConfirm.cancel')}</Button>
            </DialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                const unit = deleteTarget!
                setDeleteTarget(null)
                deleteMutation.mutate(unit.id, {
                  onSuccess: ({ deletedAt }) => {
                    invalidateAll()
                    toastWithUndo({
                      message: t('structure.units.deletedToast', { name: unit.name }),
                      undoLabel: t('structure.units.undo'),
                      onUndo: () =>
                        restoreMutation.mutate(
                          { unitId: unit.id, deletedAt },
                          {
                            onSuccess: () =>
                              toast(t('structure.units.restoredToast', { name: unit.name })),
                          },
                        ),
                    })
                  },
                })
              }}
            >
              {t('structure.units.deleteConfirm.confirm')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AssignDialog
        unitId={assignUnitId}
        unitName={units.find((u) => u.id === assignUnitId)?.name ?? ''}
        members={members}
        onClose={() => setAssignUnitId(null)}
        onAssign={(userId, role) => {
          assignMutation.mutate(
            { unitId: assignUnitId!, userId, role },
            {
              onSuccess: () => {
                const member = membersById.get(userId)
                toast(
                  t('structure.roles.assignedToast', {
                    name: member ? fullName(member) : '',
                    role: t(`structure.roles.roleLabel.${role}`),
                  }),
                )
              },
            },
          )
          setAssignUnitId(null)
        }}
      />
    </div>
  )
}

function AddUnitDialog({
  open,
  parentUnitId,
  units,
  onClose,
  onCreate,
}: {
  open: boolean
  parentUnitId: string | null
  units: Unit[]
  onClose: () => void
  onCreate: (body: { name: string; parentUnitId: string | null }) => void
}) {
  const t = useT()
  const [name, setName] = React.useState('')
  const [parent, setParent] = React.useState<string | null>(parentUnitId)
  const [touched, setTouched] = React.useState(false)

  React.useEffect(() => {
    if (open) {
      setName('')
      setParent(parentUnitId)
      setTouched(false)
    }
  }, [open, parentUnitId])

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent title={t('structure.units.addDialog.title')}>
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-small text-foreground">{t('structure.units.renameLabel')}</span>
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => setTouched(true)}
              placeholder={t('structure.units.addDialog.namePlaceholder')}
              invalid={touched && name.trim().length === 0}
            />
            {touched && name.trim().length === 0 ? (
              <span className="text-caption text-destructive">
                {t('structure.units.validation.nameRequired')}
              </span>
            ) : null}
          </label>
          <div className="flex flex-col gap-1.5">
            <span className="text-small text-foreground">
              {t('structure.units.addDialog.parentLabel')}
            </span>
            <Combobox
              value={parent}
              onValueChange={(v) => setParent(v || null)}
              label={t('structure.units.addDialog.parentLabel')}
              placeholder={t('structure.units.addDialog.rootOption')}
              searchPlaceholder={t('structure.people.searchPlaceholder')}
              emptyMessage={t('structure.people.empty.title')}
              options={[
                { value: '', label: t('structure.units.addDialog.rootOption') },
                ...units.map((u) => ({ value: u.id, label: u.name })),
              ]}
            />
          </div>
          <div className="mt-2 flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="secondary">{t('structure.units.addDialog.cancel')}</Button>
            </DialogClose>
            <Button
              disabled={name.trim().length === 0}
              onClick={() => onCreate({ name: name.trim(), parentUnitId: parent })}
            >
              {t('structure.units.addDialog.create')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function AssignDialog({
  unitId,
  unitName,
  members,
  onClose,
  onAssign,
}: {
  unitId: string | null
  unitName: string
  members: Member[]
  onClose: () => void
  onAssign: (userId: string, role: 'head' | 'deputy' | 'member') => void
}) {
  const t = useT()
  const [userId, setUserId] = React.useState('')
  const [role, setRole] = React.useState<'head' | 'deputy' | 'member'>('member')

  React.useEffect(() => {
    if (unitId) {
      setUserId('')
      setRole('member')
    }
  }, [unitId])

  return (
    <Dialog open={unitId !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent title={t('structure.roles.assignDialog.title', { unitName })}>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <span className="text-small text-foreground">
              {t('structure.roles.assignDialog.person')}
            </span>
            <Combobox
              value={userId || null}
              onValueChange={setUserId}
              label={t('structure.roles.assignDialog.person')}
              placeholder={t('structure.roles.assignDialog.person')}
              searchPlaceholder={t('structure.people.searchPlaceholder')}
              emptyMessage={t('structure.people.empty.title')}
              options={members.map((m) => ({
                value: m.userId,
                label: fullName(m),
                ...(m.title ? { description: m.title } : {}),
              }))}
            />
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-small text-foreground">
              {t('structure.roles.assignDialog.role')}
            </span>
            <RadioGroup value={role} onValueChange={(v) => setRole(v as typeof role)}>
              {(['head', 'deputy', 'member'] as const).map((r) => (
                <RadioOption key={r} value={r} label={t(`structure.roles.roleLabel.${r}`)} />
              ))}
            </RadioGroup>
          </div>
          <div className="mt-2 flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="secondary">{t('structure.roles.assignDialog.cancel')}</Button>
            </DialogClose>
            <Button disabled={!userId} onClick={() => onAssign(userId, role)}>
              {t('structure.roles.assignDialog.submit')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
