// Demo seed for the AI module (MODULE-GUIDE.md "Seeds", TECH-SPEC §8/§14). `order: 800` -- runs after
// `core.ts` (0), the only module this one's fixtures point at (`DEMO_DEPARTMENT`, `DEMO_USERS`).
// Deterministic ids (`demoId`) and `ON CONFLICT DO NOTHING` throughout, so a second `seed:demo` run
// writes zero rows here too.
//
// Traces carry token/cost/latency metadata only -- never prompt/response text (same guard rail
// `packages/db/src/schema/ai.ts`'s header explains) -- so this seed can be entirely believable numbers
// without needing to fabricate any actual AI-generated content.
import { eq } from 'drizzle-orm'
import * as schema from '../../schema/ai.js'
import { DEMO_DEPARTMENT, DEMO_USERS } from '../fixtures.js'
import { demoId } from '../ids.js'
import type { SeedModuleContext } from '../module-loader.js'

export const order = 800

const HEAD = DEMO_USERS.find((u) => u.role === 'head')!
const MEMBER = DEMO_USERS.find((u) => u.role === 'member')!

const D = (iso: string): Date => new Date(iso)

// Every feature ships behind a flag, defaulting to off (TECH-SPEC §8) -- the demo turns every one of
// them on so the whole product is exercisable out of the box, which is the whole point of `--demo`.
// The ten keys mirror `@devon/ai`'s `AiFeature` union (kept as plain string literals here rather than
// importing that package's type: `packages/db` has no runtime or type dependency on `packages/ai`
// today, and a demo-seed flags object is not worth introducing one for).
const DEMO_FLAGS: Record<string, boolean> = {
  quick_add_parse: true,
  subtask_breakdown: true,
  plan_sprint: true,
  deadline_risk: true,
  weekly_summary: true,
  draft_event: true,
  summarize_thread: true,
  nl_analytics: true,
  translate: true,
  what_did_i_miss: true,
}

type DemoTrace = {
  name: string
  userId: string
  feature: string
  model: string
  promptTokens: number
  completionTokens: number
  latencyMs: number
  retried: boolean
  status: (typeof schema.aiTraceStatusEnum.enumValues)[number]
  createdAt: Date
}

// A believable month of usage: mostly quick, successful calls, a couple of retried/failed ones so the
// usage table's status column and the "retried" badge are both exercisable in the demo, not just a
// column of identical green rows.
const PRICE_PER_MILLION_UZS = 19_500
function costUzs(promptTokens: number, completionTokens: number): number {
  return Math.round(((promptTokens + completionTokens) / 1_000_000) * PRICE_PER_MILLION_UZS)
}

const TRACES: readonly DemoTrace[] = [
  {
    name: 'trace.1',
    userId: HEAD.id,
    feature: 'weekly_summary',
    model: 'glm-5.2',
    promptTokens: 1840,
    completionTokens: 320,
    latencyMs: 2100,
    retried: false,
    status: 'ok',
    createdAt: D('2026-09-01T07:05:00Z'),
  },
  {
    name: 'trace.2',
    userId: MEMBER.id,
    feature: 'quick_add_parse',
    model: 'glm-5.2',
    promptTokens: 260,
    completionTokens: 90,
    latencyMs: 640,
    retried: false,
    status: 'ok',
    createdAt: D('2026-09-01T08:12:00Z'),
  },
  {
    name: 'trace.3',
    userId: MEMBER.id,
    feature: 'subtask_breakdown',
    model: 'glm-5.2',
    promptTokens: 410,
    completionTokens: 260,
    latencyMs: 1450,
    retried: false,
    status: 'ok',
    createdAt: D('2026-09-02T09:30:00Z'),
  },
  {
    name: 'trace.4',
    userId: MEMBER.id,
    feature: 'plan_sprint',
    model: 'glm-5.2',
    promptTokens: 520,
    completionTokens: 210,
    latencyMs: 1800,
    retried: true,
    status: 'ok',
    createdAt: D('2026-09-02T09:31:20Z'),
  },
  {
    name: 'trace.5',
    userId: HEAD.id,
    feature: 'deadline_risk',
    model: 'glm-5.2',
    promptTokens: 300,
    completionTokens: 140,
    latencyMs: 900,
    retried: false,
    status: 'ok',
    createdAt: D('2026-09-03T06:50:00Z'),
  },
  {
    name: 'trace.6',
    userId: HEAD.id,
    feature: 'draft_event',
    model: 'glm-5.2',
    promptTokens: 180,
    completionTokens: 480,
    latencyMs: 2400,
    retried: false,
    status: 'ok',
    createdAt: D('2026-09-03T11:15:00Z'),
  },
  {
    name: 'trace.7',
    userId: MEMBER.id,
    feature: 'summarize_thread',
    model: 'glm-5.2',
    promptTokens: 2200,
    completionTokens: 260,
    latencyMs: 2600,
    retried: false,
    status: 'ok',
    createdAt: D('2026-09-04T14:05:00Z'),
  },
  {
    name: 'trace.8',
    userId: MEMBER.id,
    feature: 'nl_analytics',
    model: 'glm-5.2',
    promptTokens: 150,
    completionTokens: 80,
    latencyMs: 520,
    retried: false,
    status: 'ok',
    createdAt: D('2026-09-05T10:00:00Z'),
  },
  {
    name: 'trace.9',
    userId: HEAD.id,
    feature: 'translate',
    model: 'glm-5.2',
    promptTokens: 220,
    completionTokens: 240,
    latencyMs: 700,
    retried: false,
    status: 'ok',
    createdAt: D('2026-09-05T15:40:00Z'),
  },
  {
    name: 'trace.10',
    userId: MEMBER.id,
    feature: 'what_did_i_miss',
    model: 'glm-5.2',
    promptTokens: 640,
    completionTokens: 220,
    latencyMs: 1300,
    retried: false,
    status: 'ok',
    createdAt: D('2026-09-08T08:00:00Z'),
  },
  {
    name: 'trace.11',
    userId: MEMBER.id,
    feature: 'quick_add_parse',
    model: 'glm-5.2',
    promptTokens: 1024,
    completionTokens: 0,
    latencyMs: 4100,
    retried: true,
    status: 'empty_after_retry',
    createdAt: D('2026-09-08T08:03:00Z'),
  },
  {
    name: 'trace.12',
    userId: HEAD.id,
    feature: 'weekly_summary',
    model: 'glm-5.2',
    promptTokens: 1900,
    completionTokens: 340,
    latencyMs: 2300,
    retried: false,
    status: 'ok',
    createdAt: D('2026-09-08T07:00:00Z'),
  },
]

