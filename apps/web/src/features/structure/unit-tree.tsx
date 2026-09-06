// The list view of the structure editor: nested bo'limlar with inline rename, a colour popover, drag
// reorder (within a sibling group) and drag-to-nest (drop onto another row to become its child),
// add-sub-unit/delete, and each unit's role holders with self-assign / unassign / "assign someone".
import * as React from 'react'
import { useT } from '@devon/i18n'
import {
  Avatar,
  Badge,
  Button,
  IconButton,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  cn,
  initialsFromName,
  unitHueClass,
} from '@devon/ui'
import { Check, ChevronRight, GripVertical, Pencil, Plus, Trash2, UserPlus, X } from 'lucide-react'
import type { MembersById, RolesByUnit, Unit } from './api.js'
import { fullName } from './member-card.js'

const COLOUR_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8] as const

function unitColourClass(unit: Unit): string {
  return unit.colour ? `bg-unit-${unit.colour}` : unitHueClass(unit.id)
}

export type TreeNode = Unit & { children: TreeNode[] }

export function buildTree(units: Unit[]): TreeNode[] {
  const byId = new Map<string, TreeNode>(units.map((u) => [u.id, { ...u, children: [] }]))
  const roots: TreeNode[] = []
  for (const node of byId.values()) {
    if (node.parentUnitId && byId.has(node.parentUnitId)) {
      byId.get(node.parentUnitId)!.children.push(node)
    } else {
      roots.push(node)
    }
  }
  const sortChildren = (list: TreeNode[]) => {
    list.sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name))
    for (const n of list) sortChildren(n.children)
  }
  sortChildren(roots)
  return roots
}

export type TreeActions = {
  canEditStructure: boolean
  canSelfAssign: boolean
  isHead: boolean
  currentUserId: string
  rolesByUnit: RolesByUnit
  membersById: MembersById
  onRename(unitId: string, name: string): void
  onColourChange(unitId: string, colour: number | null): void
  onAddChild(parentUnitId: string | null): void
  onDelete(unit: Unit): void
  onReorderSiblings(parentUnitId: string | null, orderedUnitIds: string[]): void
  onReparent(unitId: string, parentUnitId: string | null): void
  onSelfAssign(unitId: string, role: 'head' | 'deputy' | 'member'): void
  onOpenAssign(unitId: string): void
  onUnassign(unitRoleId: string): void
}

export function UnitTree({ roots, actions }: { roots: TreeNode[]; actions: TreeActions }) {
  const [draggingId, setDraggingId] = React.useState<string | null>(null)

  return (
    <div
      className="flex flex-col gap-2"
      onDragOver={(e) => draggingId && e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        const id = e.dataTransfer.getData('text/plain')
        if (id) actions.onReparent(id, null)
        setDraggingId(null)
      }}
    >
      {roots.map((node) => (
        <UnitRow
          key={node.id}
          node={node}
          depth={0}
          siblingIds={roots.map((r) => r.id)}
          actions={actions}
          draggingId={draggingId}
          setDraggingId={setDraggingId}
        />
      ))}
    </div>
  )
}

