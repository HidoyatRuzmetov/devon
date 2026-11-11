import type { AiConversationSummary } from '@devon/contracts'
import { useT } from '@devon/i18n'
import { cn, useReducedMotion } from '@devon/ui'
import * as React from 'react'

type Title = Pick<AiConversationSummary, 'title' | 'titleStatus'>

/** The shell, selection and hit target stay in place while only the text line changes. */
export function ConversationTitleSkeleton({ width = 'w-[13ch]' }: { width?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'devon-shimmer relative inline-block h-[0.72em] max-w-full overflow-hidden rounded-sm bg-foreground/10 align-middle motion-reduce:after:hidden',
        width,
      )}
    />
  )
}

function characters(text: string) {
  if (typeof Intl.Segmenter !== 'function') return Array.from(text)
  return Array.from(new Intl.Segmenter().segment(text), ({ segment }) => segment)
}

export function ConversationTitle({
  title,
  titleStatus,
  animate = false,
}: Title & { animate?: boolean }) {
  const t = useT()
  const reduced = useReducedMotion()
  // A legacy conversation keeps its existing, searchable label during the one-time rewrite.
  const awaitingTitle = titleStatus === 'pending' && !title
  const wasAwaiting = React.useRef(awaitingTitle)
  const [prefix, setPrefix] = React.useState<string | null>(null)

  React.useLayoutEffect(() => {
    const reveal = animate && wasAwaiting.current && titleStatus === 'ready' && title && !reduced
    wasAwaiting.current = awaitingTitle
    if (!reveal) {
      setPrefix(null)
      return
    }
    const letters = characters(title)
    let count = 0
    setPrefix('')
    const step = Math.max(1, Math.ceil(letters.length / 22))
    const timer = window.setInterval(() => {
      count += step
      if (count >= letters.length) {
        window.clearInterval(timer)
        setPrefix(null)
      } else {
        setPrefix(letters.slice(0, count).join(''))
      }
    }, 26)
    return () => window.clearInterval(timer)
  }, [animate, awaitingTitle, reduced, title, titleStatus])

  if (awaitingTitle) {
    return (
      <>
        <span className="sr-only">{t('assistantWorkspace.naming')}</span>
        <ConversationTitleSkeleton />
      </>
    )
  }
  const label = title || t('overviewChat.new')
  return (
    <span className="block min-w-0 truncate" dir="auto" title={label}>
      {prefix === null ? (
        label
      ) : (
        <>
          <span className="sr-only">{label}</span>
          <span aria-hidden="true" className="border-e border-current pe-px">
            {prefix}
          </span>
        </>
      )}
    </span>
  )
}
