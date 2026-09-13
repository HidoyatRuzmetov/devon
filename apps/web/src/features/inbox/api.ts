// Typed API client functions for the inbox + telegram screens (MODULE-GUIDE.md "Web features":
// "Build your feature's own endpoint functions on [apiClient]"). `apiClient` itself only exposes
// GET/POST/PATCH (`src/lib/api-client.ts`) -- this module's routes also need PUT and DELETE, so
// `putJson`/`delJson` below reuse that file's own exported `ApiError`/`NetworkError` and the shared
// `problemSchema` to parse a failure exactly the same way, without editing a file outside this
// feature's paths.
import { z } from 'zod'
import { ApiError, NetworkError, apiClient } from '../../lib/api-client.js'
import { problemSchema } from '../../lib/api-schemas.js'
import type { Locale } from '@devon/i18n'

async function raw(path: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(path, {
      credentials: 'include',
      headers: { accept: 'application/json', ...(init.headers ?? {}) },
      ...init,
    })
  } catch (cause) {
    throw new NetworkError(cause)
  }
}

async function parseErrorAndThrow(res: Response): Promise<never> {
  const requestId = res.headers.get('x-request-id')
  let code = 'internal'
  try {
    const body: unknown = await res.json()
    const parsed = problemSchema.safeParse(body)
    if (parsed.success) code = parsed.data.code
  } catch {
    // Not a Problem body -- fall back to 'internal', same as api-client.ts.
  }
  throw new ApiError(res.status, code, requestId)
}

async function putJson<T>(
  path: string,
  body: unknown,
  schema: z.ZodType<T>,
  csrfToken: string,
): Promise<T> {
  const res = await raw(path, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
    body: JSON.stringify(body),
  })
  if (!res.ok) await parseErrorAndThrow(res)
  if (res.status === 204) return undefined as T
  return schema.parse(await res.json())
}

async function patchJson<T>(
  path: string,
  body: unknown,
  schema: z.ZodType<T>,
  csrfToken: string,
): Promise<T> {
  const res = await raw(path, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
    body: JSON.stringify(body),
  })
  if (!res.ok) await parseErrorAndThrow(res)
  if (res.status === 204) return undefined as T
  return schema.parse(await res.json())
}

async function delJson<T>(path: string, schema: z.ZodType<T>, csrfToken: string): Promise<T> {
  const res = await raw(path, { method: 'DELETE', headers: { 'x-csrf-token': csrfToken } })
  if (!res.ok) await parseErrorAndThrow(res)
  if (res.status === 204) return undefined as T
  return schema.parse(await res.json())
}

/** A 422 `quiet_hours_too_loud` response (`PUT /notifications/quiet-hours`) carries a domain code the
 * preferences screen renders as a specific message, not the generic error toast -- this narrows
 * `ApiError` the same way callers elsewhere in the app already switch on `.code`. */
export function isQuietHoursTooLoud(err: unknown): boolean {
  return err instanceof ApiError && err.code === 'quiet_hours_too_loud'
}

// --- Shared shapes -----------------------------------------------------------------------------

const localeTextSchema = z.object({
  'uz-Latn': z.string(),
  'uz-Cyrl': z.string(),
  ru: z.string(),
  en: z.string(),
})
export type LocalizedText = z.infer<typeof localeTextSchema>

export function pickLocalized(text: LocalizedText, locale: Locale): string {
  return text[locale] ?? text['uz-Latn']
}

export const REASONS = [
  'assigned',
  'mentioned',
  'due',
  'updated',
  'rsvp',
  'poll',
  'decision',
  'digest',
  'system',
  /** v1.1 SPEC §5: the boshqarma boshligʻi asked this person to fill in a custom field. Mirrors
   * `apps/api/src/modules/notifications/schemas.ts`'s `REASONS` -- a reason the server can send and
   * this enum does not know makes every notification query fail its response schema at once. */
  'field_request',
] as const
export type Reason = (typeof REASONS)[number]

export const CHANNELS = ['inapp', 'telegram', 'email'] as const
export type Channel = (typeof CHANNELS)[number]

export const DIGEST_MODES = ['instant', 'daily', 'weekly', 'off'] as const
export type DigestMode = (typeof DIGEST_MODES)[number]

