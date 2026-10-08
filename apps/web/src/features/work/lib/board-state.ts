import type { Board, Card } from '../api.js'

export type BoardMove = {
  id: string
  toUserId: string | null
  targetCardId: string | null
  edge: 'before' | 'after'
}

/** Focus is personal: raising a pin changes this viewer's layout without rewriting shared ranks. */
export function focusFirst(cards: readonly Card[]): Card[] {
  return [...cards].sort((a, b) => {
    const focused = Number(b.focusPinned === true) - Number(a.focusPinned === true)
    if (focused) return focused
    if (a.focusPinned && b.focusPinned) return (a.focusPosition ?? 0) - (b.focusPosition ?? 0)
    return 0
  })
}

export function sortBoardCards(cards: readonly Card[]): Card[] {
  const ordered = [...cards].sort(
    (a, b) =>
      (a.orderKey < b.orderKey ? -1 : a.orderKey > b.orderKey ? 1 : 0) ||
      a.createdAt.localeCompare(b.createdAt) ||
      a.id.localeCompare(b.id),
  )
  return focusFirst(ordered)
}

/** Change the actual source/destination arrays immediately. Patching only assigneeUserId left the
 * card in its old column until a refetch; rolling back a whole board also undid unrelated moves. */
export function moveCardOnBoard(board: Board, move: BoardMove): Board {
  const card = [...board.unassigned, ...board.columns.flatMap((col) => col.cards)].find(
    (candidate) => candidate.id === move.id,
  )
  if (!card) return board
  const sourceUserId =
    board.columns.find((column) => column.cards.some((item) => item.id === move.id))?.member
      .userId ?? null
  if (move.toUserId !== null && !board.columns.some((col) => col.member.userId === move.toUserId))
    return board
  const update = (cards: Card[], userId: string | null): Card[] => {
    if (userId !== sourceUserId && userId !== move.toUserId) return cards
    const remaining = cards.filter((item) => item.id !== move.id)
    if (userId !== move.toUserId) return remaining
    const target = move.targetCardId
      ? remaining.findIndex((item) => item.id === move.targetCardId)
      : -1
    const index = target === -1 ? remaining.length : target + (move.edge === 'after' ? 1 : 0)
    remaining.splice(index, 0, {
      ...card,
      assigneeUserId: move.toUserId,
      assigneeUnavailable: false,
    })
    return focusFirst(remaining)
  }
  return {
    ...board,
    columns: board.columns.map((column) => {
      const cards = update(column.cards, column.member.userId)
      return cards === column.cards ? column : { ...column, cards }
    }),
    unassigned: update(board.unassigned, null),
  }
}

/** Capture only this card's original neighbours. A failed move restores it around surviving IDs
 * while preserving other optimistic moves, edits, pins and newly created cards. */
export function previousBoardPosition(board: Board | undefined, id: string): BoardMove | undefined {
  const columns = [
    ...(board?.columns.map((col) => ({
      userId: col.member.userId,
      cards: col.cards,
    })) ?? []),
    { userId: null, cards: board?.unassigned ?? [] },
  ]
  for (const column of columns) {
    const index = column.cards.findIndex((card) => card.id === id)
    if (index < 0) continue
    const next = column.cards[index + 1]
    const previous = column.cards[index - 1]
    return {
      id,
      toUserId: column.userId,
      targetCardId: next?.id ?? previous?.id ?? null,
      edge: next ? 'before' : 'after',
    }
  }
  return undefined
}
