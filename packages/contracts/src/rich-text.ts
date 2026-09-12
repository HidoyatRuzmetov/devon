// The rich-text (Tiptap) document allow-list -- HARDENING H1.5 ("Tiptap schema allow-list") and the
// URL half of H1.6.
//
// Before this pass the server accepted any node `type`, any mark `type` and any `attrs` object at
// all: `apps/api/src/modules/pages/schemas.ts` validated only the recursive *shape* and a size
// ceiling. Two things follow from that, both real:
//
//   - A `link` mark could carry `href: "javascript:..."` or `href: "data:text/html;base64,..."`.
//     Tiptap renders a link mark as `<a href>`, so a page saved by one member is a stored
//     script-execution vector for every colleague who opens it. React's escaping does not help:
//     the value is an attribute the editor is asked to set, not text.
//   - A node type the editor does not register makes ProseMirror's schema parse throw
//     ("Unknown node type"), so an attacker-authored page permanently breaks the page screen for
//     everyone who opens it -- stored denial of service against a shared document.
//
// This module is the single source of truth for both (`packages/contracts` is where business rules
// live, TECH-SPEC §16/H28.1): the allow-lists below must equal the extensions actually registered in
// `apps/web/src/features/pages/page-editor.tsx`, and `test/unit/rich-text.test.ts` pins the pairing.
import { z } from 'zod'

/**
 * Every node type the page editor registers: `@tiptap/starter-kit` 3.31's own set, plus
 * `@tiptap/extension-task-list` (`taskList`), `@tiptap/extension-task-item` (`taskItem`),
 * `@tiptap/extension-mention` (`mention`) and the product's own `callout`
 * (`apps/web/src/features/pages/callout-extension.ts`).
 *
 * Note what is absent and must stay absent: there is no `image`, no `iframe`/embed, and no raw-HTML
 * node. Adding one means adding a `src`/`srcdoc` attribute that has to be validated the way `href`
 * is below -- so it is a deliberate decision with a diff here, never an accident.
 */
export const RICH_TEXT_NODE_TYPES = Object.freeze([
  'doc',
  'paragraph',
  'text',
  'heading',
  'blockquote',
  'bulletList',
  'orderedList',
  'listItem',
  'codeBlock',
  'horizontalRule',
  'hardBreak',
  'taskList',
  'taskItem',
  'callout',
  'mention',
] as const)

/** Marks `@tiptap/starter-kit` 3.31 registers. `link` is the only one that carries a URL. */
export const RICH_TEXT_MARK_TYPES = Object.freeze([
  'bold',
  'italic',
  'strike',
  'underline',
  'code',
  'link',
] as const)

/**
 * URL schemes a stored document may point at. Everything else -- `javascript:`, `data:`, `blob:`,
 * `vbscript:`, `file:`, and every unknown scheme -- is refused. A scheme-relative (`//host`) or
 * root-relative (`/path`) URL is allowed: it can only ever resolve to this same origin.
 */
export const SAFE_URL_SCHEMES = Object.freeze(['http:', 'https:', 'mailto:', 'tel:'] as const)

/**
 * `true` when `value` is a URL a rendered document may point at. Leading whitespace and control
 * characters are stripped first, because `"java\tscript:alert(1)"` is a URL browsers have
 * historically accepted and naive scheme checks have historically missed.
 */
export function isSafeUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false
  const cleaned = [...value]
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0
      return code > 0x20 && !(code >= 0x7f && code <= 0x9f)
    })
    .join('')
  if (cleaned === '') return false
  if (cleaned.startsWith('/')) return true // root-relative and scheme-relative: same origin only.
  if (cleaned.startsWith('#')) return true // in-document anchor.
  try {
    const parsed = new URL(cleaned)
    return (SAFE_URL_SCHEMES as readonly string[]).includes(parsed.protocol)
  } catch {
    // Not an absolute URL and not relative in a form we recognise -- refuse rather than guess.
    return false
  }
}

/** Attribute names whose value is treated as a URL, whatever node or mark carries them. */
const URL_ATTRS = Object.freeze(['href', 'src', 'srcset', 'action', 'formaction', 'xlink:href'])

export type RichTextNode = {
  type: string
  attrs?: Record<string, unknown> | undefined
  content?: RichTextNode[] | undefined
  text?: string | undefined
  marks?: { type: string; attrs?: Record<string, unknown> | undefined }[] | undefined
}

const nodeTypes = new Set<string>(RICH_TEXT_NODE_TYPES)
const markTypes = new Set<string>(RICH_TEXT_MARK_TYPES)

/** At most this many attributes on one node or mark: an unbounded `attrs` bag is a payload channel. */
const MAX_ATTRS = 24
/** Longest a single attribute value may be (a `href`, a mention label, a callout tone). */
const MAX_ATTR_LENGTH = 2048

function attrsAreSafe(attrs: Record<string, unknown> | undefined): boolean {
  if (attrs === undefined) return true
  const entries = Object.entries(attrs)
  if (entries.length > MAX_ATTRS) return false
  for (const [key, value] of entries) {
    const lowered = key.toLowerCase()
    // No `onclick`/`onerror`/... can be smuggled in as an attribute name.
    if (lowered.startsWith('on')) return false
    if (URL_ATTRS.includes(lowered)) {
      if (value === null || value === undefined) continue
      if (!isSafeUrl(value)) return false
    }
    if (typeof value === 'string' && value.length > MAX_ATTR_LENGTH) return false
  }
  return true
}

const attrsSchema = z.record(z.string().max(64), z.unknown()).refine(attrsAreSafe, {
  message: 'Attribute is not allowed (unsafe URL scheme, event handler, or oversized value)',
})

const markSchema = z.object({
  type: z.string().refine((t) => markTypes.has(t), { message: 'Mark type is not allowed' }),
  attrs: attrsSchema.optional(),
})

/** One node of a stored rich-text document, recursive, allow-listed. */
export const richTextNodeSchema: z.ZodType<RichTextNode> = z.lazy(() =>
  z.object({
    type: z.string().refine((t) => nodeTypes.has(t), { message: 'Node type is not allowed' }),
    attrs: attrsSchema.optional(),
    content: z.array(richTextNodeSchema).max(4000).optional(),
    text: z.string().max(20000).optional(),
    marks: z.array(markSchema).max(20).optional(),
  }),
)

/** Total serialized ceiling for one stored document (H7.4: a bound on every request body). */
export const RICH_TEXT_MAX_BYTES = 2_000_000

export const richTextDocSchema = richTextNodeSchema.refine(
  (v) => JSON.stringify(v).length <= RICH_TEXT_MAX_BYTES,
  { message: 'Page content is too large' },
)
