// One row of the nested task tree -- checkbox (with the done celebration), inline title edit, indent
// guides, indent/outdent, an AI "break into subtasks" affordance, drag handle, delete. Shared between
// `tasks-view.tsx` and `today-view.tsx`.
import * as React from 'react'
import { useT } from '@devon/i18n'
import {
  ChevronRight,
  GripVertical,
  IndentDecrease,
  IndentIncrease,
  Link2,
  Trash2,
} from 'lucide-react'
import { Button, Checkbox, cn, IconButton, SparkleButton, strikethroughClass } from '@devon/ui'
import { ApiError } from '../../lib/api-client.js'
import type { TaskNode } from './task-tree.js'

export type TaskRowProps = {
  node: TaskNode
  onToggleDone: (node: TaskNode) => void
  onTitleCommit: (node: TaskNode, title: string) => Promise<unknown>
  onIndent: (node: TaskNode) => void
  onOutdent: (node: TaskNode) => void
  onDelete: (node: TaskNode) => void
  onEnter: (node: TaskNode) => void
  onDragStart: (node: TaskNode, e: React.DragEvent) => void
  onDragOver: (node: TaskNode, e: React.DragEvent) => void
  onDrop: (node: TaskNode, e: React.DragEvent) => void
  isDropTarget: boolean
  isDragging?: boolean
  registerInputRef: (id: string, el: HTMLInputElement | null) => void
  onFocusMove: (node: TaskNode, direction: 'up' | 'down') => void
  /** Omitted where an AI budget/flag check has already ruled the feature out for this screen. */
  onAiSubtasks?: (node: TaskNode) => void
  aiSubtasksPending?: boolean
  deletePending?: boolean
  canIndent?: boolean
}

