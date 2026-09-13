// The Mini App's one network seam. Same-origin, cookie-carrying, Zod-validated, RFC 9457-aware --
// the same contract `apps/web/src/lib/api-client.ts` implements for the web app, kept separate
// because this app has its own sign-in step (`signIn()`) and its own recovery rule (a 401 means the
// Telegram session expired while the sheet was open, so re-exchange once and retry).
import { z } from 'zod'
import {
  MINIAPP_INIT_DATA_HEADER,
  problemSchema,
  type MiniappBoardPeek,
  type MiniappFields,
  type MiniappFieldValue,
  type MiniappFocusAlert,
  type MiniappSession,
  type MiniappSetupChecklist,
} from '@devon/contracts'
import { tg } from './telegram.js'

/** Every outbound call is bounded (TECH-SPEC §16: "timeouts on every outbound call"). A phone on a
 * ministry building's mobile signal is the normal case, not the exception, so the budget is generous
 * -- but it is never absent, because a hung fetch inside a Telegram sheet shows a spinner forever. */
const REQUEST_TIMEOUT_MS = 15_000

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly requestId: string | null
  constructor(status: number, code: string, message: string, requestId: string | null) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.requestId = requestId
  }
  /** The screen shows the offline state for this one rather than the error state -- a different
   * illustration, a different sentence and a retry that means something (DESIGN.md §4). */
  get isOffline(): boolean {
    return this.code === 'offline'
  }
  get isForbidden(): boolean {
    return this.status === 403
  }
}

/** The double-submit companion cookie (`apps/api/src/lib/cookies.ts`), deliberately NOT HttpOnly. */
const CSRF_COOKIE = 'devon_csrf'

let csrfToken: string | null = null

export function setCsrfToken(token: string | null): void {
  csrfToken = token && token !== '' ? token : null
}

/**
 * The token to double-submit on a mutating call.
 *
 * Two sources, in this order, and both are needed:
 *
 *  - the value `POST /session` answered with. Inside Telegram this is the only readable one: some
 *    webviews hand the page a cookie jar `document.cookie` cannot see even though `fetch` sends it.
 *  - the `devon_csrf` cookie. This is what makes the *first* call work at all. `plugins/csrf-guard.ts`
 *    checks every unsafe method on any request that already carries a session -- and in the documented
 *    browser dev path the session cookie exists before the Mini App has ever run, so the sign-in
 *    exchange itself is checked. Without this fallback the app cannot boot in a browser at all
 *    (403 on `POST /session`), and inside Telegram a sheet relaunched on a still-valid cookie hits
 *    exactly the same wall.
 */
function currentCsrfToken(): string | null {
  if (csrfToken) return csrfToken
  if (typeof document === 'undefined') return null
  const match = new RegExp(`(?:^|;\\s*)${CSRF_COOKIE}=([^;]*)`).exec(document.cookie)
  const value = match?.[1] ? decodeURIComponent(match[1]) : null
  return value && value !== '' ? value : null
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  body?: unknown
  /** Used once, by `signIn()`. */
  initData?: string
  /** Internal: prevents the 401 recovery from recursing. */
  noRetry?: boolean
}

async function parseProblem(response: Response): Promise<ApiError> {
  const requestId = response.headers.get('x-request-id')
  try {
    const body: unknown = await response.json()
    const parsed = problemSchema.safeParse(body)
    if (parsed.success) {
      return new ApiError(
        response.status,
        parsed.data.code,
        parsed.data.title,
        parsed.data.instance ?? requestId,
      )
    }
  } catch {
    // A non-JSON error body (a proxy's own 502 page, for instance) is still an error; it just has
    // nothing useful to say, so the generic code below carries the request id instead.
  }
  return new ApiError(response.status, 'unexpected', `HTTP ${response.status}`, requestId)
}

