import type { NotificationDto } from './api.js'
/** Older summary notifications linked back to Inbox itself. They have readable detail, but no
 * separate destination. Keep real subject links (for example a profile completion summary). */
export function notificationDestination(
  notification: Pick<NotificationDto, 'reason' | 'deepLink'>,
): string | null {
  const href = notification.deepLink
  if (
    notification.reason === 'digest' &&
    href &&
    (/^\/inbox(?:[?#]|$)/.test(href) || /^\/(?:\?inbox=[^#]*)?(?:#.*)?$/.test(href))
  )
    return null
  return href
}
