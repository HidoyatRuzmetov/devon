import * as React from 'react'
import { RouterLink } from '../../../lib/router.js'
import { chatSourceHref } from '../chat-source-href.js'

/** AI text is untrusted. Render a deliberately small Markdown vocabulary as React nodes:
 * no HTML, embedded media or executable URLs. Inline links must exactly match a source in the
 * API's permission-checked citation list; other link-like text remains inert. */
function inline(
  text: string,
  sources: readonly string[],
  conversationId?: string,
): React.ReactNode[] {
  return text
    .split(/(\*\*[^*\n]+\*\*|`[^`\n]+`|\*[^*\n]+\*|\[[^\]\n]+\]\([^\n)]+\))/g)
    .map((part, index) => {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part)
      if (link) {
        const href =
          link[2] && sources.includes(link[2]) ? chatSourceHref(link[2], conversationId) : null
        return href ? (
          <RouterLink
            key={index}
            href={href}
            className="font-medium text-primary underline underline-offset-2"
          >
            {link[1]}
          </RouterLink>
        ) : (
          link[1]
        )
      }
      if (part.startsWith('**') && part.endsWith('**')) {
        return (
          <strong key={index} className="font-semibold">
            {part.slice(2, -2)}
          </strong>
        )
      }
      if (part.startsWith('`') && part.endsWith('`')) {
        return (
          <code key={index} className="rounded bg-muted px-1 font-mono text-caption">
            {part.slice(1, -1)}
          </code>
        )
      }
      if (part.startsWith('*') && part.endsWith('*'))
        return <em key={index}>{part.slice(1, -1)}</em>
      return part
    })
}

export function AnswerMarkdown({
  content,
  sources = [],
  conversationId,
}: {
  content: string
  sources?: readonly string[]
  conversationId?: string
}) {
  const blocks: React.ReactNode[] = []
  const lines = content.replaceAll('\r\n', '\n').split('\n')
  let index = 0
  while (index < lines.length) {
    const line = lines[index] ?? ''
    if (!line.trim()) {
      index++
      continue
    }
    const start = index
    if (line.startsWith('```')) {
      index++
      const code: string[] = []
      while (index < lines.length && !lines[index]?.startsWith('```'))
        code.push(lines[index++] ?? '')
      index++
      blocks.push(
        <pre key={start} className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-caption">
          <code>{code.join('\n')}</code>
        </pre>,
      )
      continue
    }
    const heading = /^(#{1,4})\s+(.+)$/.exec(line)
    if (heading) {
      blocks.push(
        <h3 key={start} className="pt-1 text-body font-semibold">
          {inline(heading[2] ?? '', sources, conversationId)}
        </h3>,
      )
      index++
      continue
    }
    const unordered = /^\s*[-*+]\s+/.test(line)
    const ordered = /^\s*\d+[.)]\s+/.test(line)
    if (unordered || ordered) {
      const pattern = ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*+]\s+/
      const items: React.ReactNode[] = []
      while (index < lines.length && pattern.test(lines[index] ?? '')) {
        items.push(
          <li key={index}>
            {inline((lines[index++] ?? '').replace(pattern, ''), sources, conversationId)}
          </li>,
        )
      }
      blocks.push(
        ordered ? (
          <ol key={start} className="list-decimal space-y-1 pl-5">
            {items}
          </ol>
        ) : (
          <ul key={start} className="list-disc space-y-1 pl-5">
            {items}
          </ul>
        ),
      )
      continue
    }
    if (/^>\s?/.test(line)) {
      blocks.push(
        <blockquote key={start} className="border-l-2 border-primary/30 pl-3 text-muted-foreground">
          {inline(line.replace(/^>\s?/, ''), sources, conversationId)}
        </blockquote>,
      )
    } else blocks.push(<p key={start}>{inline(line, sources, conversationId)}</p>)
    index++
  }
  return (
    <div className="space-y-2 text-small leading-relaxed [overflow-wrap:anywhere]">{blocks}</div>
  )
}