export const GROUP_KINDS = [
  'events',
  'polls',
  'announcements',
  'weekly_summary',
  'deadlines',
] as const
export type GroupKind = (typeof GROUP_KINDS)[number]

// --- Notifications -------------------------------------------------------------------------------

const notificationSchema = z.object({
  id: z.string(),
  type: z.string(),
  reason: z.enum(REASONS),
  subjectType: z.string(),
  subjectId: z.string().nullable(),
  departmentId: z.string().nullable(),
  title: localeTextSchema,
  body: localeTextSchema.nullable(),
  deepLink: z.string().nullable(),
  readAt: z.string().nullable(),
  archivedAt: z.string().nullable(),
  snoozedUntil: z.string().nullable(),
  createdAt: z.string(),
})
export type NotificationDto = z.infer<typeof notificationSchema>

const notificationListSchema = z.object({
  items: z.array(notificationSchema),
  unreadCount: z.number(),
  nextCursor: z.string().nullable(),
})
export type NotificationListDto = z.infer<typeof notificationListSchema>

export type InboxStatus = 'inbox' | 'unread' | 'archived'

export function fetchNotifications(
  status: InboxStatus,
  cursor?: string | null,
): Promise<NotificationListDto> {
  const params = new URLSearchParams({ status, limit: '30' })
  if (cursor) params.set('cursor', cursor)
  return apiClient.get(`/api/v1/notifications?${params.toString()}`, notificationListSchema)
}

const updatedCountSchema = z.object({ updated: z.number() })

export function markNotificationsRead(ids: string[], csrfToken: string) {
  return apiClient.post('/api/v1/notifications/read', { ids }, updatedCountSchema, csrfToken)
}

export function markAllNotificationsRead(csrfToken: string) {
  return apiClient.post('/api/v1/notifications/read-all', {}, updatedCountSchema, csrfToken)
}

export function archiveNotifications(ids: string[], csrfToken: string) {
  return apiClient.post('/api/v1/notifications/archive', { ids }, updatedCountSchema, csrfToken)
}

export function snoozeNotification(id: string, minutes: number, csrfToken: string) {
  return putJson(`/api/v1/notifications/${id}/snooze`, { minutes }, z.void(), csrfToken)
}

// --- Preferences ---------------------------------------------------------------------------------

const prefRowSchema = z.object({
  reason: z.enum(REASONS),
  channel: z.enum(CHANNELS),
  enabled: z.boolean(),
  digestMode: z.enum(DIGEST_MODES),
})
export type PrefRow = z.infer<typeof prefRowSchema>
const prefsSchema = z.object({ items: z.array(prefRowSchema) })

export function fetchPrefs(): Promise<{ items: PrefRow[] }> {
  return apiClient.get('/api/v1/notifications/prefs', prefsSchema)
}

export function putPrefs(items: PrefRow[], csrfToken: string): Promise<{ items: PrefRow[] }> {
  return putJson('/api/v1/notifications/prefs', { items }, prefsSchema, csrfToken)
}

// --- Quiet hours -----------------------------------------------------------------------------------

const quietHoursSchema = z.object({
  startMinute: z.number().nullable(),
  endMinute: z.number().nullable(),
  includeWeekends: z.boolean().nullable(),
  effective: z.object({
    startMinute: z.number(),
    endMinute: z.number(),
    includeWeekends: z.boolean(),
    source: z.enum(['personal', 'department_default']),
  }),
})
export type QuietHoursDto = z.infer<typeof quietHoursSchema>

export function fetchQuietHours(departmentId: string | null): Promise<QuietHoursDto> {
  const q = departmentId ? `?departmentId=${encodeURIComponent(departmentId)}` : ''
  return apiClient.get(`/api/v1/notifications/quiet-hours${q}`, quietHoursSchema)
}

export type QuietHoursInput = {
  startMinute: number | null
  endMinute: number | null
  includeWeekends: boolean | null
}

export function putQuietHours(
  departmentId: string | null,
  input: QuietHoursInput,
  csrfToken: string,
): Promise<QuietHoursDto> {
  const q = departmentId ? `?departmentId=${encodeURIComponent(departmentId)}` : ''
  return putJson(`/api/v1/notifications/quiet-hours${q}`, input, quietHoursSchema, csrfToken)
}

// --- Department settings ---------------------------------------------------------------------------

