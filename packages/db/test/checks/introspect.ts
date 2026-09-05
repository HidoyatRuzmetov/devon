// Postgres catalog introspection shared by the tenancy/RLS/audit checks. Kept separate from the
// checks themselves so each check reads as "what must be true", not "how to ask Postgres".
import type { Client, ClientBase } from 'pg'

export async function listBaseTables(client: ClientBase, schemas: string[]): Promise<string[]> {
  const { rows } = await client.query<{ n: string }>(
    `select table_schema || '.' || table_name as n
     from information_schema.tables
     where table_schema = any($1) and table_type = 'BASE TABLE'`,
    [schemas],
  )
  return rows.map((r) => r.n)
}

export async function rlsState(
  client: ClientBase,
  schema: string,
  table: string,
): Promise<{ enabled: boolean; forced: boolean }> {
  const { rows } = await client.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
    `select c.relrowsecurity, c.relforcerowsecurity
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = $1 and c.relname = $2`,
    [schema, table],
  )
  const row = rows[0]
  return { enabled: !!row?.relrowsecurity, forced: !!row?.relforcerowsecurity }
}

export async function tableOwner(
  client: ClientBase,
  schema: string,
  table: string,
): Promise<string | null> {
  const { rows } = await client.query<{ rolname: string }>(
    `select r.rolname
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     join pg_roles r on r.oid = c.relowner
     where n.nspname = $1 and c.relname = $2`,
    [schema, table],
  )
  return rows[0]?.rolname ?? null
}

export type PolicyRow = {
  policyname: string
  cmd: string
  qual: string | null
  withCheck: string | null
}

export async function policies(
  client: ClientBase,
  schema: string,
  table: string,
): Promise<PolicyRow[]> {
  const { rows } = await client.query<{
    policyname: string
    cmd: string
    qual: string | null
    with_check: string | null
  }>(
    `select policyname, cmd, qual, with_check
     from pg_policies where schemaname = $1 and tablename = $2`,
    [schema, table],
  )
  return rows.map((r) => ({
    policyname: r.policyname,
    cmd: r.cmd,
    qual: r.qual,
    withCheck: r.with_check,
  }))
}

export async function leadingIndexColumn(
  client: ClientBase,
  schema: string,
  table: string,
  column: string,
): Promise<boolean> {
  const { rows } = await client.query<{ attname: string }>(
    `select a.attname
     from pg_index i
     join pg_class t on t.oid = i.indrelid
     join pg_namespace n on n.oid = t.relnamespace
     join pg_attribute a on a.attrelid = t.oid and a.attnum = i.indkey[0]
     where n.nspname = $1 and t.relname = $2`,
    [schema, table],
  )
  return rows.some((r) => r.attname === column)
}

export async function columnExists(
  client: ClientBase,
  schema: string,
  table: string,
  column: string,
): Promise<boolean> {
  const { rows } = await client.query(
    `select 1 from information_schema.columns where table_schema = $1 and table_name = $2 and column_name = $3`,
    [schema, table, column],
  )
  return rows.length > 0
}

export async function foreignKeyExists(
  client: ClientBase,
  schema: string,
  table: string,
  column: string,
  refSchema: string,
  refTable: string,
): Promise<boolean> {
  const { rows } = await client.query(
    `select 1
     from information_schema.table_constraints tc
     join information_schema.key_column_usage kcu
       on tc.constraint_name = kcu.constraint_name and tc.table_schema = kcu.table_schema
     join information_schema.constraint_column_usage ccu
       on tc.constraint_name = ccu.constraint_name and tc.table_schema = ccu.table_schema
     where tc.constraint_type = 'FOREIGN KEY'
       and tc.table_schema = $1 and tc.table_name = $2 and kcu.column_name = $3
       and ccu.table_schema = $4 and ccu.table_name = $5`,
    [schema, table, column, refSchema, refTable],
  )
  return rows.length > 0
}

export async function grantsFor(
  client: ClientBase,
  schema: string,
  table: string,
  grantee: string,
): Promise<string[]> {
  const { rows } = await client.query<{ privilege_type: string }>(
    `select privilege_type from information_schema.role_table_grants
     where table_schema = $1 and table_name = $2 and grantee = $3`,
    [schema, table, grantee],
  )
  return rows.map((r) => r.privilege_type)
}

export async function triggerExists(
  client: ClientBase,
  schema: string,
  table: string,
  triggerName: string,
): Promise<boolean> {
  const { rows } = await client.query(
    `select 1
     from pg_trigger tg
     join pg_class c on c.oid = tg.tgrelid
     join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = $1 and c.relname = $2 and tg.tgname = $3 and not tg.tgisinternal`,
    [schema, table, triggerName],
  )
  return rows.length > 0
}

export type { Client }
