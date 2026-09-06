// Drizzle table definitions for the notifications/Telegram module (MODULE-GUIDE.md "DB: schema";
// TECH-SPEC §3.6). Mirrors `migrations/0600_notifications.sql` and `migrations/0601_telegram.sql` --
// these exist for typed query-building through `Tx.drizzle`; the hand-authored SQL in those files is
// the actual source of truth, kept in structural parity by hand (same convention `schema/app.ts`
// documents for the foundation tables).
//
// This module never adds an `export *` line to `schema/index.ts` (MODULE-GUIDE.md): its own repo code
// imports this file directly (`import * as schema from '../../../schema/notifications.js'`).
import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

export const appSchema = pgSchema('app')

/** TECH-SPEC §3.6: `notifications.reason`. One fixed enum, never a free-text column, so a preference
 * row (`notification_prefs.reason`) and a notification row always speak the same vocabulary. */
export const notificationReasonEnum = appSchema.enum('notification_reason', [
  'assigned',
  'mentioned',
  'due',
  'updated',
  'rsvp',
  'poll',
  'decision',
  'digest',
  'system',
])

export const notificationChannelEnum = appSchema.enum('notification_channel', [
  'inapp',
  'telegram',
  'email',
])

export const notificationDigestModeEnum = appSchema.enum('notification_digest_mode', [
  'instant',
  'daily',
  'weekly',
  'off',
])

export const notificationDeliveryStatusEnum = appSchema.enum('notification_delivery_status', [
  'pending',
  'sent',
  'failed',
  'skipped',
])

/** A localized `{uz-Latn, uz-Cyrl, ru, en}` string, matching TECH-SPEC §3's "system text as jsonb"
 * convention. Not a Postgres domain -- just documentation of the shape every `title`/`body` column
 * below carries; validated on the way in by this module's own Zod schema, never trusted raw. */
export type LocalizedText = {
  'uz-Latn': string
  'uz-Cyrl': string
  ru: string
  en: string
}

// --- Notifications (user_owned: TECH-SPEC §3.3's "private to the user" tenancy shape) -------------

