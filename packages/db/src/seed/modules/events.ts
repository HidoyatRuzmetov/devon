// Demo seed for EPIC-008 events (MODULE-GUIDE.md "DB: seeds"). `order: 400` (matches the module's
// migration-number prefix) -- runs well after `core.ts` (order 0), which this module's fixtures
// reference by id (`DEMO_DEPARTMENT`, `DEMO_USERS`). Five events (product spec, TASKS.md EPIC-008):
// one with a carpool offer and a date poll, one that demonstrates the capacity/waitlist path, one
// cancelled, one done with photos and feedback, and one with claimable "who brings what" items and
// comments. Only two demo users exist in the foundation this module builds on
// (`packages/db/src/seed/fixtures.ts`'s `DEMO_USERS`) -- `demo.boshliq` (head, organiser throughout)
// and `demo.xodim` (member) -- so RSVP/carpool/poll/feedback richness here is necessarily thin until
// EPIC-002 (accounts-departments) seeds more colleagues; every row still exercises the real mechanism
// (capacity, waitlist, anonymous votes, diff summaries) rather than faking volume.
//
// Every row is declared once, as a module-level constant, so `seed()` inserts exactly the ids
// `reset()` deletes. Everything lives in `DEMO_DEPARTMENT`, which the shared seed transaction's
// `app.department_id` GUC already points at -- no re-scoping needed in either direction.
import { inArray } from 'drizzle-orm'
import * as schema from '../../schema/events.js'
import { DEMO_DEPARTMENT, DEMO_USERS } from '../fixtures.js'
import { demoId } from '../ids.js'
import type { SeedModuleContext } from '../module-loader.js'

export const order = 400

const DEPT = DEMO_DEPARTMENT.id
const HEAD = DEMO_USERS.find((u) => u.role === 'head')!.id
const MEMBER = DEMO_USERS.find((u) => u.role === 'member')!.id

// 2026-09-06 is "today" in the demo dataset (TASKS.md EPIC-008: "believable dates around 2026-09").
const PICNIC_ID = demoId('event.picnic')
const VOLLEYBALL_ID = demoId('event.volleyball')
const CANCELLED_ID = demoId('event.cancelled-trip')
const VOLUNTEERING_ID = demoId('event.volunteering-day')
const TRAINING_ID = demoId('event.excel-training')

