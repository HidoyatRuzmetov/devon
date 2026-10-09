// A small, dependency-free word-level diff for "versions with diff" (TECH-SPEC §3.5). Two Tiptap
// documents are first flattened to plain text (block boundaries become newlines), then compared with
// a bounded LCS comparison. Large changed regions use complete removed/added blocks, so a valid
// long page cannot allocate a quadratic grid and freeze its reader. No document text is truncated.
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

/** Word-token LCS for bounded changed regions. Preserve shared context and exact text on both sides;
 * use a coarse whole-region difference when fine alignment would exceed the memory/work budget. */
export function diffText(before: string, after: string): DiffPart[] {
  if (before === after) return before ? [{ type: 'same', text: before }] : []
  const originalA = tokenize(before)
  const originalB = tokenize(after)
  let prefix = 0
  while (
    prefix < originalA.length &&
    prefix < originalB.length &&
    originalA[prefix] === originalB[prefix]
  )
    prefix++
  let suffix = 0
  while (
    suffix < originalA.length - prefix &&
    suffix < originalB.length - prefix &&
    originalA[originalA.length - suffix - 1] === originalB[originalB.length - suffix - 1]
  )
    suffix++
  const a = originalA.slice(prefix, originalA.length - suffix)
  const b = originalB.slice(prefix, originalB.length - suffix)
  const n = a.length
  const m = b.length
  const parts: DiffPart[] = []
  const push = (type: DiffPart['type'], text: string) => {
    if (!text) return
    const last = parts[parts.length - 1]
    if (last && last.type === type) last.text += text
    else parts.push({ type, text })
  }
  push('same', originalA.slice(0, prefix).join(''))
  const tail = suffix ? originalA.slice(originalA.length - suffix).join('') : ''
  if ((n + 1) * (m + 1) > 1_000_000) {
    push('removed', a.join(''))
    push('added', b.join(''))
    push('same', tail)
    return parts
  }
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))

  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      lcs[i]![j] =
        a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!)
    }
  }

  let i = 0
  let j = 0
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
  push('same', tail)
  return parts
}
