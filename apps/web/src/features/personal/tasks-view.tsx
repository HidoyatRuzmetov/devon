// Nested tasks with checkboxes, drag reorder and keyboard (TECH-SPEC §3.3), grouped by sprint (plus
// an "Inbox" bucket for tasks with no sprint). Drag-and-drop is native HTML5 DnD -- no extra
// dependency -- and keyboard (Tab/Shift+Tab indent/outdent, Enter to add a sibling, Cmd/Ctrl+Enter to
// mark done, Backspace on an empty title to delete, arrow keys to move focus) covers the same
// operations without a mouse.
//
// AI wiring (UI-OVERHAUL.md's brief for this area, TECH-SPEC §8): quick-add parsing cleans up a
// free-typed line before it becomes a to-do, and subtask breakdown turns one to-do into a checklist --
// both go through `<AiPreviewPanel>`'s Accept/Edit/Discard, never applying themselves.
import * as React from 'react'
import { useT, useLocale } from '@devon/i18n'
import { Plus, Sparkles } from 'lucide-react'
import {
  AiPreviewPanel,
  Card,
  Input,
  Reveal,
  Stagger,
  StaggerItem,
  StateView,
  SparkleButton,
  EmptyPersonalIllustration,
  Textarea,
  toast,
  toastWithUndo,
} from '@devon/ui'
import { useRunAiFeatureMutation } from '../ai/use-ai.js'
import { TaskRow } from './task-row.js'
import { buildTree, flattenTree, isSelfOrDescendant, type TaskNode } from './task-tree.js'
import { aiCostLine, aiErrorMessageKey } from './lib/ai-helpers.js'
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

type QuickAddAiState =
  | { sectionKey: string; status: 'pending' }
  | { sectionKey: string; status: 'ready'; title: string; costLine: string }
  | { sectionKey: string; status: 'error'; message: string }

type SubtaskAiState =
  | { taskId: string; status: 'pending' }
  | { taskId: string; status: 'ready'; subtasks: string[]; costLine: string; editing: boolean }
  | { taskId: string; status: 'error'; message: string }