async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  options: RequestOptions = {},
): Promise<T> {
  const method = options.method ?? 'GET'
  const headers: Record<string, string> = { accept: 'application/json' }
  if (options.body !== undefined) headers['content-type'] = 'application/json'
  if (options.initData) headers[MINIAPP_INIT_DATA_HEADER] = options.initData
  // Double-submit CSRF, exactly as `apps/api/src/lib/csrf.ts` requires. The token comes from the
  // sign-in response, never from `document.cookie` -- some Telegram webviews hand a page a cookie
  // jar that `document.cookie` cannot read even though `fetch` sends it.
  if (method !== 'GET') {
    const token = currentCsrfToken()
    if (token) headers['x-csrf-token'] = token
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  let response: Response
  try {
    response = await fetch(`/api/v1${path}`, {
      method,
      headers,
      credentials: 'same-origin',
      signal: controller.signal,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    })
  } catch {
    throw new ApiError(0, 'offline', 'network unreachable', null)
  } finally {
    clearTimeout(timer)
  }

  if (response.status === 401 && !options.noRetry && tg.isTelegram) {
    // The 12-hour Mini App cookie expired while the sheet was open. Telegram still holds a fresh
    // `initData`, so one silent re-exchange is the correct recovery -- and `noRetry` makes sure this
    // can happen at most once per call.
    await signIn()
    return request(path, schema, { ...options, noRetry: true })
  }

  if (!response.ok) throw await parseProblem(response)
  if (response.status === 204) return schema.parse(undefined)

  const payload: unknown = await response.json()
  const parsed = schema.safeParse(payload)
  if (!parsed.success) {
    throw new ApiError(
      response.status,
      'unexpected',
      'response did not match its contract',
      response.headers.get('x-request-id'),
    )
  }
  return parsed.data
}

// --- Sign in ----------------------------------------------------------------------------------------

const sessionSchema = z.object({
  user: z.object({
    id: z.string(),
    givenName: z.string(),
    familyName: z.string(),
    patronymic: z.string().nullable(),
    title: z.string().nullable(),
    locale: z.string(),
    avatarKey: z.string().nullable(),
  }),
  department: z.object({ id: z.string(), name: z.string() }).nullable(),
  departmentRole: z.enum(['head', 'member']).nullable(),
  botUsername: z.string().nullable(),
  telegramLinked: z.boolean(),
  source: z.enum(['telegram', 'web_session']),
  startParam: z.string().nullable(),
  unreadCount: z.number(),
  fieldsAvailable: z.boolean(),
  csrfToken: z.string(),
})

export async function signIn(): Promise<MiniappSession> {
  const initData = tg.initData
  const session = await request('/telegram/miniapp/session', sessionSchema, {
    method: 'POST',
    noRetry: true,
    ...(initData ? { initData } : {}),
  })
  setCsrfToken(session.csrfToken)
  return session
}

// --- Inbox (the existing notifications module) --------------------------------------------------------

const localizedSchema = z.record(z.string(), z.string())

export const notificationSchema = z.object({
  id: z.string(),
  type: z.string(),
  reason: z.string(),
  subjectType: z.string(),
  subjectId: z.string().nullable(),
  departmentId: z.string().nullable(),
  title: localizedSchema,
  body: localizedSchema.nullable(),
  deepLink: z.string().nullable(),
  readAt: z.string().nullable(),
  archivedAt: z.string().nullable(),
  snoozedUntil: z.string().nullable(),
  createdAt: z.string(),
})
export type Notification = z.infer<typeof notificationSchema>

const notificationListSchema = z.object({
  items: z.array(notificationSchema),
  unreadCount: z.number(),
  nextCursor: z.string().nullable(),
})

export function listNotifications(status: 'inbox' | 'unread' = 'inbox') {
  return request(`/notifications?status=${status}&limit=40`, notificationListSchema)
}

export function markNotificationsRead(ids: string[]) {
  return request('/notifications/read', z.unknown(), { method: 'POST', body: { ids } })
}

export function markAllNotificationsRead() {
  return request('/notifications/read-all', z.unknown(), { method: 'POST' })
}

export function archiveNotifications(ids: string[]) {
  return request('/notifications/archive', z.unknown(), { method: 'POST', body: { ids } })
}

export function snoozeNotification(id: string, minutes: number) {
  return request(`/notifications/${id}/snooze`, z.unknown(), {
    method: 'POST',
    body: { minutes },
  })
}

// --- Board peek and cards ------------------------------------------------------------------------------

const boardPeekSchema = z.object({
  mine: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      status: z.enum(['active', 'done', 'archived']),
      priority: z.enum(['none', 'low', 'medium', 'high', 'urgent']),
      risk: z.enum(['none', 'at_risk', 'overdue']),
      dueAt: z.string().nullable(),
      assigneeUserId: z.string().nullable(),
      giverUserId: z.string().nullable(),
      projectTitle: z.string().nullable(),
      checklistTotal: z.number(),
      checklistDone: z.number(),
      commentCount: z.number(),
      canEdit: z.boolean(),
      version: z.number(),
    }),
  ),
  team: z.array(
    z.object({
      userId: z.string(),
      givenName: z.string(),
      familyName: z.string(),
      title: z.string().nullable(),
      unitName: z.string().nullable(),
      role: z.enum(['head', 'member']),
      openCards: z.number(),
      overdueCards: z.number(),
      doneLast7d: z.number(),
    }),
  ),
  departmentOpenCards: z.number(),
  departmentOverdueCards: z.number(),
})

