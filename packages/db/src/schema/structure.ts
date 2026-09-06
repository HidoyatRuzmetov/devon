// Drizzle table definitions mirroring `migrations/0200_structure.sql` (MODULE-GUIDE.md "DB: schema").
// Kept in structural parity with the SQL by hand, exactly like `schema/app.ts` documents for the
// foundation tables -- this file is never the source of migrations. Not re-exported from
// `schema/index.ts` (MODULE-GUIDE.md: "you do not add an export * line"); this module's own seed file
// (`seed/modules/structure.ts`, which lives inside this same package) imports it directly. The API
// side (`apps/api/src/modules/structure/repo.ts`, a different package, cannot reach this file at all
// -- `@devon/db`'s `package.json` "exports" map only publishes `src/index.ts` -- so it queries these
// same tables through `Tx.raw()` hand-written SQL instead; both paths describe the identical columns.
import { integer, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { appSchema } from './app.js'

export const unitRoleEnum = appSchema.enum('unit_role', ['head', 'deputy', 'member'])
export type UnitRoleEnum = (typeof unitRoleEnum.enumValues)[number]

export const units = appSchema.table('units', {
  id: uuid('id').primaryKey().defaultRandom(),
  departmentId: uuid('department_id').notNull(),
  parentUnitId: uuid('parent_unit_id'),
  name: text('name').notNull(),
  /** One of `@devon/ui`'s 8 categorical unit hues, or `null` for "auto" (see the migration). */
  colour: smallint('colour'),
  sort: integer('sort').notNull().default(0),
  path: text('path').notNull().default(''),
  createdBy: uuid('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  version: integer('version').notNull().default(1),
})

export const unitRoles = appSchema.table('unit_roles', {
  id: uuid('id').primaryKey().defaultRandom(),
  departmentId: uuid('department_id').notNull(),
  unitId: uuid('unit_id').notNull(),
  userId: uuid('user_id').notNull(),
  role: unitRoleEnum('role').notNull().default('member'),
  assignedBy: uuid('assigned_by').notNull(),
  assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  version: integer('version').notNull().default(1),
})
