// The notification detail (this module's task: "inbox drawer + page with mark read/archive"). Marking
// read happens the moment it opens -- reading it *is* the "mark read" action, the same way opening an
// email marks it read, never a separate button for something that already happened.
//
// UI-OVERHAUL.md "Inbox to Linear quality: list + detail split (stack at 390)": `NotificationDetail`
// is the shared content, rendered inline where both panes have room (>=1280) and inside a bottom
// `Sheet` below that -- one detail view, two shells, so their behavior stays consistent.
import { useT, useLocale, formatDate, formatTime } from '@devon/i18n'
import { Button, Chip, IconButton, Sheet, SheetContent } from '@devon/ui'
import { ExternalLink, X } from 'lucide-react'
import { pickLocalized, type NotificationDto } from './api.js'
import { REASON_TONE, ReasonIcon } from './reason-icon.js'
import { navigate } from '../../lib/router.js'

export function NotificationDetail({
  notification,
  onArchive,
  onClose,
}: {
  notification: NotificationDto
  onArchive: (id: string) => void
  onClose?: () => void
}) {
  const t = useT()
  const locale = useLocale()

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <ReasonIcon reason={notification.reason} className="size-4.5" />
          </span>
          <div>
            <Chip tone={REASON_TONE[notification.reason]} className="mb-1">
              {t(`inbox.reason.${notification.reason}`)}
            </Chip>
            <h2 className="text-h3 text-foreground">{pickLocalized(notification.title, locale)}</h2>
            <p className="text-caption text-muted-foreground">
              {formatDate(new Date(notification.createdAt), locale)}{' '}
              {formatTime(new Date(notification.createdAt), locale)}
            </p>
          </div>
        </div>
        {onClose ? (
          <IconButton aria-label={t('inbox.detail.close')} onClick={onClose}>
            <X className="size-4" aria-hidden="true" />
          </IconButton>
        ) : null}
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
              onClose?.()
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
          }}
        >
          {t('inbox.row.archive')}
        </Button>
      </div>
    </div>
  )
}

/** The narrow-screen shell for the same detail, with focus returned to its actual opener. */
export function NotificationSheet({
  notification,
  onOpenChange,
  onArchive,
  onRestoreFocus,
}: {
  notification: NotificationDto | null
  onOpenChange: (open: boolean) => void
  onArchive: (id: string) => void
  onRestoreFocus: () => void
}) {
  const t = useT()
  return (
    <Sheet direction="bottom" open={notification !== null} onOpenChange={onOpenChange} autoFocus>
      {notification ? (
        <SheetContent
          title={t('inbox.detail.title')}
          side="bottom"
          className="mx-auto max-w-160 overflow-y-auto"
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            onRestoreFocus()
          }}
        >
          <div className="p-6">
            <NotificationDetail
              notification={notification}
              onArchive={onArchive}
              onClose={() => onOpenChange(false)}
            />
          </div>
        </SheetContent>
      ) : null}
    </Sheet>
  )
}