export async function seed(ctx: SeedModuleContext): Promise<number> {
  const { tx } = ctx
  let inserted = 0

  const insertedSettings = await tx.drizzle
    .insert(schema.aiDepartmentSettings)
    .values({
      departmentId: DEMO_DEPARTMENT.id,
      budgetUzsPerMonth: 2_000_000,
      softCapPct: 80,
      flags: DEMO_FLAGS,
    })
    .onConflictDoNothing()
    .returning({ departmentId: schema.aiDepartmentSettings.departmentId })
  inserted += insertedSettings.length

  const insertedTraces = await tx.drizzle
    .insert(schema.aiTraces)
    .values(
      TRACES.map((trace) => ({
        id: demoId(`ai.${trace.name}`),
        departmentId: DEMO_DEPARTMENT.id,
        userId: trace.userId,
        feature: trace.feature,
        model: trace.model,
        promptTokens: trace.promptTokens,
        completionTokens: trace.completionTokens,
        totalTokens: trace.promptTokens + trace.completionTokens,
        costUzs: costUzs(trace.promptTokens, trace.completionTokens),
        latencyMs: trace.latencyMs,
        retried: trace.retried,
        status: trace.status,
        createdAt: trace.createdAt,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: schema.aiTraces.id })
  inserted += insertedTraces.length

  return inserted
}

/**
 * Blitz integration fix: this module shipped `seed()` but no `reset()` -- `seed:reset --demo` only
 * calls a module's `reset()` when one exists, so `app.ai_department_settings`/`app.ai_traces` rows for
 * the demo department were never cleaned up. Harmless on its own (neither table is referenced by
 * anything else, so it never blocked `demo.ts`'s own department delete the way the missing
 * `analytics.ts`/`pages.ts` resets did, both reproduced end to end against a fresh Testcontainers
 * Postgres via `test:seed-idempotence`), but a repeat `seed:demo` after a `seed:reset --demo` would
 * otherwise still find last time's settings/traces sitting there -- both `on conflict do nothing`, so
 * harmless to insert *over*, but never actually reset to the seed's own defaults (e.g. a demo where
 * someone had changed the AI budget through the UI would keep that changed value forever, defeating
 * the point of resetting the tenant between demos).
 *
 * `ai_department_settings_write` additionally requires `current_actor_role() IN ('head',
 * 'super_admin')` -- already satisfied, `demoContext()`'s actor role is `super_admin` for the whole
 * seed transaction (`scope.ts`). Neither table has an owner column, so no `app.user_id` GUC dance is
 * needed (unlike `analytics.ts`'s saved filters/pins).
 */
export async function reset(ctx: SeedModuleContext): Promise<number> {
  const { tx } = ctx
  let deleted = 0

  const deletedTraces = await tx.drizzle
    .delete(schema.aiTraces)
    .where(eq(schema.aiTraces.departmentId, DEMO_DEPARTMENT.id))
    .returning({ id: schema.aiTraces.id })
  deleted += deletedTraces.length

  const deletedSettings = await tx.drizzle
    .delete(schema.aiDepartmentSettings)
    .where(eq(schema.aiDepartmentSettings.departmentId, DEMO_DEPARTMENT.id))
    .returning({ departmentId: schema.aiDepartmentSettings.departmentId })
  deleted += deletedSettings.length

  return deleted
}