export function TaskRow({
  node,
  onToggleDone,
  onTitleCommit,
  onIndent,
  onOutdent,
  onDelete,
  onEnter,
  onDragStart,
  onDragOver,
  onDrop,
  isDropTarget,
  isDragging = false,
  registerInputRef,
  onFocusMove,
  onAiSubtasks,
  aiSubtasksPending = false,
  deletePending = false,
  canIndent = true,
}: TaskRowProps) {
  // H4.1: one instance per nested personal task, recursively -- a measured hot spot for a deep
  // sprint tree, opted into the compiler individually (`vite.config.ts`'s note).
  'use memo'
  const t = useT()
  const [title, setTitle] = React.useState(node.title)
  const titleDraft = React.useRef(node.title)
  const lastSavedTitle = React.useRef(node.title)
  const titleVersion = React.useRef(node.version)
  const titleDirty = React.useRef(false)
  const titleSave = React.useRef<{ value: string; promise: Promise<boolean> } | null>(null)
  const [titleFailure, setTitleFailure] = React.useState<'error' | 'conflict' | 'required' | null>(
    null,
  )
  React.useEffect(() => {
    if (!titleDirty.current) {
      titleDraft.current = node.title
      lastSavedTitle.current = node.title
      titleVersion.current = node.version
      setTitle(node.title)
    }
  }, [node.title, node.version])
  const done = node.doneAt !== null

  function commitTitle(): Promise<boolean> {
    const submitted = titleDraft.current.trim()
    if (!submitted) {
      setTitleFailure('required')
      return Promise.resolve(false)
    }
    if (titleSave.current?.value === submitted) return titleSave.current.promise
    if (!titleDirty.current || submitted === lastSavedTitle.current) return Promise.resolve(true)
    const promise = onTitleCommit({ ...node, version: titleVersion.current }, submitted)
      .then(() => {
        setTitleFailure(null)
        lastSavedTitle.current = submitted
        if (titleDraft.current.trim() === submitted) titleDirty.current = false
        return true
      })
      .catch((error) => {
        setTitleFailure(error instanceof ApiError && error.status === 409 ? 'conflict' : 'error')
        return false
      })
      .finally(() => {
        if (titleSave.current?.promise === promise) titleSave.current = null
      })
    titleSave.current = { value: submitted, promise }
    return promise
  }

  return (
    <div
      data-personal-task-id={node.id}
      className={cn(
        'group/row flex items-stretch transition-[background-color,opacity,transform] duration-(--dur-standard) ease-(--ease-standard)',
        isDropTarget && 'rounded-sm bg-accent',
        isDragging && 'opacity-40',
      )}
      onDragOver={(e) => {
        e.preventDefault()
        onDragOver(node, e)
      }}
      onDrop={(e) => {
        e.preventDefault()
        onDrop(node, e)
      }}
    >
      {Array.from({ length: node.depth }).map((_, i) => (
        <span
          key={i}
          aria-hidden="true"
          className="ml-2.5 w-2.5 shrink-0 border-l border-border/70"
        />
      ))}

      <div className="group flex min-w-0 flex-1 flex-wrap items-center gap-1.5 rounded-sm px-1 py-1.5 md:flex-nowrap">
        <button
          type="button"
          draggable
          onDragStart={(e) => onDragStart(node, e)}
          className="inline-flex size-6 shrink-0 cursor-grab items-center justify-center rounded-sm text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
          aria-label={t('personal.tasks.dragHandle')}
        >
          <GripVertical className="size-4" aria-hidden="true" />
        </button>

        {node.children.length > 0 ? (
          <ChevronRight className="size-3.5 text-muted-foreground" aria-hidden="true" />
        ) : (
          <span className="inline-block size-3.5" aria-hidden="true" />
        )}

        <Checkbox
          celebrate
          checked={done}
          onCheckedChange={() => onToggleDone(node)}
          aria-label={t('personal.tasks.toggleDone')}
          size="sm"
          className="relative shrink-0"
        />

        <input
          aria-label={t('personal.tasks.title')}
          maxLength={300}
          aria-invalid={Boolean(titleFailure) || undefined}
          aria-describedby={titleFailure ? `personal-task-error-${node.id}` : undefined}
          ref={(el) => registerInputRef(node.id, el)}
          value={title}
          onChange={(e) => {
            if (!titleDirty.current) titleVersion.current = node.version
            titleDraft.current = e.target.value
            titleDirty.current = true
            setTitle(e.target.value)
            if (titleFailure === 'required' && e.target.value.trim()) setTitleFailure(null)
          }}
          onBlur={() => void commitTitle()}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault()
              void commitTitle().then((saved) => {
                if (saved) onToggleDone(node)
              })
            } else if (e.key === 'Enter') {
              e.preventDefault()
              void commitTitle().then((saved) => {
                if (saved) onEnter(node)
              })
            } else if (e.key === 'ArrowRight' && e.altKey && !e.ctrlKey && !e.metaKey) {
              e.preventDefault()
              onIndent(node)
            } else if (e.key === 'ArrowLeft' && e.altKey && !e.ctrlKey && !e.metaKey) {
              e.preventDefault()
              onOutdent(node)
            } else if (e.key === 'Backspace' && title.length === 0) {
              e.preventDefault()
              onDelete(node)
            } else if (e.key === 'ArrowUp' && !e.shiftKey && !e.altKey) {
              e.preventDefault()
              onFocusMove(node, 'up')
            } else if (e.key === 'ArrowDown' && !e.shiftKey && !e.altKey) {
              e.preventDefault()
              onFocusMove(node, 'down')
            }
          }}
          className={cn(
            'min-w-0 flex-1 rounded-sm border border-transparent bg-transparent px-1.5 py-1 text-body',
            'text-foreground transition-colors duration-(--dur-micro) ease-out',
            'focus-visible:border-border focus-visible:outline-none',
            // The title is an `<input>` (the row is inline-editable), so the gesture arrives as a
            // class rather than a wrapper -- same two transitions either way.
            done && strikethroughClass(true),
          )}
        />

        {node.linkedCardId ? (
          <Link2 className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        ) : null}
        {node.estimateMin ? (
          // ui-blitz round3 #21: a bare mathematical prime mark ("30′") is an unlocalised,
          // ambiguous stand-in for minutes -- the app already has a real, translated unit
          // (`personal.duration.minutesShort`, used by `sprint-labels.ts`'s `formatTimeLeft`);
          // U+00A0 keeps the number and its unit from wrapping apart, same convention as there.
          <span className="shrink-0 text-caption tabular-nums text-muted-foreground">
            {node.estimateMin}
            {' '}
            {t('personal.duration.minutesShort')}
          </span>
        ) : null}

        <div
          className={cn(
            'ml-auto flex shrink-0 items-center gap-0.5 max-md:w-full max-md:justify-end',
            aiSubtasksPending
              ? 'opacity-100'
              : 'md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100',
          )}
        >
          {onAiSubtasks ? (
            <SparkleButton
              aria-label={t('personal.ai.subtasks.action')}
              size="sm"
              loading={aiSubtasksPending}
              onClick={() => onAiSubtasks(node)}
            />
          ) : null}
          <IconButton
            aria-label={t('personal.tasks.outdent')}
            tooltip={t('personal.tasks.outdentHint')}
            disabled={node.parentId === null}
            onClick={() => onOutdent(node)}
          >
            <IndentDecrease className="size-3.5" aria-hidden="true" />
          </IconButton>
          <IconButton
            aria-label={t('personal.tasks.indent')}
            tooltip={t('personal.tasks.indentHint')}
            disabled={!canIndent}
            onClick={() => onIndent(node)}
          >
            <IndentIncrease className="size-3.5" aria-hidden="true" />
          </IconButton>
          <IconButton
            aria-label={t('personal.tasks.delete')}
            disabled={deletePending}
            aria-busy={deletePending}
            onClick={() => onDelete(node)}
          >
            <Trash2 className="size-3.5" aria-hidden="true" />
          </IconButton>
        </div>
        {titleFailure ? (
          <div className="flex w-full flex-wrap items-center gap-2">
            <p
              id={`personal-task-error-${node.id}`}
              role="alert"
              className="text-small text-destructive"
            >
              {t(
                titleFailure === 'required'
                  ? 'personal.save.titleRequired'
                  : titleFailure === 'conflict'
                    ? 'personal.save.conflict'
                    : 'personal.save.error',
              )}
            </p>
            {titleFailure !== 'required' ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  titleVersion.current = node.version
                  void commitTitle()
                }}
              >
                {t('personal.save.retry')}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}