export function getBoardPeek(): Promise<MiniappBoardPeek> {
  return request('/telegram/miniapp/board-peek', boardPeekSchema)
}

const cardDetailSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.object({ format: z.string(), text: z.string() }).nullable(),
  status: z.enum(['active', 'done', 'archived']),
  priority: z.enum(['none', 'low', 'medium', 'high', 'urgent']),
  risk: z.enum(['none', 'at_risk', 'overdue']),
  dueAt: z.string().nullable(),
  assigneeUserId: z.string().nullable(),
  giverUserId: z.string().nullable(),
  checklistTotal: z.number(),
  checklistDone: z.number(),
  commentCount: z.number(),
  version: z.number(),
  canEdit: z.boolean().optional(),
  checklist: z.array(z.object({ id: z.string(), text: z.string(), doneAt: z.string().nullable() })),
  comments: z.array(
    z.object({
      id: z.string(),
      authorUserId: z.string(),
      body: z.object({ format: z.string(), text: z.string() }),
      createdAt: z.string(),
    }),
  ),
})
export type CardDetail = z.infer<typeof cardDetailSchema>

export function getCard(id: string): Promise<CardDetail> {
  return request(`/cards/${id}`, cardDetailSchema)
}

export function setCardStatus(
  id: string,
  status: 'active' | 'done',
  version: number,
): Promise<CardDetail> {
  return request(`/cards/${id}`, cardDetailSchema, {
    method: 'PATCH',
    body: { status, version },
  })
}

export function addCardComment(id: string, text: string) {
  return request(`/cards/${id}/comments`, z.object({ id: z.string() }), {
    method: 'POST',
    body: { text },
  })
}

// --- Events, carpools, polls ----------------------------------------------------------------------

const summaryUserSchema = z.object({
  id: z.string(),
  givenName: z.string(),
  familyName: z.string(),
})

export const eventSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  category: z.string(),
  startsAt: z.string(),
  endsAt: z.string(),
  place: z.string().nullable(),
  capacity: z.number().nullable(),
  status: z.string(),
  organizer: summaryUserSchema,
  goingCount: z.number(),
  maybeCount: z.number(),
  waitlistCount: z.number(),
  myRsvp: z
    .object({ status: z.string(), guests: z.number(), note: z.string().nullable() })
    .nullable(),
  canManage: z.boolean(),
})
export type EventDto = z.infer<typeof eventSchema>

export function listEvents(): Promise<{ items: EventDto[] }> {
  return request('/events', z.object({ items: z.array(eventSchema) }))
}

