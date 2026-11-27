import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { useT } from '@devon/i18n'
import { Button, Dialog, DialogContent } from '@devon/ui'
import { BookOpen, Check, RotateCcw } from 'lucide-react'
import { fetchDocument } from './api.js'
import { useMeQuery } from '../../lib/session.js'

export function HtmlReader({
  id,
  onClose,
  onFinish,
  pending = false,
}: {
  id: string
  onClose: () => void
  onFinish?: () => void
  pending?: boolean
}) {
  const t = useT()
  const userId = useMeQuery().data?.user.id
  const doc = useQuery({
    queryKey: ['onboarding-document', userId, id],
    queryFn: () => fetchDocument(id),
  })
  const [loaded, setLoaded] = React.useState(false)
  const [reload, setReload] = React.useState(0)
  React.useEffect(() => {
    setLoaded(false)
  }, [id])
  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent
        title={doc.data?.title ?? t('onboarding.reading')}
        titleHidden
        aria-describedby={undefined}
        className="onboarding-reader flex h-[90dvh] w-[94vw] max-w-none flex-col gap-0 overflow-hidden p-0 md:w-[90vw]"
      >
        <header className="flex min-h-16 shrink-0 items-center gap-3 border-b border-border px-5 pr-16">
          <BookOpen className="size-5 shrink-0 text-primary" aria-hidden="true" />
          <div className="min-w-0">
            <p className="truncate font-medium">{doc.data?.title ?? t('onboarding.reading')}</p>
            <p className="text-caption text-muted-foreground">{t('onboarding.readerHint')}</p>
          </div>
        </header>
        <div className="relative min-h-0 flex-1 bg-white">
          {doc.isError ? (
            <div role="alert" className="p-8 text-foreground">
              <p>{t('onboarding.loadError')}</p>
              <Button onClick={() => void doc.refetch()}>{t('onboarding.retry')}</Button>
            </div>
          ) : null}
          {doc.data ? (
            <iframe
              key={reload}
              title={doc.data.title}
              src={`/api/v1/onboarding/documents/${encodeURIComponent(id)}/render`}
              sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
              referrerPolicy="no-referrer"
              className="h-full w-full border-0"
              onLoad={() => setLoaded(true)}
            />
          ) : null}
          {!loaded && !doc.isError ? (
            <div
              role="status"
              className="absolute inset-0 grid place-content-center bg-card text-muted-foreground"
            >
              {t('onboarding.loading')}
            </div>
          ) : null}
        </div>
        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border bg-card px-5 py-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setLoaded(false)
              setReload((n) => n + 1)
            }}
          >
            <RotateCcw className="size-4" />
            {t('onboarding.reload')}
          </Button>
          {onFinish ? (
            <Button
              disabled={!loaded || pending || doc.isError}
              loading={pending}
              onClick={onFinish}
            >
              <Check className="size-4" />
              {t('onboarding.finishReading')}
            </Button>
          ) : (
            <Button variant="secondary" onClick={onClose}>
              {t('onboarding.closePreview')}
            </Button>
          )}
        </footer>
      </DialogContent>
    </Dialog>
  )
}
