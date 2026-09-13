// The demo dataset's "today", in one place.
//
// Every seed module builds believable dates around a fixed instant rather than the wall clock, and it
// has to be the *same* instant in all of them: `work.ts` dates a card, `analytics.ts` rebuilds twelve
// weeks of history from exactly those cards, `work-plus.ts` puts a goal window around them and
// `fields.ts` timestamps a fill request inside it. A module that anchored a day off would produce a
// chart whose last column is empty and a goal that has not started yet.
//
// It is fixed rather than `new Date()` because the whole seed is meant to be reproducible: two runs on
// two machines have to write byte-identical rows for `ON CONFLICT DO NOTHING` to recognise a repeat
// run as a repeat. (Row *ids* are name-derived and never depend on this -- see `ids.ts` -- but
// `app.analytics_daily` keys a row per calendar day, and a demo whose numbers move because somebody
// re-seeded on a Tuesday is a demo nobody can rehearse against.)
//
// **This is the one line to change before a demo.** The dataset tells the story of the week ending on
// this date, so the further real "today" drifts past it, the more the time-windowed tiles read as
// zero: "oʻtgan hafta bajarilgan kartochkalar 0, -100%" on the analytics page is not a bug, it is the
// dataset's week having ended a month ago. If you are presenting more than a week or two after the
// date below, move it to the coming Sunday and re-seed:
//
//     packages/db/src/seed/clock.ts   <- change DEMO_NOW
//     pnpm --filter @devon/db seed:reset --demo && pnpm --filter @devon/db seed:demo
//
// (docs/DEMO-SCRIPT.md repeats this as the first item of its pre-demo checklist.)
export const DEMO_NOW = new Date('2026-09-13T09:00:00.000Z')

const DAY_MS = 24 * 60 * 60 * 1000

/** `DEMO_NOW` shifted by whole days: negative is the past, positive the future. */
export function demoDaysFromNow(days: number): Date {
  return new Date(DEMO_NOW.getTime() + days * DAY_MS)
}

/** The same shift as a plain `YYYY-MM-DD`, for the `date` columns (goal windows, project dates). */
export function demoIsoDate(days: number): string {
  return demoDaysFromNow(days).toISOString().slice(0, 10)
}

/** Whole days between `DEMO_NOW` and `when` -- negative when `when` is in the past. */
export function demoDaysBetween(when: Date): number {
  return Math.round((when.getTime() - DEMO_NOW.getTime()) / DAY_MS)
}