export function rsvp(eventId: string, status: 'yes' | 'no' | 'maybe'): Promise<EventDto> {
  return request(`/events/${eventId}/rsvp`, eventSchema, {
    method: 'POST',
    body: { status, guests: 0 },
  })
}

export const carpoolSchema = z.object({
  id: z.string(),
  driver: summaryUserSchema,
  seats: z.number(),
  seatsClaimed: z.number(),
  departurePlace: z.string().nullable(),
  departureAt: z.string().nullable(),
  note: z.string().nullable(),
  status: z.enum(['open', 'cancelled']),
  passengers: z.array(
    z.object({
      userId: z.string(),
      givenName: z.string(),
      familyName: z.string(),
      seatsClaimed: z.number(),
      status: z.enum(['confirmed', 'waitlist']),
    }),
  ),
  canManage: z.boolean(),
})
export type Carpool = z.infer<typeof carpoolSchema>

export function listCarpools(eventId: string): Promise<{ items: Carpool[] }> {
  return request(`/events/${eventId}/carpools`, z.object({ items: z.array(carpoolSchema) }))
}

export function claimCarpoolSeat(eventId: string, carpoolId: string, seats = 1) {
  return request(`/events/${eventId}/carpools/${carpoolId}/claim`, z.unknown(), {
    method: 'POST',
    body: { seats },
  })
}

export function releaseCarpoolSeat(eventId: string, carpoolId: string) {
  return request(`/events/${eventId}/carpools/${carpoolId}/claim`, z.unknown(), {
    method: 'DELETE',
  })
}

export const pollSchema = z.object({
  id: z.string(),
  kind: z.string(),
  question: z.string(),
  anonymous: z.boolean(),
  closesAt: z.string().nullable(),
  status: z.enum(['open', 'closed']),
  totalVotes: z.number(),
  options: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      optionDate: z.string().nullable(),
      votes: z.number(),
      votedByMe: z.boolean(),
    }),
  ),
  canManage: z.boolean(),
})
export type Poll = z.infer<typeof pollSchema>

export function listPolls(eventId: string): Promise<{ items: Poll[] }> {
  return request(`/events/${eventId}/polls`, z.object({ items: z.array(pollSchema) }))
}

export function voteOnPoll(eventId: string, pollId: string, optionIds: string[]): Promise<Poll> {
  return request(`/events/${eventId}/polls/${pollId}/vote`, pollSchema, {
    method: 'POST',
    body: { optionIds },
  })
}

// --- Personal workspace (I-1: the viewer's own rows, always) ----------------------------------------

export const personalTaskSchema = z.object({
  id: z.string(),
  sprintId: z.string().nullable(),
  parentId: z.string().nullable(),
  title: z.string(),
  doneAt: z.string().nullable(),
  notes: z.string().nullable(),
  sort: z.number(),
  estimateMin: z.number().nullable(),
  linkedCardId: z.string().nullable(),
  version: z.number(),
})
export type PersonalTask = z.infer<typeof personalTaskSchema>

export function listPersonalTasks(): Promise<PersonalTask[]> {
  return request('/personal/tasks', z.array(personalTaskSchema))
}

export function createPersonalTask(title: string): Promise<PersonalTask> {
  return request('/personal/tasks', personalTaskSchema, { method: 'POST', body: { title } })
}

export function setPersonalTaskDone(
  id: string,
  done: boolean,
  version: number,
): Promise<PersonalTask> {
  return request(`/personal/tasks/${id}`, personalTaskSchema, {
    method: 'PATCH',
    body: { done, version },
  })
}

export const pomodoroSettingsSchema = z.object({
  focusMin: z.number(),
  shortBreakMin: z.number(),
  longBreakMin: z.number(),
  cyclesBeforeLong: z.number(),
  sound: z.string(),
  notifications: z.boolean(),
  autoStart: z.boolean(),
})
export type PomodoroSettings = z.infer<typeof pomodoroSettingsSchema>