const EVENT_ROWS: (typeof schema.events.$inferInsert)[] = [
  {
    id: PICNIC_ID,
    departmentId: DEPT,
    title: 'Kuz faslidagi jamoaviy piknik',
    description:
      "Bo'limning kuzgi jamoaviy piknigi -- Chorvoq bo'yida, mashvatlar va sport o'yinlari bilan. Aniq sana ovoz berish orqali tanlanadi.",
    category: 'social',
    illustrationKey: 'picnic',
    startsAt: new Date('2026-09-20T09:00:00+05:00'),
    endsAt: new Date('2026-09-20T15:00:00+05:00'),
    place: "Chorvoq suv ombori bo'yi",
    placeUrl: 'https://maps.example.com/chorvoq',
    capacity: 30,
    waitlistEnabled: true,
    rsvpDeadline: new Date('2026-09-18T18:00:00+05:00'),
    costNote: "Transport bo'lim hisobidan, ovqat -- ishtirokchilardan",
    reminderOffsetsMinutes: [1440, 60],
    organizerUserId: HEAD,
    status: 'open',
  },
  {
    id: VOLLEYBALL_ID,
    departmentId: DEPT,
    title: 'Idoralararo voleybol turniri',
    description:
      "Vazirlik sport zalida boshqa boshqarmalar bilan do'stona voleybol uchrashuvi. Joylar cheklangan.",
    category: 'sports',
    illustrationKey: 'sports',
    startsAt: new Date('2026-09-13T18:00:00+05:00'),
    endsAt: new Date('2026-09-13T20:00:00+05:00'),
    place: 'Vazirlik sport zali',
    capacity: 1,
    waitlistEnabled: true,
    rsvpDeadline: new Date('2026-09-12T12:00:00+05:00'),
    reminderOffsetsMinutes: [1440, 60],
    organizerUserId: HEAD,
    status: 'full',
  },
  {
    id: CANCELLED_ID,
    departmentId: DEPT,
    title: 'Toshkentdagi IT-forumga tashrif',
    description: 'Raqamli texnologiyalar forumiga jamoaviy tashrif.',
    category: 'training',
    illustrationKey: 'training',
    startsAt: new Date('2026-09-10T10:00:00+05:00'),
    endsAt: new Date('2026-09-10T17:00:00+05:00'),
    place: 'Toshkent Kongress-markazi',
    reminderOffsetsMinutes: [1440, 60],
    organizerUserId: HEAD,
    status: 'cancelled',
    cancelledAt: new Date('2026-09-05T09:15:00+05:00'),
    cancelledReason: "Forum tashkilotchilari tomonidan boshqa sanaga ko'chirildi.",
  },
  {
    id: VOLUNTEERING_ID,
    departmentId: DEPT,
    title: "Ko'ngillilar kuni: bog' ekish",
    description: "Shahar bog'ida ko'chat ekish aksiyasi -- bo'lim jamoasi ishtirokida.",
    category: 'volunteering',
    illustrationKey: 'volunteering',
    startsAt: new Date('2026-08-22T08:00:00+05:00'),
    endsAt: new Date('2026-08-22T12:00:00+05:00'),
    place: "Yangi bog' hududi, Chilonzor",
    reminderOffsetsMinutes: [1440, 60],
    organizerUserId: HEAD,
    status: 'done',
  },
  {
    id: TRAINING_ID,
    departmentId: DEPT,
    title: "Excel bo'yicha amaliy trening",
    description:
      "Boshqaruv hisobotlari uchun Excel'da chuqurlashtirilgan trening, ichki tortishmalar bilan.",
    category: 'training',
    illustrationKey: 'training',
    startsAt: new Date('2026-09-27T10:00:00+05:00'),
    endsAt: new Date('2026-09-27T13:00:00+05:00'),
    place: "Bo'lim yig'ilishlar zali",
    capacity: 15,
    waitlistEnabled: true,
    rsvpDeadline: new Date('2026-09-26T18:00:00+05:00'),
    reminderOffsetsMinutes: [1440, 60],
    organizerUserId: HEAD,
    status: 'open',
  },
]

// Picnic: both colleagues RSVP yes, the head brings guests (family event). Volleyball: capacity is 1
// -- the head's RSVP fills it, the member's lands on the waitlist, demonstrating the exact mechanism
// `apps/api/src/modules/events/service.ts` enforces.
const RSVP_ROWS: (typeof schema.eventRsvps.$inferInsert)[] = [
  {
    id: demoId('rsvp.picnic.head'),
    departmentId: DEPT,
    eventId: PICNIC_ID,
    userId: HEAD,
    status: 'yes',
    guests: 2,
    note: "Xotinim va o'g'lim bilan boraman.",
  },
  {
    id: demoId('rsvp.picnic.member'),
    departmentId: DEPT,
    eventId: PICNIC_ID,
    userId: MEMBER,
    status: 'maybe',
    guests: 0,
  },
  {
    id: demoId('rsvp.volleyball.head'),
    departmentId: DEPT,
    eventId: VOLLEYBALL_ID,
    userId: HEAD,
    status: 'yes',
    guests: 0,
  },
  {
    id: demoId('rsvp.volleyball.member'),
    departmentId: DEPT,
    eventId: VOLLEYBALL_ID,
    userId: MEMBER,
    status: 'waitlist',
    guests: 0,
  },
  {
    id: demoId('rsvp.volunteering.head'),
    departmentId: DEPT,
    eventId: VOLUNTEERING_ID,
    userId: HEAD,
    status: 'yes',
    guests: 0,
  },
  {
    id: demoId('rsvp.volunteering.member'),
    departmentId: DEPT,
    eventId: VOLUNTEERING_ID,
    userId: MEMBER,
    status: 'yes',
    guests: 0,
  },
  {
    id: demoId('rsvp.training.member'),
    departmentId: DEPT,
    eventId: TRAINING_ID,
    userId: MEMBER,
    status: 'yes',
    guests: 0,
  },
]

