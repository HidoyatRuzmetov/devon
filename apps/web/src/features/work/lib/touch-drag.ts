// A tiny external store for the board's touch-only drag path (item 9: native HTML5 drag -- the
// desktop adapter `card-tile.tsx` otherwise uses -- never fires on a touchscreen, so a card is
// undraggable at 390 without a second, pointer-based path). Mirrors `lib/router.ts`'s own
// subscribe/getSnapshot shape rather than adding a context provider: `CardTile` (the drag source)
// and `BoardColumn` (the drop-target highlight) both need to react to the same live state with no
// common ancestor closer than `BoardScreen`, and a `useSyncExternalStore` hook reads it exactly like
// the router already does for the URL.
import * as React from 'react'

export interface TouchDragState {
  cardId: string
  title: string
  fromUserId: string | null
  pointerX: number
  pointerY: number
  /** The column key (`member.userId`, or `'unassigned'`) currently under the pointer, or `null`
   * when the pointer is over no column at all (e.g. still over the source card before any move). */
  overColumnKey: string | null
}

let state: TouchDragState | null = null
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback)
  return () => listeners.delete(callback)
}

function getSnapshot(): TouchDragState | null {
  return state
}

/** The live drag state, or `null` when no touch drag is in progress. */
export function useTouchDragState(): TouchDragState | null {
  return React.useSyncExternalStore(subscribe, getSnapshot, () => null)
}

/** Whether `columnKey` is the one currently under the touch-dragged card's pointer -- the highlight
 * `BoardColumn` shows, the exact touch equivalent of the mouse path's `dropTargetForElements`. */
export function useIsTouchDropTarget(columnKey: string): boolean {
  const current = useTouchDragState()
  return current?.overColumnKey === columnKey
}

export const touchDrag = {
  start(next: TouchDragState): void {
    state = next
    emit()
  },
  move(patch: Partial<Pick<TouchDragState, 'pointerX' | 'pointerY' | 'overColumnKey'>>): void {
    if (!state) return
    state = { ...state, ...patch }
    emit()
  },
  end(): void {
    if (state === null) return
    state = null
    emit()
  },
  get current(): TouchDragState | null {
    return state
  },
}
