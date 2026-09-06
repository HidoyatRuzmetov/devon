// Drizzle table definitions mirroring `migrations/0400_events.sql` (EPIC-008, TECH-SPEC §3.4).
// MODULE-GUIDE.md "DB: schema": this file is never added to `schema/index.ts`'s `export *` -- it is
// reached by relative import from code that already lives inside `@devon/db` (this module's own
// `src/seed/modules/events.ts`). `apps/api`'s events module talks to these tables through `Tx.raw()`
// instead (MODULE-GUIDE.md "API modules": "never a direct `@devon/db` import from a route handler" --
// and the package's `exports` map only opens `.`, not a schema subpath, so that is also the only
// route available to it). This file exists for the same reason `schema/app.ts` does: a structural
// mirror of the hand-authored SQL for typed query-building where it *is* reachable, not the source of
// truth for the shape itself.
import { boolean, integer, pgSchema, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core'

export const appSchema = pgSchema('app')

export const eventCategoryEnum = appSchema.enum('event_category', [
  'team_building',
  'sports',
  'volunteering',
  'social',
  'training',
  'family',
  'other',
])

export const eventStatusEnum = appSchema.enum('event_status', [
  'draft',
  'open',
  'full',
  'cancelled',
  'done',
])

export const eventRsvpStatusEnum = appSchema.enum('event_rsvp_status', [
  'yes',
  'no',
  'maybe',
  'waitlist',
])

export const carpoolStatusEnum = appSchema.enum('carpool_status', ['open', 'cancelled'])

export const carpoolSeatStatusEnum = appSchema.enum('carpool_seat_status', [
  'confirmed',
  'waitlist',
])

export const pollKindEnum = appSchema.enum('poll_kind', ['date', 'single', 'multi'])

export const pollStatusEnum = appSchema.enum('poll_status', ['open', 'closed'])

export const events = appSchema.table('events', {
  id: uuid('id').primaryKey().defaultRandom(),
  departmentId: uuid('department_id').notNull(),
  title: text('title').notNull(),
  description: text('description'),
  category: eventCategoryEnum('category').notNull().default('other'),
  illustrationKey: text('illustration_key').notNull().default('team_building'),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
  timezone: text('timezone').notNull().default('Asia/Tashkent'),
  place: text('place'),
  placeUrl: text('place_url'),
  capacity: integer('capacity'),
  waitlistEnabled: boolean('waitlist_enabled').notNull().default(true),
  rsvpDeadline: timestamp('rsvp_deadline', { withTimezone: true }),
  costNote: text('cost_note'),
  reminderOffsetsMinutes: integer('reminder_offsets_minutes').array().notNull().default([1440, 60]),
  organizerUserId: uuid('organizer_user_id').notNull(),
  status: eventStatusEnum('status').notNull().default('open'),
  updatedSummary: text('updated_summary'),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  cancelledReason: text('cancelled_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  version: integer('version').notNull().default(1),
})

export const eventRsvps = appSchema.table('event_rsvps', {
  id: uuid('id').primaryKey().defaultRandom(),
  departmentId: uuid('department_id').notNull(),
  eventId: uuid('event_id').notNull(),
  userId: uuid('user_id').notNull(),
  status: eventRsvpStatusEnum('status').notNull().default('yes'),
  guests: smallint('guests').notNull().default(0),
  note: text('note'),
  changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const eventComments = appSchema.table('event_comments', {
  id: uuid('id').primaryKey().defaultRandom(),
  departmentId: uuid('department_id').notNull(),
  eventId: uuid('event_id').notNull(),
  authorUserId: uuid('author_user_id').notNull(),
  body: text('body').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
})

export const carpools = appSchema.table('carpools', {
  id: uuid('id').primaryKey().defaultRandom(),
  departmentId: uuid('department_id').notNull(),
  eventId: uuid('event_id').notNull(),
  driverUserId: uuid('driver_user_id').notNull(),
  seats: smallint('seats').notNull(),
  departurePlace: text('departure_place'),
  departureAt: timestamp('departure_at', { withTimezone: true }),
  note: text('note'),
  status: carpoolStatusEnum('status').notNull().default('open'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const carpoolSeats = appSchema.table('carpool_seats', {
  id: uuid('id').primaryKey().defaultRandom(),
  departmentId: uuid('department_id').notNull(),
  carpoolId: uuid('carpool_id').notNull(),
  userId: uuid('user_id').notNull(),
  seatsClaimed: smallint('seats_claimed').notNull().default(1),
  status: carpoolSeatStatusEnum('status').notNull().default('confirmed'),
  claimedAt: timestamp('claimed_at', { withTimezone: true }).notNull().defaultNow(),
})

export const eventItems = appSchema.table('event_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  departmentId: uuid('department_id').notNull(),
  eventId: uuid('event_id').notNull(),
  label: text('label').notNull(),
  quantity: smallint('quantity').notNull().default(1),
  claimedByUserId: uuid('claimed_by_user_id'),
  claimedAt: timestamp('claimed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const polls = appSchema.table('polls', {
  id: uuid('id').primaryKey().defaultRandom(),
  departmentId: uuid('department_id').notNull(),
  eventId: uuid('event_id'),
  kind: pollKindEnum('kind').notNull(),
  question: text('question').notNull(),
  anonymous: boolean('anonymous').notNull().default(false),
  closesAt: timestamp('closes_at', { withTimezone: true }),
  createdByUserId: uuid('created_by_user_id').notNull(),
  status: pollStatusEnum('status').notNull().default('open'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const pollOptions = appSchema.table('poll_options', {
  id: uuid('id').primaryKey().defaultRandom(),
  departmentId: uuid('department_id').notNull(),
  pollId: uuid('poll_id').notNull(),
  label: text('label').notNull(),
  optionDate: timestamp('option_date', { withTimezone: true }),
  sortOrder: integer('sort_order').notNull().default(0),
})

export const pollVotes = appSchema.table('poll_votes', {
  id: uuid('id').primaryKey().defaultRandom(),
  departmentId: uuid('department_id').notNull(),
  pollId: uuid('poll_id').notNull(),
  optionId: uuid('option_id').notNull(),
  userId: uuid('user_id'),
  voterHash: text('voter_hash'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const eventPhotos = appSchema.table('event_photos', {
  id: uuid('id').primaryKey().defaultRandom(),
  departmentId: uuid('department_id').notNull(),
  eventId: uuid('event_id').notNull(),
  url: text('url').notNull(),
  caption: text('caption'),
  addedByUserId: uuid('added_by_user_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const eventFeedback = appSchema.table('event_feedback', {
  id: uuid('id').primaryKey().defaultRandom(),
  departmentId: uuid('department_id').notNull(),
  eventId: uuid('event_id').notNull(),
  userId: uuid('user_id').notNull(),
  rating: smallint('rating').notNull(),
  comment: text('comment'),
  anonymous: boolean('anonymous').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

/** Not RLS-scoped (see `tenancy.ts`'s `GLOBAL_ALLOWLIST` for `app.event_reminder_jobs`) -- the
 * reminder worker (`apps/api/src/modules/events/reminder-worker.ts`) polls across every department at
 * once, exactly like `app.outbox_events`, so it still carries `department_id` as a plain column for a
 * subscriber to filter/audit on without that column driving row visibility. */
export const eventReminderJobs = appSchema.table('event_reminder_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  departmentId: uuid('department_id').notNull(),
  eventId: uuid('event_id').notNull(),
  kind: text('kind').notNull(),
  fireAt: timestamp('fire_at', { withTimezone: true }).notNull(),
  firedAt: timestamp('fired_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
