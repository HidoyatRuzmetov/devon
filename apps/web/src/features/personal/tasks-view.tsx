// Nested tasks with checkboxes, drag reorder and keyboard (TECH-SPEC §3.3), grouped by sprint (plus
// an "Inbox" bucket for tasks with no sprint). Drag-and-drop is native HTML5 DnD -- no extra
// dependency -- and keyboard (Tab/Shift+Tab indent/outdent, Enter to add a sibling, Backspace on an
// empty title to delete, arrow keys to move focus) covers the same operations without a mouse.
import * as React from 'react'
import { useT } from '@devon/i18n'
import { Plus } from 'lucide-react'
import { Input, StateView, toastWithUndo } from '@devon/ui'
import { TaskRow } from './task-row.js'
import { buildTree, flattenTree, isSelfOrDescendant, type TaskNode } from './task-tree.js'
import {
  useCreateTaskMutation,
  useDelayedDelete,
  useDeleteTaskMutation,
  usePatchTaskMutation,
  useReorderTasksMutation,
  useSprintsQuery,
  useTasksQuery,
} from './use-personal.js'
import type { Task } from './types.js'

export function TasksView() {
  const t = useT()
  const tasksQuery = useTasksQuery()
  const sprintsQuery = useSprintsQuery()
  const createTask = useCreateTaskMutation()
  const patchTask = usePatchTaskMutation()
  const deleteTaskMutation = useDeleteTaskMutation()
  const reorderTasks = useReorderTasksMutation()
  const { schedule, cancel } = useDelayedDelete((id) => deleteTaskMutation.mutateAsync(id))

  const [hiddenIds, setHiddenIds] = React.useState<Set<string>>(new Set())
  const [dragId, setDragId] = React.useState<string | null>(null)
  const [overId, setOverId] = React.useState<string | null>(null)
  const inputRefs = React.useRef(new Map<string, HTMLInputElement>())
  const [quickAdd, setQuickAdd] = React.useState<Record<string, string>>({})

  if (tasksQuery.isPending || sprintsQuery.isPending) {
    return <StateView kind="loading" titleKey="state.loading" />
  }
  if (tasksQuery.isError) {
    return (
      <StateView
        kind="error"
        titleKey="state.error.title"
        bodyKey="state.error.body"
        action={{ labelKey: 'state.error.action', onAction: () => tasksQuery.refetch() }}
      />
    )
  }

  const allTasks = tasksQuery.data.filter((task) => !hiddenIds.has(task.id))
  const sprints = sprintsQuery.data ?? []
  const activeSprints = sprints.filter((s) => s.status === 'active')

  const sections: { key: string; sprintId: string | null; title: string }[] = [
    { key: 'inbox', sprintId: null, title: t('personal.tasks.inbox') },
    ...activeSprints.map((s) => ({
      key: s.id,
      sprintId: s.id,
      title: s.goal || t(`personal.sprints.kind.${s.kind === '3h' ? 'threeHour' : s.kind}`),
    })),
  ]

  function tasksInBucket(sprintId: string | null, parentId: string | null): Task[] {
    return allTasks
      .filter((t) => t.sprintId === sprintId && t.parentId === parentId)
      .sort((a, b) => a.sort - b.sort)
  }

  function scheduleDelete(node: TaskNode) {
    setHiddenIds((prev) => new Set(prev).add(node.id))
    schedule(node.id)
    toastWithUndo({
      message: t('personal.tasks.deleted.toast'),
      undoLabel: t('action.undo'),
      onUndo: () => {
        cancel(node.id)
        setHiddenIds((prev) => {
          const next = new Set(prev)
          next.delete(node.id)
          return next
        })
      },
    })
  }

  function indent(node: TaskNode) {
    const siblings = tasksInBucket(node.sprintId, node.parentId)
    const idx = siblings.findIndex((s) => s.id === node.id)
    if (idx <= 0) return
    const newParent = siblings[idx - 1]!
    const newSiblingChildren = tasksInBucket(node.sprintId, newParent.id)
    const newSort = (newSiblingChildren.at(-1)?.sort ?? -1) + 1
    patchTask.mutate({
      id: node.id,
      input: { parentId: newParent.id, sort: newSort, version: node.version },
    })
  }

  function outdent(node: TaskNode) {
    if (!node.parentId) return
    const parent = allTasks.find((t) => t.id === node.parentId)
    if (!parent) return
    const grandParentId = parent.parentId
    const parentSiblings = tasksInBucket(parent.sprintId, grandParentId)
    const parentIndex = parentSiblings.findIndex((s) => s.id === parent.id)
    const withoutNode = parentSiblings.filter((s) => s.id !== node.id)
    const orderedIds = [
      ...withoutNode.slice(0, parentIndex + 1).map((s) => s.id),
      node.id,
      ...withoutNode.slice(parentIndex + 1).map((s) => s.id),
    ]
    reorderTasks.mutate({
      items: orderedIds.map((id, sort) =>
        id === node.id
          ? { id, sort, parentId: grandParentId, sprintId: parent.sprintId }
          : { id, sort },
      ),
    })
  }

  function handleDrop(target: TaskNode) {
    setOverId(null)
    if (!dragId || dragId === target.id) return
    if (isSelfOrDescendant(allTasks, dragId, target.id)) return
    const dragged = allTasks.find((t) => t.id === dragId)
    if (!dragged) return
    const siblings = tasksInBucket(target.sprintId, target.parentId).filter((s) => s.id !== dragId)
    const targetIndex = siblings.findIndex((s) => s.id === target.id)
    const orderedIds = [
      ...siblings.slice(0, targetIndex).map((s) => s.id),
      dragId,
      ...siblings.slice(targetIndex).map((s) => s.id),
    ]
    reorderTasks.mutate({
      items: orderedIds.map((id, sort) =>
        id === dragId
          ? { id, sort, parentId: target.parentId, sprintId: target.sprintId }
          : { id, sort },
      ),
    })
    setDragId(null)
  }

  function focusInput(id: string) {
    requestAnimationFrame(() => inputRefs.current.get(id)?.focus())
  }

  function submitQuickAdd(sprintId: string | null) {
    const title = (quickAdd[sprintId ?? 'inbox'] ?? '').trim()
    if (!title) return
    const siblingCount = tasksInBucket(sprintId, null).length
    createTask.mutate(
      { title, sprintId, sort: siblingCount },
      { onSuccess: () => setQuickAdd((prev) => ({ ...prev, [sprintId ?? 'inbox']: '' })) },
    )
  }

  return (
    <div className="flex flex-col gap-8">
      {sections.map((section) => {
        const bucketTasks = allTasks.filter((tk) => tk.sprintId === section.sprintId)
        const tree = buildTree(bucketTasks)
        const flat = flattenTree(tree)
        return (
          <section key={section.key} className="flex flex-col gap-1">
            <h3 className="mb-1 text-h3 text-foreground">{section.title}</h3>
            {flat.length === 0 ? (
              <p className="px-1 text-small text-muted-foreground">
                {t('personal.tasks.empty.section')}
              </p>
            ) : (
              <div>
                {flat.map((node) => (
                  <TaskRow
                    key={node.id}
                    node={node}
                    isDropTarget={overId === node.id}
                    registerInputRef={(id, el) => {
                      if (el) inputRefs.current.set(id, el)
                      else inputRefs.current.delete(id)
                    }}
                    onToggleDone={(n) =>
                      patchTask.mutate({
                        id: n.id,
                        input: { done: n.doneAt === null, version: n.version },
                      })
                    }
                    onTitleCommit={(n, title) =>
                      patchTask.mutate({ id: n.id, input: { title, version: n.version } })
                    }
                    onIndent={indent}
                    onOutdent={outdent}
                    onDelete={scheduleDelete}
                    onEnter={() => {
                      const siblingCount = tasksInBucket(section.sprintId, null).length
                      createTask.mutate(
                        { title: '', sprintId: section.sprintId, sort: siblingCount },
                        { onSuccess: (created) => focusInput(created.id) },
                      )
                    }}
                    onDragStart={(n) => setDragId(n.id)}
                    onDragOver={(n) => setOverId(n.id)}
                    onDrop={handleDrop}
                    onFocusMove={(n, direction) => {
                      const idx = flat.findIndex((x) => x.id === n.id)
                      const nextNode = direction === 'up' ? flat[idx - 1] : flat[idx + 1]
                      if (nextNode) focusInput(nextNode.id)
                    }}
                  />
                ))}
              </div>
            )}
            <form
              className="mt-1 flex items-center gap-2 px-1"
              onSubmit={(e) => {
                e.preventDefault()
                submitQuickAdd(section.sprintId)
              }}
            >
              <Plus className="size-4 text-muted-foreground" aria-hidden="true" />
              <Input
                value={quickAdd[section.sprintId ?? 'inbox'] ?? ''}
                onChange={(e) =>
                  setQuickAdd((prev) => ({
                    ...prev,
                    [section.sprintId ?? 'inbox']: e.target.value,
                  }))
                }
                placeholder={t('personal.tasks.addPlaceholder')}
                className="h-8 border-none bg-transparent px-1 shadow-none focus-visible:ring-0"
              />
            </form>
          </section>
        )
      })}
    </div>
  )
}