const departmentSettingsSchema = z.object({
  departmentId: z.string(),
  quietStartMinute: z.number(),
  quietEndMinute: z.number(),
  quietWeekends: z.boolean(),
  groupConnectHeadOnly: z.boolean(),
})
export type DepartmentSettingsDto = z.infer<typeof departmentSettingsSchema>

export function fetchDepartmentSettings(departmentId: string): Promise<DepartmentSettingsDto> {
  return apiClient.get(
    `/api/v1/notifications/departments/${departmentId}/settings`,
    departmentSettingsSchema,
  )
}

export function putDepartmentSettings(
  departmentId: string,
  patch: Partial<
    Pick<
      DepartmentSettingsDto,
      'quietStartMinute' | 'quietEndMinute' | 'quietWeekends' | 'groupConnectHeadOnly'
    >
  >,
  csrfToken: string,
): Promise<DepartmentSettingsDto> {
  return putJson(
    `/api/v1/notifications/departments/${departmentId}/settings`,
    patch,
    departmentSettingsSchema,
    csrfToken,
  )
}

// --- ICS feed --------------------------------------------------------------------------------------

const icsTokenSchema = z.object({ url: z.string() })

export function fetchIcsUrl(): Promise<{ url: string }> {
  return apiClient.get('/api/v1/notifications/ics-token', icsTokenSchema)
}

// --- Telegram: personal linking --------------------------------------------------------------------

const linkStatusSchema = z.object({
  linked: z.boolean(),
  linkedAt: z.string().nullable(),
  mutedUntil: z.string().nullable(),
  botUsername: z.string().nullable(),
})
export type LinkStatusDto = z.infer<typeof linkStatusSchema>

export function fetchTelegramStatus(): Promise<LinkStatusDto> {
  return apiClient.get('/api/v1/telegram/status', linkStatusSchema)
}

const linkCodeSchema = z.object({
  code: z.string(),
  deepLink: z.string().nullable(),
  expiresAt: z.string(),
  qrDataUrl: z.string().nullable(),
})
export type LinkCodeDto = z.infer<typeof linkCodeSchema>

export function requestTelegramLinkCode(csrfToken: string): Promise<LinkCodeDto> {
  return apiClient.post('/api/v1/telegram/link-code', {}, linkCodeSchema, csrfToken)
}

export function unlinkTelegram(csrfToken: string) {
  return apiClient.post('/api/v1/telegram/unlink', {}, z.void(), csrfToken)
}

export function muteTelegram(minutes: number, csrfToken: string) {
  return apiClient.post('/api/v1/telegram/mute', { minutes }, z.void(), csrfToken)
}

// --- Telegram: department groups -------------------------------------------------------------------

const groupSchema = z.object({
  id: z.string(),
  chatId: z.string(),
  title: z.string().nullable(),
  kinds: z.array(z.enum(GROUP_KINDS)),
  connectedAt: z.string(),
})
export type TelegramGroupDto = z.infer<typeof groupSchema>
const groupListSchema = z.object({ items: z.array(groupSchema) })

export function fetchDepartmentGroups(
  departmentId: string,
): Promise<{ items: TelegramGroupDto[] }> {
  return apiClient.get(`/api/v1/telegram/departments/${departmentId}/groups`, groupListSchema)
}

const groupConnectCodeSchema = z.object({ code: z.string(), expiresAt: z.string() })
export type GroupConnectCodeDto = z.infer<typeof groupConnectCodeSchema>

export function requestGroupConnectCode(
  departmentId: string,
  csrfToken: string,
): Promise<GroupConnectCodeDto> {
  return apiClient.post(
    `/api/v1/telegram/departments/${departmentId}/connect-code`,
    {},
    groupConnectCodeSchema,
    csrfToken,
  )
}

export function putGroupKinds(
  departmentId: string,
  groupId: string,
  kinds: GroupKind[],
  csrfToken: string,
) {
  return patchJson(
    `/api/v1/telegram/departments/${departmentId}/groups/${groupId}`,
    { kinds },
    z.void(),
    csrfToken,
  )
}

export function disconnectGroup(departmentId: string, groupId: string, csrfToken: string) {
  return delJson(
    `/api/v1/telegram/departments/${departmentId}/groups/${groupId}`,
    z.void(),
    csrfToken,
  )
}
