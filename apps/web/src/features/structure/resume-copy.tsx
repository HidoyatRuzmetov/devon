import { useT } from '@devon/i18n'
import { cn, toast } from '@devon/ui'
import { Check, Copy } from 'lucide-react'
import * as React from 'react'
import './resume-copy.css'

type CopyState = {
  copiedId: string | null
  copy: (id: string, value: string) => Promise<void>
}
const CopyContext = React.createContext<CopyState | null>(null)

export function ResumeCopyFields({ children, ...props }: React.ComponentPropsWithoutRef<'div'>) {
  const t = useT()
  const [copiedId, setCopiedId] = React.useState<string | null>(null)
  const attempt = React.useRef(0)
  const timer = React.useRef<number | undefined>(undefined)
  React.useEffect(
    () => () => {
      ++attempt.current
      window.clearTimeout(timer.current)
    },
    [],
  )

  async function copy(id: string, value: string) {
    const current = ++attempt.current
    window.clearTimeout(timer.current)
    setCopiedId(null)
    try {
      await navigator.clipboard.writeText(value)
      if (current !== attempt.current) return
      setCopiedId(id)
      timer.current = window.setTimeout(() => setCopiedId(null), 1800)
    } catch {
      if (current === attempt.current) toast.error(t('portal.profile.copyFailed'))
    }
  }

  return (
    <CopyContext.Provider value={{ copiedId, copy }}>
      <div {...props}>
        {children}
        <span role="status" className="sr-only">
          {copiedId ? t('toast.copied') : ''}
        </span>
      </div>
    </CopyContext.Provider>
  )
}

export function CopyValue({
  value,
  label = value,
  children,
  className,
  iconOnly = false,
}: {
  value: string
  label?: string
  children?: React.ReactNode
  className?: string
  iconOnly?: boolean
}) {
  const { copiedId, copy } = React.useContext(CopyContext)!
  const t = useT()
  const id = React.useId()
  if (!value) return null
  const copied = copiedId === id
  const action = t('portal.profile.copyField', { field: label })
  return (
    <button
      type="button"
      className={cn('resume-copy', iconOnly && 'resume-copy-icon-only', className)}
      aria-label={action}
      aria-describedby={!iconOnly && label !== value ? id : undefined}
      title={copied ? t('toast.copied') : action}
      data-copied={copied || undefined}
      onClick={() => void copy(id, value)}
    >
      {!iconOnly ? (
        <span id={id} className="min-w-0 [overflow-wrap:anywhere]">
          {children ?? value}
        </span>
      ) : null}
      <span className="resume-copy-indicator" aria-hidden="true">
        <Copy className="resume-copy-glyph" />
        <Check className="resume-copy-check" strokeWidth={2.5} />
      </span>
    </button>
  )
}
