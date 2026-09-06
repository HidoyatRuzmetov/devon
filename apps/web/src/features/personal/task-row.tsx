// One row of the nested task tree -- checkbox, inline title edit, indent/outdent, drag handle,
// delete. Shared between `tasks-view.tsx` and `today-view.tsx`.
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
import { IconButton, cn } from '@devon/ui'
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
  registerInputRef: (id: string, el: HTMLInputElement | null) => void
  onFocusMove: (node: TaskNode, direction: 'up' | 'down') => void
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
  registerInputRef,
  onFocusMove,
}: TaskRowProps) {
  const t = useT()
  const [title, setTitle] = React.useState(node.title)
  React.useEffect(() => setTitle(node.title), [node.title])
  const done = node.doneAt !== null

  return (
    <div
      className={cn(
        'group flex items-center gap-1.5 rounded-sm px-1 py-1',
        isDropTarget && 'bg-accent',
      )}
      style={{ paddingInlineStart: `${node.depth * 20}px` }}
      onDragOver={(e) => {
        e.preventDefault()
        onDragOver(node, e)
      }}
      onDrop={(e) => {
        e.preventDefault()
        onDrop(node, e)
      }}
    >
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

      <input
        type="checkbox"
        checked={done}
        onChange={() => onToggleDone(node)}
        aria-label={t('personal.tasks.toggleDone')}
        className="size-4 shrink-0 rounded-sm border-border"
      />

      <input
        ref={(el) => registerInputRef(node.id, el)}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => {
          if (title.trim() && title !== node.title) onTitleCommit(node, title.trim())
          else if (!title.trim()) setTitle(node.title)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            if (title.trim() && title !== node.title) onTitleCommit(node, title.trim())
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
          'text-foreground focus-visible:border-border focus-visible:outline-none',
          done && 'text-muted-foreground line-through',
        )}
      />

      {node.linkedCardId ? (
        <Link2 className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      ) : null}
      {node.estimateMin ? (
        <span className="shrink-0 text-caption text-muted-foreground">{node.estimateMin}′</span>
      ) : null}

      <div className="flex shrink-0 gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
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
  )
}
