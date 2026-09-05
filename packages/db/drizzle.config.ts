import { defineConfig } from 'drizzle-kit'

// This config exists for ad-hoc introspection/studio use (`drizzle-kit studio`, `drizzle-kit check`).
// It is NOT part of `migrate:verify`: migrations in `migrations/*.sql` are hand-authored (they carry
// custom functions, triggers and RLS policies that schema-diffing cannot produce), applied by the
// harness in `test/harness.ts`. `src/schema/**` is kept in structural parity with the SQL by the
// `schema-parity` assertion inside `test/tenancy.registry.test.ts`, not by `drizzle-kit generate`.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  dbCredentials: {
    url:
      process.env['MIGRATION_DATABASE_URL'] ??
      process.env['DATABASE_URL'] ??
      'postgres://localhost:5432/devon',
  },
  schemaFilter: ['app', 'audit'],
  verbose: true,
  strict: false,
})
