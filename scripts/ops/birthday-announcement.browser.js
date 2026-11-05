/**
 * One-time release operation, run only in the existing head's signed-in production browser.
 * Loading this file defines a helper; it sends nothing. No cookies or credentials are read/exported.
 *
 * 1. await workPortalBirthdayAnnouncement()       // verifies destination; read-only
 * 2. await workPortalBirthdayAnnouncement('send') // only after the deployment is verified
 *
 * Do not change the operation ID to retry. A failed/ambiguous request must be checked against the
 * existing receipt and Telegram delivery before any further action. The canonical route claims
 * the fixed receipt before delivery and refuses replay of an unresolved operation.
 */
async function workPortalBirthdayAnnouncement(mode = 'inspect') {
  const origin = 'https://87.192.236.63'
  const departmentId = '6a98d657-83d6-4e58-99a0-489a71069d0d'
  const headUserId = '7f52fc37-ab25-4998-9b67-011cc71c2dc6'
  const groupId = '57e066ea-428a-4bad-b260-36cac86f7da1'
  const operationId = '8d1c2ab0-552d-46f0-9cb4-10761f652031'
  const message =
    'Please add your date of birth in Account → Profile. It helps us celebrate your birthday and reminds the department head one day beforehand. Your date of birth is not shown in People.'

  if (mode !== 'inspect' && mode !== 'send') throw new Error('Use inspect or send.')
  if (globalThis.location.origin !== origin || globalThis.top !== globalThis.self)
    throw new Error('Open the production WorkPortal page directly before running this operation.')

  async function read(path) {
    const response = await fetch(path, {
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      headers: { accept: 'application/json' },
    })
    if (!response.ok) throw new Error(`Preflight failed (${response.status}); nothing was sent.`)
    return response.json()
  }

  // This response remains in memory. Never log it: it contains the normal session's CSRF token.
  const me = await read('/api/v1/me')
  if (
    me.user?.id !== headUserId ||
    me.user?.role === 'super_admin' ||
    me.actingForUserId !== null ||
    me.activeDepartmentId !== departmentId ||
    !me.memberships?.some(
      (membership) => membership.departmentId === departmentId && membership.role === 'head',
    ) ||
    typeof me.csrfToken !== 'string' ||
    me.csrfToken.length === 0
  )
    throw new Error('The approved department head must be signed in to the correct department.')

  const groups = await read(`/api/v1/telegram/departments/${departmentId}/groups`)
  if (!groups.items?.some((group) => group.id === groupId))
    throw new Error('The approved Telegram group is no longer connected; nothing was sent.')

  const result = { operationId, departmentId, groupId, headUserId, message, mentionAll: false }
  if (mode === 'inspect') return { status: 'ready', ...result }

  // Authentication remains the browser's existing HttpOnly session. CSRF stays in this call only.
  // Never automatically retry this POST, even on a timeout/network error.
  let response
  try {
    response = await fetch('/api/v1/telegram/group-message', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': me.csrfToken,
        'x-operation-id': operationId,
      },
      body: JSON.stringify({ groupId, message, mentionAll: false }),
    })
  } catch {
    throw new Error(
      `Delivery is unconfirmed. Check receipt ${operationId}; do not use a new operation ID.`,
    )
  }
  if (!response.ok)
    throw new Error(
      `Delivery was not confirmed (${response.status}). Check receipt ${operationId}; do not use a new operation ID.`,
    )
  // recipients counts explicit @mentions. Zero is expected for this non-mention announcement.
  return { status: 'sent-or-already-sent', ...result }
}
