// The "your request is in flight" state (UI-OVERHAUL.md's Jakob row "Departments hub / join":
// "pending request state with a friendly illustration"), as a status timeline. Shared by
// `create-request-screen.tsx` (`/departments/new`, right after submitting) and
// `departments-hub-screen.tsx` (`/departments`, so a returning user with no department yet still sees
// where their request stands instead of the create-or-join cards again).
import * as React from 'react'
import { Check, X } from 'lucide-react'
import { useT } from '@devon/i18n'
import { Badge, Button, IdleFloat, PendingReviewIllustration, cn } from '@devon/ui'

// A plain function (not a nested JSX ternary) so no `>...<` boundary here can ever be mistaken for
// hard-coded text by `check-i18n.mjs`'s regex heuristic (same reasoning as `structure-screen.tsx`'s
// body switch).
function stepDotContent(
  tone: 'success' | 'destructive' | 'neutral',
  index: number,
): React.ReactNode {
  if (tone === 'success') {
    return <Check className="size-3.5" aria-hidden="true" />
  }
  if (tone === 'destructive') {
    return <X className="size-3.5" aria-hidden="true" />
  }
  return index + 1
}

/** The three moments a request passes through, drawn as a horizontal timeline -- UI-OVERHAUL.md's
 * "pending state with illustration and status timeline". `rejected` still shows all three dots (the
 * request *was* reviewed) with the last one turning destructive instead of success. */
export function StatusTimeline({ status }: { status: 'pending' | 'approved' | 'rejected' }) {
  const t = useT()
  const steps: {
    key: string
    labelKey: string
    done: boolean
    tone: 'success' | 'destructive' | 'neutral'
  }[] = [
    {
      key: 'submitted',
      labelKey: 'departments.pending.timeline.submitted',
      done: true,
      tone: 'success',
    },
    {
      key: 'review',
      labelKey: 'departments.pending.timeline.review',
      done: status !== 'pending',
      tone: status === 'pending' ? 'neutral' : 'success',
    },
    {
      key: 'decided',
      labelKey:
        status === 'rejected'
          ? 'departments.pending.timeline.rejected'
          : 'departments.pending.timeline.approved',
      done: status !== 'pending',
      tone: status === 'rejected' ? 'destructive' : status === 'approved' ? 'success' : 'neutral',
    },
  ]
  return (
    <ol className="flex w-full items-start">
      {steps.map((s, i) => (
        <li key={s.key} className="flex flex-1 flex-col items-center gap-2 text-center">
          <div className="flex w-full items-center">
            <span
              className={cn(
                'h-0.5 flex-1',
                i === 0 ? 'opacity-0' : s.done ? 'bg-primary' : 'bg-border',
              )}
              aria-hidden="true"
            />
            <span
              className={cn(
                'flex size-7 shrink-0 items-center justify-center rounded-full border-2 text-caption font-medium',
                s.tone === 'success' && 'border-success bg-success text-success-foreground',
                s.tone === 'destructive' &&
                  'border-destructive bg-destructive text-destructive-foreground',
                s.tone === 'neutral' && 'border-border bg-card text-muted-foreground',
              )}
            >
              {stepDotContent(s.tone, i)}
            </span>
            <span
              className={cn(
                'h-0.5 flex-1',
                i === steps.length - 1 ? 'opacity-0' : s.done ? 'bg-primary' : 'bg-border',
              )}
              aria-hidden="true"
            />
          </div>
          <span className="max-w-24 text-caption text-muted-foreground">{t(s.labelKey)}</span>
        </li>
      ))}
    </ol>
  )
}

export function PendingRequestView({
  status,
  name,
  reason,
  onCreateAnother,
}: {
  status: 'pending' | 'approved' | 'rejected'
  name: string
  reason: string | null
  onCreateAnother: () => void
}) {
  const t = useT()
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-6 py-16 text-center">
      <IdleFloat>
        <PendingReviewIllustration className="w-32" />
      </IdleFloat>
      <div className="flex flex-col items-center gap-2">
        <Badge
          tone={
            status === 'approved' ? 'success' : status === 'rejected' ? 'destructive' : 'neutral'
          }
        >
          {t(`departments.pending.status.${status}`)}
        </Badge>
        <h1 className="font-display text-h2 text-foreground">{t('departments.pending.title')}</h1>
        <p className="text-body text-muted-foreground">
          &quot;{name}&quot; — {t('departments.pending.body')}
        </p>
      </div>
      <div className="w-full">
        <StatusTimeline status={status} />
      </div>
      {status === 'rejected' && reason ? (
        <p className="text-small text-foreground">
          {t('departments.pending.reasonLabel')}: {reason}
        </p>
      ) : null}
      {status === 'rejected' ? (
        <Button size="sm" variant="secondary" onClick={onCreateAnother}>
          {t('departments.pending.createAnother')}
        </Button>
      ) : null}
    </div>
  )
}
