// The Telegram Mini App's shared vocabulary (v1.1 SPEC §9, EPIC-015): the screen list, the wire
// shapes its own three endpoints answer with, and the header its sign-in uses.
//
// It lives here for the same reason `indicators.ts` and `custom-fields.ts` do: the bot (`apps/api`)
// builds `web_app` buttons pointing at these routes, and the app (`apps/miniapp`) resolves the same
// strings back into screens. Two copies of that list is exactly how a button ends up opening a
// screen that no longer exists.
//
// Nothing here has a runtime dependency; the server's own Zod schemas
// (`apps/api/src/modules/telegram/miniapp-schemas.ts`) are the validators, these are the types the
// client reads them back as.

/** The header `POST /api/v1/telegram/miniapp/session` authenticates with. A custom request header,
 * never a cookie or a query parameter -- a cross-site page cannot set one without a CORS preflight
 * this API never grants, and it never lands in an access log. */
export const MINIAPP_INIT_DATA_HEADER = 'X-Telegram-Init-Data'

/** Every screen the Mini App has, as a hash route. Hash routing, not history routing, because the
 * app is served as one static file from `/miniapp/` behind whatever reverse proxy an instance runs,
 * and a hash never needs a rewrite rule to survive a reload inside Telegram's webview. */
export const MINIAPP_ROUTES = {
  today: '#/',
  inbox: '#/inbox',
  board: '#/board',
  events: '#/events',
  focus: '#/focus',
  fields: '#/fields',
  setup: '#/setup',
} as const

export type MiniappRouteKey = keyof typeof MINIAPP_ROUTES

export const MINIAPP_ROUTE_KEYS = Object.keys(MINIAPP_ROUTES) as readonly MiniappRouteKey[]

export function isMiniappRouteKey(value: string): value is MiniappRouteKey {
  return Object.prototype.hasOwnProperty.call(MINIAPP_ROUTES, value)
}

/** How the current request was authenticated. `web_session` is the documented local-development
 * path (an ordinary `devon_sid` cookie in a normal browser); the Mini App shows a visible strip in
 * that mode so a screenshot can never be mistaken for the real thing. */
export type MiniappSource = 'telegram' | 'web_session'

export type MiniappIdentity = {
  user: {
    id: string
    givenName: string
    familyName: string
    patronymic: string | null
    title: string | null
    locale: string
    avatarKey: string | null
  }
  department: { id: string; name: string } | null
  /** The role inside the active department (I-8b: never the instance role). */
  departmentRole: 'head' | 'member' | null
  botUsername: string | null
  telegramLinked: boolean
  source: MiniappSource
  /** `?startapp=<value>` from the launch, so a bot button can open a named screen. */
  startParam: string | null
  unreadCount: number
  fieldsAvailable: boolean
}

export type MiniappSession = MiniappIdentity & { csrfToken: string }

export type MiniappCard = {
  id: string
  title: string
  status: 'active' | 'done' | 'archived'
  priority: 'none' | 'low' | 'medium' | 'high' | 'urgent'
  risk: 'none' | 'at_risk' | 'overdue'
  dueAt: string | null
  assigneeUserId: string | null
  giverUserId: string | null
  projectTitle: string | null
  checklistTotal: number
  checklistDone: number
  commentCount: number
  canEdit: boolean
  version: number
}

export type MiniappPerson = {
  userId: string
  givenName: string
  familyName: string
  title: string | null
  unitName: string | null
  role: 'head' | 'member'
  openCards: number
  overdueCards: number
  doneLast7d: number
}

export type MiniappBoardPeek = {
  mine: MiniappCard[]
  team: MiniappPerson[]
  departmentOpenCards: number
  departmentOverdueCards: number
}

/** Mirrors `FieldValue` in `./custom-fields.js`. */
export type MiniappFieldValue = string | number | boolean | readonly string[] | null

export type MiniappField = {
  defId: string
  key: string
  label: Readonly<Record<string, string>>
  description: Readonly<Record<string, string>> | null
  type: string
  options: ReadonlyArray<{
    id: string
    label: Readonly<Record<string, string>>
    colorToken: string
  }>
  required: boolean
  selfEditable: boolean
  value: MiniappFieldValue
  /** The head has asked this person to fill it in (SPEC §5's notify-to-fill). */
  requested: boolean
}

export type MiniappFields = { available: boolean; items: MiniappField[] }

export type MiniappSetupStepId =
  | 'bot_token'
  | 'bot_username'
  | 'menu_button'
  | 'link_self'
  | 'members_linked'
  | 'group_connected'

export type MiniappSetupChecklist = {
  botConfigured: boolean
  botUsername: string | null
  miniappUrl: string
  memberCount: number
  linkedMemberCount: number
  groupCount: number
  steps: ReadonlyArray<{
    id: MiniappSetupStepId
    done: boolean
    progress: { done: number; total: number } | null
  }>
}

export type MiniappFocusAlert = {
  sent: boolean
  reason: 'ok' | 'not_linked' | 'not_configured' | 'muted' | 'failed'
}