function RoleChips({ unit, actions }: { unit: Unit; actions: TreeActions }) {
  const t = useT()
  const roles = actions.rolesByUnit.get(unit.id) ?? []
  const myAssignment = roles.find((r) => r.userId === actions.currentUserId)
  const canJoin = !myAssignment && (actions.isHead || actions.canSelfAssign)
  const canAssignOthers = actions.isHead

  return (
    <div className="flex flex-wrap items-center gap-1.5 pl-9">
      {roles.length === 0 ? (
        <span className="text-caption text-muted-foreground">
          {t('structure.units.chart.noHead')}
        </span>
      ) : null}
      {roles.map((r) => {
        const member = actions.membersById.get(r.userId)
        const canRemove = r.userId === actions.currentUserId || actions.isHead
        return (
          <span
            key={r.id}
            className="inline-flex items-center gap-1 rounded-sm border border-border bg-card py-0.5 pl-1 pr-1.5 text-caption"
          >
            <Avatar
              size="sm"
              alt={member ? fullName(member) : r.userId}
              initials={member ? initialsFromName(member.givenName, member.familyName) : '?'}
              hueSeed={unit.id}
            />
            <span className="text-foreground">{member ? fullName(member) : r.userId}</span>
            <Badge tone={r.role === 'head' ? 'info' : 'neutral'} className="h-5 px-1.5">
              {t(
                r.role === 'head'
                  ? 'structure.roles.roleLabel.head'
                  : r.role === 'deputy'
                    ? 'structure.roles.roleLabel.deputy'
                    : 'structure.roles.roleLabel.member',
              )}
            </Badge>
            {canRemove ? (
              <button
                type="button"
                aria-label={t('structure.roles.removeConfirm.confirm')}
                className="rounded-full p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                onClick={() => actions.onUnassign(r.id)}
              >
                <X className="size-3" aria-hidden="true" />
              </button>
            ) : null}
          </span>
        )
      })}
      {canJoin ? (
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm" className="h-6 px-2 text-caption">
              <Plus className="size-3" aria-hidden="true" />
              {t('structure.roles.join')}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-1">
            {(['head', 'deputy', 'member'] as const).map((role) => (
              <button
                key={role}
                type="button"
                className="flex w-full min-w-40 items-center rounded-sm px-2 py-2 text-left text-small hover:bg-accent"
                onClick={() => actions.onSelfAssign(unit.id, role)}
              >
                {t(`structure.roles.roleLabel.${role}`)}
              </button>
            ))}
          </PopoverContent>
        </Popover>
      ) : null}
      {canAssignOthers ? (
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-caption"
          onClick={() => actions.onOpenAssign(unit.id)}
        >
          <UserPlus className="size-3" aria-hidden="true" />
          {t('structure.roles.assign')}
        </Button>
      ) : null}
    </div>
  )
}