export function getPomodoroSettings(): Promise<PomodoroSettings> {
  return request('/personal/pomodoro/settings', pomodoroSettingsSchema)
}

export const pomodoroSessionSchema = z.object({
  id: z.string(),
  taskId: z.string().nullable(),
  kind: z.enum(['focus', 'short_break', 'long_break']),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  completed: z.boolean(),
})
export type PomodoroSession = z.infer<typeof pomodoroSessionSchema>

export function listPomodoroSessions(): Promise<PomodoroSession[]> {
  return request('/personal/pomodoro/sessions', z.array(pomodoroSessionSchema))
}

export function startPomodoroSession(
  kind: 'focus' | 'short_break' | 'long_break',
  startedAt: string,
): Promise<PomodoroSession> {
  return request('/personal/pomodoro/sessions', pomodoroSessionSchema, {
    method: 'POST',
    body: { kind, startedAt },
  })
}

export function endPomodoroSession(
  id: string,
  endedAt: string,
  completed: boolean,
): Promise<PomodoroSession> {
  return request(`/personal/pomodoro/sessions/${id}`, pomodoroSessionSchema, {
    method: 'PATCH',
    body: { endedAt, completed },
  })
}

const pomodoroStatsSchema = z.object({
  today: z.object({
    focusMinutes: z.number(),
    focusSessions: z.number(),
    completedSessions: z.number(),
  }),
  week: z.object({
    focusMinutes: z.number(),
    focusSessions: z.number(),
    completedSessions: z.number(),
  }),
})
export type PomodoroStats = z.infer<typeof pomodoroStatsSchema>

export function getPomodoroStats(): Promise<PomodoroStats> {
  return request('/personal/pomodoro/stats', pomodoroStatsSchema)
}

const focusAlertSchema = z.object({
  sent: z.boolean(),
  reason: z.enum(['ok', 'not_linked', 'not_configured', 'muted', 'failed']),
})

export function sendFocusAlert(
  kind: 'focus' | 'short_break' | 'long_break',
  minutes: number,
): Promise<MiniappFocusAlert> {
  return request('/telegram/miniapp/focus-alert', focusAlertSchema, {
    method: 'POST',
    body: { kind, minutes },
  })
}

// --- My person fields (SPEC §5's notify-to-fill lands here) -------------------------------------------

const fieldsSchema = z.object({
  available: z.boolean(),
  items: z.array(
    z.object({
      defId: z.string(),
      key: z.string(),
      label: localizedSchema,
      description: localizedSchema.nullable(),
      type: z.string(),
      options: z.array(
        z.object({ id: z.string(), label: localizedSchema, colorToken: z.string() }),
      ),
      required: z.boolean(),
      selfEditable: z.boolean(),
      value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.null()]),
      requested: z.boolean(),
    }),
  ),
})

export function getMyFields(): Promise<MiniappFields> {
  return request('/telegram/miniapp/fields', fieldsSchema)
}

export function setMyField(defId: string, value: MiniappFieldValue): Promise<MiniappFields> {
  return request(`/telegram/miniapp/fields/${defId}`, fieldsSchema, {
    method: 'PUT',
    body: { value },
  })
}

// --- The head's setup checklist ---------------------------------------------------------------------

const setupChecklistSchema = z.object({
  botConfigured: z.boolean(),
  botUsername: z.string().nullable(),
  miniappUrl: z.string(),
  memberCount: z.number(),
  linkedMemberCount: z.number(),
  groupCount: z.number(),
  steps: z.array(
    z.object({
      id: z.enum([
        'bot_token',
        'bot_username',
        'menu_button',
        'link_self',
        'members_linked',
        'group_connected',
      ]),
      done: z.boolean(),
      progress: z.object({ done: z.number(), total: z.number() }).nullable(),
    }),
  ),
})

export function getSetupChecklist(departmentId: string): Promise<MiniappSetupChecklist> {
  return request(`/telegram/departments/${departmentId}/setup-checklist`, setupChecklistSchema)
}