// Carpool for the picnic: the head drives, offers seats; the member claims one.
const CARPOOL_ROWS: (typeof schema.carpools.$inferInsert)[] = [
  {
    id: demoId('carpool.picnic.head'),
    departmentId: DEPT,
    eventId: PICNIC_ID,
    driverUserId: HEAD,
    seats: 3,
    departurePlace: "Bo'lim binosi oldi",
    departureAt: new Date('2026-09-20T08:15:00+05:00'),
    note: "Yo'lda bitta to'xtash bo'ladi -- yoqilg'i quyish uchun.",
  },
]

const CARPOOL_SEAT_ROWS: (typeof schema.carpoolSeats.$inferInsert)[] = [
  {
    id: demoId('carpool-seat.picnic.member'),
    departmentId: DEPT,
    carpoolId: demoId('carpool.picnic.head'),
    userId: MEMBER,
    seatsClaimed: 1,
    status: 'confirmed',
  },
]

// Date poll for the picnic (kind: date), open, not anonymous -- the head is deciding between two
// Saturdays with the team.
const POLL_ROWS: (typeof schema.polls.$inferInsert)[] = [
  {
    id: demoId('poll.picnic-date'),
    departmentId: DEPT,
    eventId: PICNIC_ID,
    kind: 'date',
    question: 'Piknik uchun qaysi sana qulayroq?',
    anonymous: false,
    closesAt: new Date('2026-09-15T18:00:00+05:00'),
    createdByUserId: HEAD,
    status: 'open',
  },
]

const POLL_OPTION_ROWS: (typeof schema.pollOptions.$inferInsert)[] = [
  {
    id: demoId('poll-option.picnic-date.20'),
    departmentId: DEPT,
    pollId: demoId('poll.picnic-date'),
    label: '20-sentabr, shanba',
    optionDate: new Date('2026-09-20T09:00:00+05:00'),
    sortOrder: 0,
  },
  {
    id: demoId('poll-option.picnic-date.27'),
    departmentId: DEPT,
    pollId: demoId('poll.picnic-date'),
    label: '27-sentabr, yakshanba',
    optionDate: new Date('2026-09-27T09:00:00+05:00'),
    sortOrder: 1,
  },
]

const POLL_VOTE_ROWS: (typeof schema.pollVotes.$inferInsert)[] = [
  {
    id: demoId('poll-vote.picnic-date.head'),
    departmentId: DEPT,
    pollId: demoId('poll.picnic-date'),
    optionId: demoId('poll-option.picnic-date.20'),
    userId: HEAD,
  },
  {
    id: demoId('poll-vote.picnic-date.member'),
    departmentId: DEPT,
    pollId: demoId('poll.picnic-date'),
    optionId: demoId('poll-option.picnic-date.20'),
    userId: MEMBER,
  },
]

// "Who brings what" for the training (tea/coffee break) and a couple of comments.
const ITEM_ROWS: (typeof schema.eventItems.$inferInsert)[] = [
  {
    id: demoId('item.training.laptop'),
    departmentId: DEPT,
    eventId: TRAINING_ID,
    label: 'Noutbuk (proyektorga ulash uchun)',
    quantity: 1,
    claimedByUserId: HEAD,
    claimedAt: new Date('2026-09-07T09:00:00+05:00'),
  },
  {
    id: demoId('item.training.snacks'),
    departmentId: DEPT,
    eventId: TRAINING_ID,
    label: 'Choy-poy va pechene',
    quantity: 2,
  },
]

const COMMENT_ROWS: (typeof schema.eventComments.$inferInsert)[] = [
  {
    id: demoId('comment.training.member-1'),
    departmentId: DEPT,
    eventId: TRAINING_ID,
    authorUserId: MEMBER,
    body: "Pivot jadvallar bo'yicha ham bir soat ajratsak bo'ladimi?",
  },
  {
    id: demoId('comment.training.head-1'),
    departmentId: DEPT,
    eventId: TRAINING_ID,
    authorUserId: HEAD,
    body: "Albatta, dasturga qo'shib qo'yaman.",
  },
]

