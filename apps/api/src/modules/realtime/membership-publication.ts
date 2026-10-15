import { parseChannel, personalChannel } from './channels.js'

/** Pending and removed members cannot receive their department's channel. Tell only the named
 * people to re-read authorized membership endpoints; no profile or department content is copied. */
export function membershipPersonalChannels(type: string, payload: unknown): string[] {
  if (
    ![
      'departments.membership.changed',
      'departments.join_request.decided',
      'accounts.profile.updated',
      'accounts.user.avatar_updated',
    ].includes(type)
  )
    return []
  if (!payload || typeof payload !== 'object') return []
  const row = payload as Record<string, unknown>
  const ids = [
    row['userId'],
    ...(!type.startsWith('accounts.') && Array.isArray(row['userIds']) ? row['userIds'] : []),
  ]
  return [
    ...new Set(
      ids
        .filter((id): id is string => typeof id === 'string')
        .map(personalChannel)
        .filter((channel) => parseChannel(channel)?.namespace === 'personal'),
    ),
  ]
}
