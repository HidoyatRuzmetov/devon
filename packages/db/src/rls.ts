// RLS mechanism helpers (ADR-002, design §2.1/§2.4). Two things live here:
//
// 1. The GUC accessor names that `context.ts` writes and every RLS policy reads
//    (`app.current_department_id()`, `app.current_user_id()`, `app.current_actor_role()`,
//    `app.is_view_as()` -- created in `migrations/0005_rls.sql`). Exported as constants so nothing
//    ever hand-types the string twice and gets it wrong.
// 2. `departmentTable()` / `userTable()`: a DDL generator plus a matching Drizzle table factory for a
//    *new* department-owned or user-owned table. `test/tenancy.registry.test.ts` uses these to create
//    two throwaway tables inside its own test schema and prove the isolation mechanism generically --
//    the two tables that exist today (`app.departments`, `app.memberships`) are not the only proof.
//    A later epic's feature work should reach for the same pattern rather than hand-rolling a new one.
import { pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core'

export const CURRENT_DEPARTMENT_ID_FN = 'app.current_department_id()'
export const CURRENT_USER_ID_FN = 'app.current_user_id()'
export const CURRENT_ACTOR_ROLE_FN = 'app.current_actor_role()'
export const IS_VIEW_AS_FN = 'app.is_view_as()'

function assertIdentifier(name: string): void {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) {
    throw new Error(`rls: "${name}" is not a safe, lower-case SQL identifier`)
  }
}

/**
 * DDL for a new `department_owned` table: `department_id` FK, RLS enabled + forced, a policy scoping
 * every row to `app.current_department_id()`, and a leading `department_id` index -- the same shape
 * `test/tenancy.registry.test.ts` requires of every real `department_owned` table.
 */
export function departmentTableDDL(schemaName: string, name: string): string[] {
  assertIdentifier(schemaName)
  assertIdentifier(name)
  const qualified = `${schemaName}.${name}`
  return [
    `create table if not exists ${qualified} (
       id uuid primary key default gen_random_uuid(),
       department_id uuid not null references app.departments(id),
       label text not null,
       created_at timestamptz not null default now()
     )`,
    `create index if not exists ${name}_department_id_idx on ${qualified} (department_id)`,
    `alter table ${qualified} enable row level security`,
    `alter table ${qualified} force row level security`,
    `drop policy if exists ${name}_scope on ${qualified}`,
    `create policy ${name}_scope on ${qualified} for all
       using (department_id = ${CURRENT_DEPARTMENT_ID_FN} and not ${IS_VIEW_AS_FN})
       with check (department_id = ${CURRENT_DEPARTMENT_ID_FN} and not ${IS_VIEW_AS_FN})`,
  ]
}

/**
 * DDL for a new `user_owned` table: `user_id`, RLS enabled + forced, and a policy scoping every row to
 * `app.current_user_id()` only -- deliberately no branch anywhere that mentions `current_actor_role()`,
 * because I-1 gives the head and the super admin no exception for personal data.
 */
export function userTableDDL(schemaName: string, name: string): string[] {
  assertIdentifier(schemaName)
  assertIdentifier(name)
  const qualified = `${schemaName}.${name}`
  return [
    `create table if not exists ${qualified} (
       id uuid primary key default gen_random_uuid(),
       user_id uuid not null,
       label text not null,
       created_at timestamptz not null default now()
     )`,
    `alter table ${qualified} enable row level security`,
    `alter table ${qualified} force row level security`,
    `drop policy if exists ${name}_scope on ${qualified}`,
    `create policy ${name}_scope on ${qualified} for all
       using (user_id = ${CURRENT_USER_ID_FN})
       with check (user_id = ${CURRENT_USER_ID_FN})`,
  ]
}

export function departmentTable(schemaName: string, name: string) {
  const s = pgSchema(schemaName)
  return s.table(name, {
    id: uuid('id').primaryKey().defaultRandom(),
    departmentId: uuid('department_id').notNull(),
    label: text('label').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  })
}

export function userTable(schemaName: string, name: string) {
  const s = pgSchema(schemaName)
  return s.table(name, {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull(),
    label: text('label').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  })
}

/** DDL to drop a throwaway table and its policy cleanly (test teardown). */
export function dropTableDDL(schemaName: string, name: string): string {
  assertIdentifier(schemaName)
  assertIdentifier(name)
  return `drop table if exists ${schemaName}.${name} cascade`
}
