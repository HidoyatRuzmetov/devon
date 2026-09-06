// The inbox drawer (this module's task: "inbox drawer + page with mark read/archive"): a bottom
// sheet with the full title/body/timestamp of one notification and its actions, opened by tapping a
// row. Marking read happens the moment it opens -- reading it *is* the "mark read" action, the same
// way opening an email marks it read, never a separate button for something that already happened.
import * as React from 'react'
import { useT, useLocale, formatDate, formatTime } from '@devon/i18n'
import { ExternalLink, X } from 'lucide-react'
import { Button, IconButton, Sheet, SheetContent } from '@devon/ui'
import { pickLocalized, type NotificationDto } from './api.js'
import { ReasonIcon } from './reason-icon.js'
import { navigate } from '../../lib/router.js'

export function NotificationSheet({
  notification,
  onOpenChange,
  onArchive,
}: {
  notification: NotificationDto | null
  onOpenChange: (open: boolean) => void
  onArchive: (id: string) => void
}) {
  const t = useT()
  const locale = useLocale()

  return (
    <Sheet direction="bottom" open={notification !== null} onOpenChange={onOpenChange}>
      {notification ? (
        <SheetContent
          title={t('inbox.detail.title')}
          side="bottom"
          className="mx-auto max-w-160 overflow-y-auto"
        >
          <div className="flex flex-col gap-4 p-6">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <ReasonIcon reason={notification.reason} className="size-4.5" />
                </span>
                <div>
                  <h2 className="text-h3 text-foreground">
                    {pickLocalized(notification.title, locale)}
                  </h2>
                  <p className="text-caption text-muted-foreground">
                    {formatDate(new Date(notification.createdAt), locale)}{' '}
                    {formatTime(new Date(notification.createdAt), locale)}
                  </p>
                </div>
              </div>
              <IconButton aria-label={t('inbox.detail.close')} onClick={() => onOpenChange(false)}>
                <X className="size-4" aria-hidden="true" />
              </IconButton>
            </div>
            {notification.body ? (
              <p className="whitespace-pre-wrap text-body text-foreground">
                {pickLocalized(notification.body, locale)}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2 pt-2">
              {notification.deepLink ? (
                <Button
                  variant="secondary"
                  onClick={() => {
                    onOpenChange(false)
                    navigate(notification.deepLink!)
                  }}
                >
                  <ExternalLink className="size-4" aria-hidden="true" />
                  {t('inbox.detail.openLink')}
                </Button>
              ) : null}
              <Button
                variant="ghost"
                onClick={() => {
                  onArchive(notification.id)
                  onOpenChange(false)
                }}
              >
                {t('inbox.row.archive')}
              </Button>
            </div>
          </div>
        </SheetContent>
      ) : null}
    </Sheet>
  )
}