export const notifications = appSchema.table('notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  /** `'<module>.<noun>.<verb-past-tense>'` -- the domain event type this notification was raised
   * from, or `'notifications.system.announced'` for a platform-originated one (MODULE-GUIDE.md
   * "Domain events"). Free text on purpose: the registry of event types this module *understands* is
   * `EVENT_REGISTRY` (events.ts), not a database constraint, so an unrecognised event type from a
   * future module still stores (and later renders) instead of failing a check constraint. */
  type: text('type').notNull(),
  reason: notificationReasonEnum('reason').notNull(),
  subjectType: text('subject_type').notNull(),
  subjectId: text('subject_id'),
  /** Context only, never a tenancy boundary for this table (RLS below scopes by `user_id` alone,
   * I-1) -- lets the inbox group/filter by department without a join back to the event payload. */
  departmentId: uuid('department_id'),
  title: jsonb('title').$type<LocalizedText>().notNull(),
  body: jsonb('body').$type<LocalizedText>(),
  /** App-relative path only ("pointer not payload" extends to the inbox itself, not just Telegram) --
   * e.g. `/cards/<id>`. Never an absolute URL, never carries a token. */
  deepLink: text('deep_link'),
  /** The calendar-relevant instant this notification refers to (a card's due date, an event's start
   * time), when the emitting module's event payload supplied one -- `null` for reasons with no
   * calendar meaning ('mentioned', 'system', ...). Feeds `ics.ts`'s per-person ICS export (TECH-SPEC
   * §7): only notifications with a non-null `eventAt` ever produce a `VEVENT`. */
  eventAt: timestamp('event_at', { withTimezone: true }),
  readAt: timestamp('read_at', { withTimezone: true }),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  /** Telegram inline "snooze deadline 1 day" (TECH-SPEC §7): the notification drops out of "due now"
   * surfaces (bell badge, `/today`) until this instant, then reappears exactly as before -- a snooze
   * is a delay this module owns end to end, never a mutation of another module's row. */
  snoozedUntil: timestamp('snoozed_until', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const notificationPrefs = appSchema.table(
  'notification_prefs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull(),
    reason: notificationReasonEnum('reason').notNull(),
    channel: notificationChannelEnum('channel').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    digestMode: notificationDigestModeEnum('digest_mode').notNull().default('instant'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('notification_prefs_user_reason_channel_key').on(t.userId, t.reason, t.channel),
  ],
)

/** One row per user; `null` fields inherit the department default (department_default) computed by
 * `quiet-hours.ts` from `notification_department_settings` -- a personal override may only narrow the
 * window (TECH-SPEC §7 "personal override to quieter"), enforced in the service layer, not here. */
export const notificationQuietHours = appSchema.table('notification_quiet_hours', {
  userId: uuid('user_id').primaryKey(),
  startMinute: integer('start_minute'),
  endMinute: integer('end_minute'),
  includeWeekends: boolean('include_weekends'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const notificationDeliveries = appSchema.table('notification_deliveries', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** Denormalized from `notifications.user_id` so this table's own RLS policy (I-1: user_owned, no
   * join in a policy predicate -- `rls.ts`'s own comment on why a sub-select in a policy is unsafe
   * under READ COMMITTED) can scope directly on a real column. */
  userId: uuid('user_id').notNull(),
  notificationId: uuid('notification_id').notNull(),
  channel: notificationChannelEnum('channel').notNull(),
  status: notificationDeliveryStatusEnum('status').notNull().default('pending'),
  providerId: text('provider_id'),
  attempts: integer('attempts').notNull().default(0),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  sentAt: timestamp('sent_at', { withTimezone: true }),
})

// --- Department settings (department_owned) --------------------------------------------------------

/** Singleton-per-department row (TECH-SPEC §7 quiet hours default 20:00-08:00 + weekends, and "allowed
 * per department setting" for group `/connect`). `quiet*Minute` is minutes since local midnight in the
 * department's own timezone (`app.departments.timezone`), matching `notification_quiet_hours`. */
export const notificationDepartmentSettings = appSchema.table('notification_department_settings', {
  departmentId: uuid('department_id').primaryKey(),
  quietStartMinute: integer('quiet_start_minute').notNull().default(1200), // 20:00
  quietEndMinute: integer('quiet_end_minute').notNull().default(480), // 08:00
  quietWeekends: boolean('quiet_weekends').notNull().default(true),
  /** TECH-SPEC §7: "allowed roles per settings" for a department group `/connect`. `true` (default)
   * restricts group linking to heads; a head may open it up to every member. */
  groupConnectHeadOnly: boolean('group_connect_head_only').notNull().default(true),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// --- Telegram (global: TECH-SPEC §7 -- a webhook update carries only a Telegram chat id, resolved
// before any department/user request context exists, the same bootstrap shape `tenancy.ts` already
// gives `app.sessions` ("looked up by token before you know who's asking"). Per-department and
// per-user visibility is enforced at the application/permission layer (`can()`), not by RLS, exactly
// like `app.users`/`app.sessions` already are.) -----------------------------------------------------

export const telegramLinkCodes = appSchema.table('telegram_link_codes', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  code: text('code').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const telegramLinks = appSchema.table('telegram_links', {
  userId: uuid('user_id').primaryKey(),
  chatId: bigint('chat_id', { mode: 'bigint' }).notNull(),
  linkedAt: timestamp('linked_at', { withTimezone: true }).notNull().defaultNow(),
  linkCodeUsed: text('link_code_used'),
  localeAtLink: text('locale_at_link'),
  mutedUntil: timestamp('muted_until', { withTimezone: true }),
  unlinkedAt: timestamp('unlinked_at', { withTimezone: true }),
})

/**
 * TECH-SPEC §7 describes group connection as "`/connect <join key>`". `app.departments` (owned by the
 * accounts/departments module, migrations 0004) does not yet carry a `join_key` column -- that arrives
 * with the department-join epic. Until then, a department's own short-lived connect code is this
 * module's own artifact (global, bootstrap shape, same reasoning as `telegram_link_codes` above): a
 * head mints one from department settings, the bot's `/connect <code>` consumes it once.
 */
export const telegramGroupConnectCodes = appSchema.table('telegram_group_connect_codes', {
  id: uuid('id').primaryKey().defaultRandom(),
  departmentId: uuid('department_id').notNull(),
  code: text('code').notNull(),
  createdBy: uuid('created_by'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const telegramGroups = appSchema.table('telegram_groups', {
  id: uuid('id').primaryKey().defaultRandom(),
  departmentId: uuid('department_id').notNull(),
  chatId: bigint('chat_id', { mode: 'bigint' }).notNull(),
  title: text('title'),
  connectedBy: uuid('connected_by'),
  /** Subset of `('events','polls','announcements','weekly_summary','deadlines')` -- validated by this
   * module's Zod schema, not a Postgres check constraint (TECH-SPEC §3.6). */
  kinds: text('kinds')
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  connectKeyUsed: text('connect_key_used'),
  connectedAt: timestamp('connected_at', { withTimezone: true }).notNull().defaultNow(),
  disconnectedAt: timestamp('disconnected_at', { withTimezone: true }),
})
