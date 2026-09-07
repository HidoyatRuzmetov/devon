// The list view of the structure editor: nested bo'limlar with inline rename, a colour popover, drag
// reorder (within a sibling group) and drag-to-nest (drop onto another row to become its child),
// collapse/expand per branch, add-sub-unit/delete, and each unit's role holders with self-assign /
// unassign / "assign someone".
import * as React from 'react'
import { useT } from '@devon/i18n'
import {
  Avatar,
  Badge,
  Button,
  Collapsible,
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
  IconButton,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Stagger,
  StaggerItem,
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
  // Collapsed branches, by unit id. Everything starts expanded -- a freshly loaded tree should show
  // its whole shape, not hide sub-bo'lims the first time someone opens the page.
  const [collapsed, setCollapsed] = React.useState<ReadonlySet<string>>(() => new Set())
  const toggleCollapsed = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <div
      className="flex flex-col gap-1 rounded-md border border-dashed border-transparent p-1 transition-colors duration-(--dur-micro)"
      onDragOver={(e) => draggingId && e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        const id = e.dataTransfer.getData('text/plain')
        if (id) actions.onReparent(id, null)
        setDraggingId(null)
      }}
    >
      <Stagger className="flex flex-col gap-1" as="ul">
        {roots.map((node) => (
          <StaggerItem key={node.id} as="li">
            <UnitRow
              node={node}
              depth={0}
              siblingIds={roots.map((r) => r.id)}
              actions={actions}
              draggingId={draggingId}
              setDraggingId={setDraggingId}
              collapsed={collapsed}
              toggleCollapsed={toggleCollapsed}
            />
          </StaggerItem>
        ))}
      </Stagger>
    </div>
  )
}