// Done event: two photos and feedback from both attendees (one anonymous).
const PHOTO_ROWS: (typeof schema.eventPhotos.$inferInsert)[] = [
  {
    id: demoId('photo.volunteering.1'),
    departmentId: DEPT,
    eventId: VOLUNTEERING_ID,
    url: 'https://images.example.com/devon/volunteering-1.jpg',
    caption: "Ko'chat ekish jarayoni",
    addedByUserId: HEAD,
  },
  {
    id: demoId('photo.volunteering.2'),
    departmentId: DEPT,
    eventId: VOLUNTEERING_ID,
    url: 'https://images.example.com/devon/volunteering-2.jpg',
    caption: 'Jamoa surati, ish yakunida',
    addedByUserId: MEMBER,
  },
]

const FEEDBACK_ROWS: (typeof schema.eventFeedback.$inferInsert)[] = [
  {
    id: demoId('feedback.volunteering.head'),
    departmentId: DEPT,
    eventId: VOLUNTEERING_ID,
    userId: HEAD,
    rating: 5,
    comment: 'Ajoyib tashkil etildi, kuchimiz yetganda yana qatnashamiz.',
    anonymous: false,
  },
  {
    id: demoId('feedback.volunteering.member'),
    departmentId: DEPT,
    eventId: VOLUNTEERING_ID,
    userId: MEMBER,
    rating: 4,
    comment: 'Yaxshi, lekin ertalabki vaqt biroz erta edi.',
    anonymous: true,
  },
]

const idsOf = (rows: ReadonlyArray<{ id?: string | undefined }>): string[] => rows.map((r) => r.id!)

export async function seed(ctx: SeedModuleContext): Promise<number> {
  const { tx } = ctx
  let written = 0

  const insertedEvents = await tx.drizzle
    .insert(schema.events)
    .values(EVENT_ROWS)
    .onConflictDoNothing()
    .returning({ id: schema.events.id })
  written += insertedEvents.length

  const insertedRsvps = await tx.drizzle
    .insert(schema.eventRsvps)
    .values(RSVP_ROWS)
    .onConflictDoNothing()
    .returning({ id: schema.eventRsvps.id })
  written += insertedRsvps.length

  const insertedCarpools = await tx.drizzle
    .insert(schema.carpools)
    .values(CARPOOL_ROWS)
    .onConflictDoNothing()
    .returning({ id: schema.carpools.id })
  written += insertedCarpools.length

  const insertedCarpoolSeats = await tx.drizzle
    .insert(schema.carpoolSeats)
    .values(CARPOOL_SEAT_ROWS)
    .onConflictDoNothing()
    .returning({ id: schema.carpoolSeats.id })
  written += insertedCarpoolSeats.length

  const insertedPolls = await tx.drizzle
    .insert(schema.polls)
    .values(POLL_ROWS)
    .onConflictDoNothing()
    .returning({ id: schema.polls.id })
  written += insertedPolls.length

  const insertedPollOptions = await tx.drizzle
    .insert(schema.pollOptions)
    .values(POLL_OPTION_ROWS)
    .onConflictDoNothing()
    .returning({ id: schema.pollOptions.id })
  written += insertedPollOptions.length

  const insertedPollVotes = await tx.drizzle
    .insert(schema.pollVotes)
    .values(POLL_VOTE_ROWS)
    .onConflictDoNothing()
    .returning({ id: schema.pollVotes.id })
  written += insertedPollVotes.length

  const insertedItems = await tx.drizzle
    .insert(schema.eventItems)
    .values(ITEM_ROWS)
    .onConflictDoNothing()
    .returning({ id: schema.eventItems.id })
  written += insertedItems.length

  const insertedComments = await tx.drizzle
    .insert(schema.eventComments)
    .values(COMMENT_ROWS)
    .onConflictDoNothing()
    .returning({ id: schema.eventComments.id })
  written += insertedComments.length

  const insertedPhotos = await tx.drizzle
    .insert(schema.eventPhotos)
    .values(PHOTO_ROWS)
    .onConflictDoNothing()
    .returning({ id: schema.eventPhotos.id })
  written += insertedPhotos.length

  const insertedFeedback = await tx.drizzle
    .insert(schema.eventFeedback)
    .values(FEEDBACK_ROWS)
    .onConflictDoNothing()
    .returning({ id: schema.eventFeedback.id })
  written += insertedFeedback.length

  return written
}

