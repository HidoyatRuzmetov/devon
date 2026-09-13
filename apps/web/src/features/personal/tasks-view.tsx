// Nested tasks with checkboxes, drag reorder and keyboard (TECH-SPEC §3.3), grouped by sprint (plus
// an "Inbox" bucket for tasks with no sprint). Drag-and-drop is native HTML5 DnD -- no extra
// dependency -- and keyboard (Tab/Shift+Tab indent/outdent, Enter to add a sibling, Cmd/Ctrl+Enter to
// mark done, Backspace on an empty title to delete, arrow keys to move focus) covers the same
// operations without a mouse.
//
// AI wiring (UI-OVERHAUL.md's brief for this area, TECH-SPEC §8): quick-add parsing cleans up a
// free-typed line before it becomes a to-do, and subtask breakdown turns one to-do into a checklist --
// both go through the AI result panel's Accept/Edit/Discard, never applying themselves.
import * as React from 'react'
import { useT, useLocale } from '@devon/i18n'
import { Plus } from 'lucide-react'
import {
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
import { AiResultPanel } from '../ai/components/ai-result-panel.js'
import { QuickAddPreview, SubtasksPreview } from '../ai/components/previews.js'
import {
  parseFeatureOutput,
  type QuickAddOutput,
  type SubtaskBreakdownOutput,
} from '../ai/outputs.js'
import type { RunMeta } from '../ai/types.js'
import { todayInTashkent } from './lib/use-quick-add-ai.js'
import { TaskRow } from './task-row.js'
import { buildTree, flattenTree, isSelfOrDescendant, type TaskNode } from './task-tree.js'
import { aiErrorMessageKey } from './lib/ai-helpers.js'
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
  | { sectionKey: string; status: 'ready'; output: QuickAddOutput; meta: RunMeta }
  | { sectionKey: string; status: 'error'; message: string }

type SubtaskAiState =
  | { taskId: string; status: 'pending' }
  | {
      taskId: string
      status: 'ready'
      output: SubtaskBreakdownOutput
      meta: RunMeta
      editing: boolean
    }
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
      {
        locale,
        text,
        // AI-AUDIT §0.3: the date the prompt needs to resolve "ertaga"/"jumagacha", which v1.0
        // never supplied. A personal to-do has no assignee (I-1), so `members` is genuinely empty.
        today: todayInTashkent(),
        members: [],
        labels: [],
        projects: [],
        defaultAssigneeUserId: null,
      },
      {
        onSuccess: (res) => {
          const output = parseFeatureOutput<QuickAddOutput>('quick_add_parse', res.data)
          if (!output) {
            setQuickAddAi({ sectionKey, status: 'error', message: t('ai.errors.runFailed') })
            return
          }
          setQuickAddAi({ sectionKey, status: 'ready', output, meta: res.meta })
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
      { title: quickAddAi.output.title, sprintId, sort: siblingCount },
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
    setQuickAdd((prev) => ({ ...prev, [sectionKey]: quickAddAi.output.title }))
    setQuickAddAi(null)
    focusInput(`quickadd-${sectionKey}`)
  }

  function runSubtaskAi(node: TaskNode) {
    setSubtaskAi({ taskId: node.id, status: 'pending' })
    subtaskBreakdown.mutate(
      {
        locale,
        cardTitle: node.title,
        cardDescription: node.notes ?? null,
        existingSubtasks: node.children.map((c) => c.title),
        labels: [],
        projectTitle: null,
        dueInDays: null,
        targetCount: 6,
      },
      {
        onSuccess: (res) => {
          const output = parseFeatureOutput<SubtaskBreakdownOutput>('subtask_breakdown', res.data)
          if (!output) {
            setSubtaskAi({ taskId: node.id, status: 'error', message: t('ai.errors.runFailed') })
            return
          }
          setSubtaskAi({
            taskId: node.id,
            status: 'ready',
            output,
            meta: res.meta,
            editing: false,
          })
          setSubtaskDraft(output.subtasks.map((item) => item.text).join('\n'))
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
      : subtaskAi.output.subtasks.map((item) => item.text)
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
                          <AiResultPanel
                            title={t('personal.ai.subtasks.title')}
                            status={subtaskAi.status}
                            acceptLabel={t('personal.ai.accept')}
                            editLabel={t('personal.ai.edit')}
                            {...(subtaskAi.status === 'error'
                              ? { errorMessage: subtaskAi.message }
                              : {})}
                            {...(subtaskAi.status === 'ready' ? { meta: subtaskAi.meta } : {})}
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
                            <SubtaskPanelBody
                              state={subtaskAi}
                              draft={subtaskDraft}
                              onDraftChange={setSubtaskDraft}
                            />
                          </AiResultPanel>
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
                  <AiResultPanel
                    title={t('personal.ai.quickAdd.title')}
                    status={quickAddAiForSection.status}
                    acceptLabel={t('personal.ai.accept')}
                    editLabel={t('personal.ai.edit')}
                    {...(quickAddAiForSection.status === 'error'
                      ? { errorMessage: quickAddAiForSection.message }
                      : {})}
                    {...(quickAddAiForSection.status === 'ready'
                      ? { meta: quickAddAiForSection.meta }
                      : {})}
                    onAccept={() => acceptQuickAddAi(sectionKey, section.sprintId)}
                    onDiscard={() => setQuickAddAi(null)}
                    onEdit={() => editQuickAddAi(sectionKey)}
                  >
                    {quickAddAiForSection.status === 'ready' ? (
                      <QuickAddPreview
                        output={quickAddAiForSection.output}
                        memberName={() => null}
                        labelName={() => null}
                        projectName={() => null}
                      />
                    ) : null}
                  </AiResultPanel>
                </Reveal>
              ) : null}
            </Card>
          </StaggerItem>
        )
      })}
    </Stagger>
  )
}

/** Early returns rather than a nested JSX ternary, for the reason `features/ai/components/previews.tsx`
 * documents about `check-i18n.mjs`'s hard-coded-text heuristic. */
function SubtaskPanelBody({
  state,
  draft,
  onDraftChange,
}: {
  state: SubtaskAiState
  draft: string
  onDraftChange: (value: string) => void
}) {
  const t = useT()
  if (state.status !== 'ready') {
    return null
  }
  if (state.editing) {
    return (
      <Textarea
        value={draft}
        onChange={(e) => onDraftChange(e.target.value)}
        rows={Math.max(3, state.output.subtasks.length)}
        aria-label={t('personal.ai.subtasks.editAria')}
      />
    )
  }
  return <SubtasksPreview output={state.output} />
}