function UnitRow({
  node,
  depth,
  siblingIds,
  actions,
  draggingId,
  setDraggingId,
}: {
  node: TreeNode
  depth: number
  siblingIds: string[]
  actions: TreeActions
  draggingId: string | null
  setDraggingId: (id: string | null) => void
}) {
  const t = useT()
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(node.name)
  const [dropHint, setDropHint] = React.useState<'none' | 'into' | 'after'>('none')

  const commitRename = () => {
    setEditing(false)
    const trimmed = draft.trim()
    if (trimmed && trimmed !== node.name) actions.onRename(node.id, trimmed)
    else setDraft(node.name)
  }

  const reorderAfter = () => {
    if (!draggingId || draggingId === node.id) return
    if (siblingIds.includes(draggingId)) {
      const without = siblingIds.filter((id) => id !== draggingId)
      const at = without.indexOf(node.id)
      const next = [...without.slice(0, at + 1), draggingId, ...without.slice(at + 1)]
      actions.onReorderSiblings(node.parentUnitId, next)
    } else {
      actions.onReparent(draggingId, node.parentUnitId)
    }
  }

  return (
    <div>
      <div
        className={cn(
          'group flex items-center gap-2 rounded-md border border-transparent px-2 py-1.5',
          'hover:border-border hover:bg-accent/50',
          dropHint === 'into' && 'border-ring bg-accent',
        )}
        style={{ paddingInlineStart: `${depth * 24 + 8}px` }}
        draggable={actions.canEditStructure}
        onDragStart={(e) => {
          e.dataTransfer.setData('text/plain', node.id)
          setDraggingId(node.id)
        }}
        onDragEnd={() => setDraggingId(null)}
        onDragOver={(e) => {
          if (!draggingId || draggingId === node.id) return
          e.preventDefault()
          const rect = e.currentTarget.getBoundingClientRect()
          const isLowerHalf = e.clientY - rect.top > rect.height * 0.65
          setDropHint(isLowerHalf ? 'after' : 'into')
        }}
        onDragLeave={() => setDropHint('none')}
        onDrop={(e) => {
          e.preventDefault()
          const id = e.dataTransfer.getData('text/plain')
          if (id && id !== node.id) {
            if (dropHint === 'after') reorderAfter()
            else actions.onReparent(id, node.id)
          }
          setDropHint('none')
          setDraggingId(null)
        }}
      >
        {actions.canEditStructure ? (
          <GripVertical
            className="size-4 shrink-0 cursor-grab text-muted-foreground opacity-0 group-hover:opacity-100"
            aria-hidden="true"
          />
        ) : (
          <span className="size-4 shrink-0" />
        )}
        {node.children.length > 0 ? (
          <ChevronRight
            className="size-4 shrink-0 rotate-90 text-muted-foreground"
            aria-hidden="true"
          />
        ) : (
          <span className="size-4 shrink-0" />
        )}

        {actions.canEditStructure ? (
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label={t('structure.units.colourLabel')}
                className={cn('size-4 shrink-0 rounded-full', unitColourClass(node))}
              />
            </PopoverTrigger>
            <PopoverContent className="w-auto p-2">
              <div className="flex items-center gap-1.5">
                {COLOUR_OPTIONS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={`${c}`}
                    className={cn(
                      'flex size-6 items-center justify-center rounded-full bg-unit-' + c,
                    )}
                    onClick={() => actions.onColourChange(node.id, c)}
                  >
                    {node.colour === c ? (
                      <Check className="size-3.5 text-white" aria-hidden="true" />
                    ) : null}
                  </button>
                ))}
                <button
                  type="button"
                  className="ml-1 rounded-sm border border-border px-2 py-1 text-caption text-foreground hover:bg-accent"
                  onClick={() => actions.onColourChange(node.id, null)}
                >
                  {t('structure.units.colourAuto')}
                </button>
              </div>
            </PopoverContent>
          </Popover>
        ) : (
          <span className={cn('size-4 shrink-0 rounded-full', unitColourClass(node))} />
        )}

        {editing ? (
          <Input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename()
              if (e.key === 'Escape') {
                setDraft(node.name)
                setEditing(false)
              }
            }}
            className="h-8 max-w-80"
          />
        ) : (
          <button
            type="button"
            className="truncate rounded-sm px-1 text-body font-medium text-foreground hover:bg-accent disabled:cursor-default"
            disabled={!actions.canEditStructure}
            onClick={() => actions.canEditStructure && setEditing(true)}
          >
            {node.name}
          </button>
        )}

        {actions.canEditStructure ? (
          <div className="ml-auto flex items-center gap-0.5 opacity-0 group-hover:opacity-100">
            <IconButton aria-label={t('structure.units.rename')} onClick={() => setEditing(true)}>
              <Pencil className="size-4" aria-hidden="true" />
            </IconButton>
            <IconButton
              aria-label={t('structure.units.addSubUnit')}
              onClick={() => actions.onAddChild(node.id)}
            >
              <Plus className="size-4" aria-hidden="true" />
            </IconButton>
            <IconButton
              aria-label={t('structure.units.delete')}
              onClick={() => actions.onDelete(node)}
            >
              <Trash2 className="size-4" aria-hidden="true" />
            </IconButton>
          </div>
        ) : null}
      </div>

      <RoleChips unit={node} actions={actions} />

      {node.children.length > 0 ? (
        <div className="mt-1 flex flex-col gap-1">
          {node.children.map((child) => (
            <UnitRow
              key={child.id}
              node={child}
              depth={depth + 1}
              siblingIds={node.children.map((c) => c.id)}
              actions={actions}
              draggingId={draggingId}
              setDraggingId={setDraggingId}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}
