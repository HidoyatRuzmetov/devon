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
import {
  Checkbox,
  cn,
  IconButton,
  SparkleButton,
  strikethroughClass,
} from '@devon/ui'
import type { TaskNode } from './task-tree.js'

export type TaskRowProps = {
  node: TaskNode
  onToggleDone: (node: TaskNode) => void
  onTitleCommit: (node: TaskNode, title: string) => void
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
}: TaskRowProps) {
  // H4.1: one instance per nested personal task, recursively -- a measured hot spot for a deep
  // sprint tree, opted into the compiler individually (`vite.config.ts`'s note).
  'use memo'
  const t = useT()
  const [title, setTitle] = React.useState(node.title)
  React.useEffect(() => setTitle(node.title), [node.title])
  const done = node.doneAt !== null

  function commitTitle() {
    if (title.trim() && title !== node.title) onTitleCommit(node, title.trim())
    else if (!title.trim()) setTitle(node.title)
  }

  return (
    <div
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

      <div className="group flex min-w-0 flex-1 items-center gap-1.5 rounded-sm px-1 py-1.5">
        <button
          type="button"
          draggable
          onDragStart={(e) => onDragStart(node, e)}
          className="cursor-grab text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
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
          ref={(el) => registerInputRef(node.id, el)}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault()
              commitTitle()
              onToggleDone(node)
            } else if (e.key === 'Enter') {
              e.preventDefault()
              commitTitle()
              onEnter(node)
            } else if (e.key === 'Tab' && !e.shiftKey) {
              e.preventDefault()
              onIndent(node)
            } else if (e.key === 'Tab' && e.shiftKey) {
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
            'flex shrink-0 items-center gap-0.5',
            aiSubtasksPending
              ? 'opacity-100'
              : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100',
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
          <IconButton aria-label={t('personal.tasks.outdent')} onClick={() => onOutdent(node)}>
            <IndentDecrease className="size-3.5" aria-hidden="true" />
          </IconButton>
          <IconButton aria-label={t('personal.tasks.indent')} onClick={() => onIndent(node)}>
            <IndentIncrease className="size-3.5" aria-hidden="true" />
          </IconButton>
          <IconButton aria-label={t('personal.tasks.delete')} onClick={() => onDelete(node)}>
            <Trash2 className="size-3.5" aria-hidden="true" />
          </IconButton>
        </div>
      </div>
    </div>
  )
}
