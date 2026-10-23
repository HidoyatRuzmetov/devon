import type { NotificationDto } from './api.js'
export const INBOX_GROUPS = ['tasks', 'events', 'summaries', 'system'] as const
export type InboxGroup = (typeof INBOX_GROUPS)[number]
export function inboxGroup(item: Pick<NotificationDto, 'reason' | 'subjectType'>): InboxGroup {
  if (item.reason === 'digest') return 'summaries'
  if (
    ['event', 'rsvp', 'poll', 'event_poll'].includes(item.subjectType) ||
    ['rsvp', 'poll'].includes(item.reason)
  )
    return 'events'
  if (
    ['card', 'project', 'checklist', 'comment', 'task'].includes(item.subjectType) ||
    ['assigned', 'due'].includes(item.reason)
  )
    return 'tasks'
  return 'system'
}