export function RoleChips({
  unit,
  actions,
  indent = true,
}: {
  unit: Unit
  actions: TreeActions
  /** The tree view indents chips under the row's icon column; a standalone context (the org chart's
   * side panel) wants them flush left instead. */
  indent?: boolean
}) {
  const t = useT()
  const roles = actions.rolesByUnit.get(unit.id) ?? []
  const myAssignment = roles.find((r) => r.userId === actions.currentUserId)
  const canJoin = !myAssignment && (actions.isHead || actions.canSelfAssign)
  const canAssignOthers = actions.isHead

  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', indent && 'pl-9')}>
      {roles.length === 0 ? (
        <span className="text-caption text-muted-foreground">
          {t('structure.units.chart.noHead')}
        </span>
      ) : null}
      {roles.map((r) => {
        const member = actions.membersById.get(r.userId)
        const canRemove = r.userId === actions.currentUserId || actions.isHead
        return (
          <HoverCard key={r.id}>
            <HoverCardTrigger asChild>
              <span className="inline-flex items-center gap-1 rounded-sm border border-border bg-card py-0.5 pl-1 pr-1.5 text-caption">
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
            </HoverCardTrigger>
            {member ? (
              <HoverCardContent className="w-64">
                <div className="flex items-center gap-3">
                  <Avatar
                    size="lg"
                    alt={fullName(member)}
                    initials={initialsFromName(member.givenName, member.familyName)}
                    hueSeed={unit.id}
                  />
                  <div className="min-w-0">
                    <p className="truncate text-body font-medium text-foreground">
                      {fullName(member)}
                    </p>
                    {member.title ? (
                      <p className="truncate text-small text-muted-foreground">{member.title}</p>
                    ) : null}
                  </div>
                </div>
              </HoverCardContent>
            ) : null}
          </HoverCard>
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
  collapsed,
  toggleCollapsed,
}: {
  node: TreeNode
  depth: number
  siblingIds: string[]
  actions: TreeActions
  draggingId: string | null
  setDraggingId: (id: string | null) => void
  collapsed: ReadonlySet<string>
  toggleCollapsed: (id: string) => void
}) {
  const t = useT()
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(node.name)
  const [dropHint, setDropHint] = React.useState<'none' | 'into' | 'before' | 'after'>('none')
  const isCollapsed = collapsed.has(node.id)
  const hasChildren = node.children.length > 0

  const commitRename = () => {
    setEditing(false)
    const trimmed = draft.trim()
    if (trimmed && trimmed !== node.name) actions.onRename(node.id, trimmed)
    else setDraft(node.name)
  }

  const reorderTo = (edge: 'before' | 'after') => {
    if (!draggingId || draggingId === node.id) return
    if (siblingIds.includes(draggingId)) {
      const without = siblingIds.filter((id) => id !== draggingId)
      const at = without.indexOf(node.id)
      const insertAt = edge === 'after' ? at + 1 : at
      const next = [...without.slice(0, insertAt), draggingId, ...without.slice(insertAt)]
      actions.onReorderSiblings(node.parentUnitId, next)
    } else {
      actions.onReparent(draggingId, node.parentUnitId)
    }
  }

  return (
    <div>
      <div className="relative">
        {dropHint === 'before' ? (
          <div
            className="absolute -top-1 z-10 h-0.5 rounded-full bg-primary"
            style={{ insetInlineStart: depth * 24 + 8, insetInlineEnd: 0 }}
            aria-hidden="true"
          />
        ) : null}
        <div
          className={cn(
            'group flex items-center gap-2 rounded-md border border-transparent px-2 py-1.5',
            'transition-[opacity,background-color,border-color] duration-(--dur-micro) ease-out',
            'hover:border-border hover:bg-accent/50 data-[dragging]:opacity-40',
            dropHint === 'into' && 'border-ring bg-accent',
          )}
          style={{ paddingInlineStart: `${depth * 24 + 8}px` }}
          draggable={actions.canEditStructure}
          data-dragging={draggingId === node.id || undefined}
          onDragStart={(e) => {
            e.dataTransfer.setData('text/plain', node.id)
            setDraggingId(node.id)
          }}
          onDragEnd={() => setDraggingId(null)}
          onDragOver={(e) => {
            if (!draggingId || draggingId === node.id) return
            e.preventDefault()
            const rect = e.currentTarget.getBoundingClientRect()
            const ratio = (e.clientY - rect.top) / rect.height
            setDropHint(ratio < 0.3 ? 'before' : ratio > 0.7 ? 'after' : 'into')
          }}
          onDragLeave={() => setDropHint('none')}
          onDrop={(e) => {
            e.preventDefault()
            const id = e.dataTransfer.getData('text/plain')
            if (id && id !== node.id) {
              if (dropHint === 'before' || dropHint === 'after') reorderTo(dropHint)
              else actions.onReparent(id, node.id)
            }
            setDropHint('none')
            setDraggingId(null)
          }}
        >
          {hasChildren ? (
            <button
              type="button"
              aria-label={
                isCollapsed
                  ? t('structure.units.expandBranch')
                  : t('structure.units.collapseBranch')
              }
              aria-expanded={!isCollapsed}
              onClick={() => toggleCollapsed(node.id)}
              className="flex size-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <ChevronRight
                className={cn(
                  'size-4 transition-transform duration-(--dur-micro) ease-out',
                  !isCollapsed && 'rotate-90',
                )}
                aria-hidden="true"
              />
            </button>
          ) : (
            <span className="size-4 shrink-0" />
          )}
          {actions.canEditStructure ? (
            <GripVertical
              className="size-4 shrink-0 cursor-grab text-muted-foreground opacity-0 group-hover:opacity-100"
              aria-hidden="true"
            />
          ) : null}

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
            <div className="ml-auto flex items-center gap-0.5 opacity-0 transition-opacity duration-(--dur-micro) group-hover:opacity-100">
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
        {dropHint === 'after' ? (
          <div
            className="absolute -bottom-1 z-10 h-0.5 rounded-full bg-primary"
            style={{ insetInlineStart: depth * 24 + 8, insetInlineEnd: 0 }}
            aria-hidden="true"
          />
        ) : null}
      </div>

      <RoleChips unit={node} actions={actions} />

      {hasChildren ? (
        <Collapsible open={!isCollapsed} id={`unit-children-${node.id}`}>
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
                collapsed={collapsed}
                toggleCollapsed={toggleCollapsed}
              />
            ))}
          </div>
        </Collapsible>
      ) : null}
    </div>
  )
}