export function TasksView() {
  const t = useT()
  const locale = useLocale()
  const tasksQuery = useTasksQuery()
  const sprintsQuery = useSprintsQuery()
  const createTask = useCreateTaskMutation()
  const patchTask = usePatchTaskMutation()
  const deleteTaskMutation = useDeleteTaskMutation()
  const reorderTasks = useReorderTasksMutation()
  const { schedule, cancel } = useDelayedDelete((id) => deleteTaskMutation.mutateAsync(id))
  const quickAddParse = useRunAiFeatureMutation('quick_add_parse')
  const subtaskBreakdown = useRunAiFeatureMutation('subtask_breakdown')

  const [hiddenIds, setHiddenIds] = React.useState<Set<string>>(new Set())
  const [dragId, setDragId] = React.useState<string | null>(null)
  const [overId, setOverId] = React.useState<string | null>(null)
  const inputRefs = React.useRef(new Map<string, HTMLInputElement>())
  const [quickAdd, setQuickAdd] = React.useState<Record<string, string>>({})
  const [quickAddAi, setQuickAddAi] = React.useState<QuickAddAiState | null>(null)
  const [subtaskAi, setSubtaskAi] = React.useState<SubtaskAiState | null>(null)
  const [subtaskDraft, setSubtaskDraft] = React.useState('')

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
      .filter((tk) => tk.sprintId === sprintId && tk.parentId === parentId)
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
    const parent = allTasks.find((tk) => tk.id === node.parentId)
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
    setDragId(null)
    if (!dragId || dragId === target.id) return
    if (isSelfOrDescendant(allTasks, dragId, target.id)) return
    const dragged = allTasks.find((tk) => tk.id === dragId)
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
  }

  function focusInput(id: string) {
    requestAnimationFrame(() => inputRefs.current.get(id)?.focus())
  }

  function submitQuickAdd(sprintId: string | null) {
    const sectionKey = sprintId ?? 'inbox'
    const title = (quickAdd[sectionKey] ?? '').trim()
    if (!title) return
    const siblingCount = tasksInBucket(sprintId, null).length
    createTask.mutate(
      { title, sprintId, sort: siblingCount },
      {
        onSuccess: () => {
          setQuickAdd((prev) => ({ ...prev, [sectionKey]: '' }))
          if (quickAddAi?.sectionKey === sectionKey) setQuickAddAi(null)
        },
      },
    )
  }

  function runQuickAddAi(sectionKey: string) {
    const text = (quickAdd[sectionKey] ?? '').trim()
    if (!text) return
    setQuickAddAi({ sectionKey, status: 'pending' })
    quickAddParse.mutate(
      { locale, text, memberNames: [] },
      {
        onSuccess: (res) => {
          const title = String(res.data['title'] ?? text).trim() || text
          setQuickAddAi({ sectionKey, status: 'ready', title, costLine: aiCostLine(t, res.meta) })
        },
        onError: (err) =>
          setQuickAddAi({ sectionKey, status: 'error', message: t(aiErrorMessageKey(err)) }),
      },
    )
  }

  function acceptQuickAddAi(sectionKey: string, sprintId: string | null) {
    if (quickAddAi?.sectionKey !== sectionKey || quickAddAi.status !== 'ready') return
    const siblingCount = tasksInBucket(sprintId, null).length
    createTask.mutate(
      { title: quickAddAi.title, sprintId, sort: siblingCount },
      {
        onSuccess: () => {
          setQuickAdd((prev) => ({ ...prev, [sectionKey]: '' }))
          setQuickAddAi(null)
        },
        onError: () => toast(t('toast.saveError')),
      },
    )
  }

  function editQuickAddAi(sectionKey: string) {
    if (quickAddAi?.sectionKey !== sectionKey || quickAddAi.status !== 'ready') return
    setQuickAdd((prev) => ({ ...prev, [sectionKey]: quickAddAi.title }))
    setQuickAddAi(null)
    focusInput(`quickadd-${sectionKey}`)
  }

  function runSubtaskAi(node: TaskNode) {
    setSubtaskAi({ taskId: node.id, status: 'pending' })
    subtaskBreakdown.mutate(
      {
        locale,
        cardTitle: node.title,
        cardDescription: node.notes ?? undefined,
        existingSubtasks: node.children.map((c) => c.title),
      },
      {
        onSuccess: (res) => {
          const subtasks = Array.isArray(res.data['subtasks'])
            ? (res.data['subtasks'] as unknown[]).map(String).filter(Boolean)
            : []
          setSubtaskAi({
            taskId: node.id,
            status: 'ready',
            subtasks,
            costLine: aiCostLine(t, res.meta),
            editing: false,
          })
          setSubtaskDraft(subtasks.join('\n'))
        },
        onError: (err) =>
          setSubtaskAi({ taskId: node.id, status: 'error', message: t(aiErrorMessageKey(err)) }),
      },
    )
  }

  async function acceptSubtaskAi(node: TaskNode) {
    if (subtaskAi?.taskId !== node.id || subtaskAi.status !== 'ready') return
    const lines = subtaskAi.editing
      ? subtaskDraft
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean)
      : subtaskAi.subtasks
    if (lines.length === 0) {
      setSubtaskAi(null)
      return
    }
    const baseSort = tasksInBucket(node.sprintId, node.id).length
    setSubtaskAi(null)
    // Each subtask's `sort` is precomputed from its index, not from the previous create's
    // response, so these writes are independent -- Promise.all, not a sequential loop (TECH-SPEC
    // §16: no query in a loop / avoid awaiting inside a for-of over independent items).
    await Promise.all(
      lines.map((title, i) =>
        createTask.mutateAsync({
          title,
          sprintId: node.sprintId,
          parentId: node.id,
          sort: baseSort + i,
        }),
      ),
    )
  }

  return (
    <Stagger className="flex flex-col gap-6" animateKey={sections.map((s) => s.key).join(',')}>
      {sections.map((section) => {
        const bucketTasks = allTasks.filter((tk) => tk.sprintId === section.sprintId)
        const tree = buildTree(bucketTasks)
        const flat = flattenTree(tree)
        const openCount = bucketTasks.filter((tk) => tk.doneAt === null).length
        const sectionKey = section.sprintId ?? 'inbox'
        const quickAddAiForSection = quickAddAi?.sectionKey === sectionKey ? quickAddAi : null

        return (
          <StaggerItem key={section.key}>
            <Card padding="md" className="flex flex-col gap-1">
              <div className="mb-1 flex items-center justify-between gap-2">
                <h3 className="text-h3 text-foreground">{section.title}</h3>
                {openCount > 0 ? (
                  <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-caption tabular-nums text-muted-foreground">
                    {t('personal.tasks.openCount', { count: openCount })}
                  </span>
                ) : null}
              </div>

              {flat.length === 0 ? (
                <div className="flex flex-col items-center gap-2 px-1 py-4 text-center">
                  <EmptyPersonalIllustration className="w-20 text-illustration-ink" />
                  <p className="text-small text-muted-foreground">
                    {t('personal.tasks.empty.section')}
                  </p>
                </div>
              ) : (
                <div>
                  {flat.map((node) => (
                    <React.Fragment key={node.id}>
                      <TaskRow
                        node={node}
                        isDropTarget={overId === node.id}
                        isDragging={dragId === node.id}
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
                        onAiSubtasks={runSubtaskAi}
                        aiSubtasksPending={
                          subtaskAi?.taskId === node.id && subtaskAi.status === 'pending'
                        }
                      />
                      {subtaskAi?.taskId === node.id ? (
                        <div
                          className="py-2"
                          style={{ paddingInlineStart: `${(node.depth + 1) * 20}px` }}
                        >
                          <AiPreviewPanel
                            title={t('personal.ai.subtasks.title')}
                            status={subtaskAi.status}
                            pendingLabel={t('personal.ai.pending')}
                            acceptLabel={t('personal.ai.accept')}
                            editLabel={t('personal.ai.edit')}
                            discardLabel={t('personal.ai.discard')}
                            {...(subtaskAi.status === 'error'
                              ? { errorMessage: subtaskAi.message }
                              : {})}
                            {...(subtaskAi.status === 'ready'
                              ? { costLine: subtaskAi.costLine }
                              : {})}
                            onAccept={() => void acceptSubtaskAi(node)}
                            onDiscard={() => setSubtaskAi(null)}
                            onEdit={() =>
                              setSubtaskAi((prev) =>
                                prev && prev.status === 'ready'
                                  ? { ...prev, editing: !prev.editing }
                                  : prev,
                              )
                            }
                          >
                            {subtaskAi.status === 'ready' ? (
                              subtaskAi.editing ? (
                                <Textarea
                                  value={subtaskDraft}
                                  onChange={(e) => setSubtaskDraft(e.target.value)}
                                  rows={Math.max(3, subtaskAi.subtasks.length)}
                                  aria-label={t('personal.ai.subtasks.editAria')}
                                />
                              ) : (
                                <ul className="flex flex-col gap-1.5">
                                  {subtaskAi.subtasks.map((s, i) => (
                                    <li key={i} className="flex items-start gap-2 text-body">
                                      <Sparkles
                                        className="mt-0.5 size-3.5 shrink-0 text-primary"
                                        aria-hidden="true"
                                      />
                                      <span>{s}</span>
                                    </li>
                                  ))}
                                </ul>
                              )
                            ) : null}
                          </AiPreviewPanel>
                        </div>
                      ) : null}
                    </React.Fragment>
                  ))}
                </div>
              )}

              <form
                className="mt-1 flex items-center gap-1.5 px-1"
                onSubmit={(e) => {
                  e.preventDefault()
                  submitQuickAdd(section.sprintId)
                }}
              >
                <Plus className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <Input
                  ref={(el) => {
                    if (el) inputRefs.current.set(`quickadd-${sectionKey}`, el)
                    else inputRefs.current.delete(`quickadd-${sectionKey}`)
                  }}
                  value={quickAdd[sectionKey] ?? ''}
                  onChange={(e) =>
                    setQuickAdd((prev) => ({ ...prev, [sectionKey]: e.target.value }))
                  }
                  placeholder={t('personal.tasks.addPlaceholder')}
                  className="h-8 border-none bg-transparent px-1 shadow-none focus-visible:ring-0"
                />
                <SparkleButton
                  aria-label={t('personal.ai.quickAdd.action')}
                  size="sm"
                  loading={quickAddAiForSection?.status === 'pending'}
                  disabled={!(quickAdd[sectionKey] ?? '').trim()}
                  onClick={() => runQuickAddAi(sectionKey)}
                />
              </form>

              {quickAddAiForSection ? (
                <Reveal className="px-1 pb-1">
                  <AiPreviewPanel
                    title={t('personal.ai.quickAdd.title')}
                    status={quickAddAiForSection.status}
                    pendingLabel={t('personal.ai.pending')}
                    acceptLabel={t('personal.ai.accept')}
                    editLabel={t('personal.ai.edit')}
                    discardLabel={t('personal.ai.discard')}
                    {...(quickAddAiForSection.status === 'error'
                      ? { errorMessage: quickAddAiForSection.message }
                      : {})}
                    {...(quickAddAiForSection.status === 'ready'
                      ? { costLine: quickAddAiForSection.costLine }
                      : {})}
                    onAccept={() => acceptQuickAddAi(sectionKey, section.sprintId)}
                    onDiscard={() => setQuickAddAi(null)}
                    onEdit={() => editQuickAddAi(sectionKey)}
                  >
                    {quickAddAiForSection.status === 'ready' ? (
                      <p>{quickAddAiForSection.title}</p>
                    ) : null}
                  </AiPreviewPanel>
                </Reveal>
              ) : null}
            </Card>
          </StaggerItem>
        )
      })}
    </Stagger>
  )
}
