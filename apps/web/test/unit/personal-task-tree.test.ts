import { describe, expect, it } from 'vitest'
import { buildTree, flattenTree } from '../../src/features/personal/task-tree.js'
import type { Task } from '../../src/features/personal/types.js'

function task(id: string, parentId: string | null, sort = 0): Task {
  return {
    id,
    parentId,
    sort,
    sprintId: null,
    title: id,
    doneAt: null,
    notes: null,
    estimateMin: null,
    linkedCardId: null,
    createdAt: '2026-10-08T00:00:00Z',
    updatedAt: '2026-10-08T00:00:00Z',
    version: 1,
  }
}
describe('personal task tree visibility', () => {
  it('preserves valid tree order, stable sort ties and depths', () => {
    const rows = [
      task('last', null, 2),
      task('first', null),
      task('tie', null),
      task('child', 'first'),
      task('grandchild', 'child'),
    ]
    expect(flattenTree(buildTree(rows)).map(({ id, depth }) => [id, depth])).toEqual([
      ['first', 0],
      ['child', 1],
      ['grandchild', 2],
      ['tie', 0],
      ['last', 0],
    ])
  })
  it('surfaces every cycle member once at top level, retaining valid descendants and orphans', () => {
    const rows = [
      task('a', 'b'),
      task('b', 'a'),
      task('self', 'self'),
      task('child', 'a'),
      task('orphan', 'outside'),
    ]
    const before = structuredClone(rows)
    const flattened = flattenTree(buildTree(rows))
    expect(flattened.map(({ id, depth }) => [id, depth])).toEqual([
      ['a', 0],
      ['child', 1],
      ['b', 0],
      ['self', 0],
      ['orphan', 0],
    ])
    expect(new Set(flattened.map(({ id }) => id)).size).toBe(rows.length)
    expect(rows).toEqual(before)
  })
  it('renders a deep valid hierarchy without recursion stack overflow', () => {
    const rows = Array.from({ length: 12_000 }, (_, index) =>
      task(String(index), index ? String(index - 1) : null),
    )
    const flattened = flattenTree(buildTree(rows))
    expect(flattened.length).toBe(rows.length)
    expect(flattened.at(-1)).toMatchObject({ id: '11999', depth: 11999 })
  })
})
