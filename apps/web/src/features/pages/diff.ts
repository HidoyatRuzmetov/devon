// A small, dependency-free word-level diff for "versions with diff" (TECH-SPEC §3.5). Two Tiptap
// documents are first flattened to plain text (block boundaries become newlines), then compared with
// the classic LCS-backtrack algorithm -- more than adequate for a page's prose at the sizes this
// editor ever produces (`pageBlocksSchema`'s own 2 MB ceiling), and it keeps this feature's dependency
// list at zero for something this contained.
import type { TiptapNode } from './types.js'

export function extractText(node: TiptapNode): string {
  const lines: string[] = []
  const BLOCK_TYPES = new Set([
    'paragraph',
    'heading',
    'listItem',
    'taskItem',
    'blockquote',
    'codeBlock',
    'callout',
  ])

  function walk(n: TiptapNode, buffer: string[]): void {
    if (n.type === 'text' && n.text) buffer.push(n.text)
    for (const child of n.content ?? []) {
      if (BLOCK_TYPES.has(child.type)) {
        const childBuffer: string[] = []
        walk(child, childBuffer)
        lines.push(childBuffer.join(''))
      } else {
        walk(child, buffer)
      }
    }
  }

  const rootBuffer: string[] = []
  walk(node, rootBuffer)
  if (rootBuffer.length > 0) lines.unshift(rootBuffer.join(''))
  return lines.filter((l) => l.length > 0).join('\n')
}

function tokenize(text: string): string[] {
  return text.split(/(\s+)/).filter((t) => t.length > 0)
}

export type DiffPart = { type: 'same' | 'added' | 'removed'; text: string }

/** Myers-style LCS diff over word tokens (including whitespace tokens, so re-joining `text` for every
 * part reconstructs the original strings exactly). O(n*m) table -- fine at prose sizes. */
export function diffText(before: string, after: string): DiffPart[] {
  const a = tokenize(before)
  const b = tokenize(after)
  const n = a.length
  const m = b.length
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))

  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      lcs[i]![j] =
        a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!)
    }
  }

  const parts: DiffPart[] = []
  let i = 0
  let j = 0
  const push = (type: DiffPart['type'], text: string) => {
    const last = parts[parts.length - 1]
    if (last && last.type === type) last.text += text
    else parts.push({ type, text })
  }
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push('same', a[i]!)
      i += 1
      j += 1
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      push('removed', a[i]!)
      i += 1
    } else {
      push('added', b[j]!)
      j += 1
    }
  }
  while (i < n) {
    push('removed', a[i]!)
    i += 1
  }
  while (j < m) {
    push('added', b[j]!)
    j += 1
  }
  return parts
}