/** Reverse of `seed()`: every child table (feedback, photos, comments, items, votes → options → polls,
 * seats → carpools, RSVPs), then the events themselves. */
export async function reset(ctx: SeedModuleContext): Promise<number> {
  const { tx } = ctx
  let deleted = 0

  const deletedFeedback = await tx.drizzle
    .delete(schema.eventFeedback)
    .where(inArray(schema.eventFeedback.id, idsOf(FEEDBACK_ROWS)))
    .returning({ id: schema.eventFeedback.id })
  deleted += deletedFeedback.length

  const deletedPhotos = await tx.drizzle
    .delete(schema.eventPhotos)
    .where(inArray(schema.eventPhotos.id, idsOf(PHOTO_ROWS)))
    .returning({ id: schema.eventPhotos.id })
  deleted += deletedPhotos.length

  const deletedComments = await tx.drizzle
    .delete(schema.eventComments)
    .where(inArray(schema.eventComments.id, idsOf(COMMENT_ROWS)))
    .returning({ id: schema.eventComments.id })
  deleted += deletedComments.length

  const deletedItems = await tx.drizzle
    .delete(schema.eventItems)
    .where(inArray(schema.eventItems.id, idsOf(ITEM_ROWS)))
    .returning({ id: schema.eventItems.id })
  deleted += deletedItems.length

  const deletedPollVotes = await tx.drizzle
    .delete(schema.pollVotes)
    .where(inArray(schema.pollVotes.id, idsOf(POLL_VOTE_ROWS)))
    .returning({ id: schema.pollVotes.id })
  deleted += deletedPollVotes.length

  const deletedPollOptions = await tx.drizzle
    .delete(schema.pollOptions)
    .where(inArray(schema.pollOptions.id, idsOf(POLL_OPTION_ROWS)))
    .returning({ id: schema.pollOptions.id })
  deleted += deletedPollOptions.length

  const deletedPolls = await tx.drizzle
    .delete(schema.polls)
    .where(inArray(schema.polls.id, idsOf(POLL_ROWS)))
    .returning({ id: schema.polls.id })
  deleted += deletedPolls.length

  const deletedCarpoolSeats = await tx.drizzle
    .delete(schema.carpoolSeats)
    .where(inArray(schema.carpoolSeats.id, idsOf(CARPOOL_SEAT_ROWS)))
    .returning({ id: schema.carpoolSeats.id })
  deleted += deletedCarpoolSeats.length

  const deletedCarpools = await tx.drizzle
    .delete(schema.carpools)
    .where(inArray(schema.carpools.id, idsOf(CARPOOL_ROWS)))
    .returning({ id: schema.carpools.id })
  deleted += deletedCarpools.length

  const deletedRsvps = await tx.drizzle
    .delete(schema.eventRsvps)
    .where(inArray(schema.eventRsvps.id, idsOf(RSVP_ROWS)))
    .returning({ id: schema.eventRsvps.id })
  deleted += deletedRsvps.length

  // Reminder jobs are scheduled by the reminder worker (`apps/api/.../events/reminder-worker.ts`), not
  // by this module, but they hold `event_reminder_jobs.event_id -> events.id`; a demo whose reminder
  // worker has run since the seed would otherwise fail `event_reminder_jobs_event_id_fkey` on the
  // events delete below (the same runtime-artifact-with-an-FK shape `demo.ts` handles for sessions).
  // The table is global (no RLS), reachable under the shared context. Not counted in `deleted` -- it is
  // not a seeded row, exactly as `demo.ts` does not count the sessions it sweeps.
  await tx.drizzle
    .delete(schema.eventReminderJobs)
    .where(inArray(schema.eventReminderJobs.eventId, idsOf(EVENT_ROWS)))

  const deletedEvents = await tx.drizzle
    .delete(schema.events)
    .where(inArray(schema.events.id, idsOf(EVENT_ROWS)))
    .returning({ id: schema.events.id })
  deleted += deletedEvents.length

  return deleted
}
