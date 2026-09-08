-- H3.4: indexes justified by the access patterns actually queried against (see api-data.md's EXPLAIN
-- ANALYZE evidence, run against a 200k-row synthetic `app.cards` table with 50 assignees / ~4000 cards
-- each -- a busy, multi-year department, not the small demo tenant).
--
-- 1. `cards_department_assignee_status_due_idx` on (department_id, assignee_user_id, status, due_at):
--    "my active cards due soon" (`GET /cards` filtered `assignee:@me status:active due:<=...`,
--    `analytics/repo.ts`'s per-member overdue counts, `analytics/filter.ts`'s `cardsFilterSql`) is the
--    single most common shape this table is queried by outside the whole-board load. Before this
--    index, that query -- ORDER BY due_at LIMIT N -- had the planner choosing the existing
--    `cards_due_at_idx` (due_at only) over `cards_department_assignee_idx` specifically *because* it
--    is pre-sorted by due_at and a small LIMIT looked cheaper than an index scan + explicit sort; the
--    trade-off was scanning cards for *every* assignee in the department (not just this one) until
--    enough matched, discarding most of them (see `Rows Removed by Filter` in the BEFORE plan below).
--    The new composite index is sorted by due_at *within* a single (department, assignee, status)
--    group, so the same query becomes a direct, already-ordered index scan with no rows discarded.
--
--    `cards_department_assignee_idx` (department_id, assignee_user_id) becomes redundant once this
--    index exists -- any query that can use the 2-column index can use this one's leading two columns
--    equally well -- so it is dropped here (H3.4 "no redundant indexes"). The 2-column
--    `cards_department_status_idx` and the standalone `cards_due_at_idx` are kept: real query shapes
--    filter by (department_id, status) with *no* assignee predicate (a department-wide "all active
--    cards" board/analytics view) or by due_at alone across every department (the hourly reminder
--    scan, `events/reminder-worker.ts`'s sibling in spirit) -- neither is a prefix of the new 4-column
--    index, so neither can be served by it.
--
-- 2. `cards_title_trgm_idx`, a `pg_trgm` GIN index on `app.normalize_uz(title)`: the filter grammar's
--    free-text term matching (`analytics/filter.ts`'s `f.textTerms` -> `title ilike '%term%'`, used by
--    the board/table screens' search box and by `analytics/repo.ts`'s filtered aggregates) is a
--    leading-wildcard ILIKE that a B-tree index cannot serve at all -- every such search was a full
--    table scan of `app.cards` before this index. Folded through the same `app.normalize_uz()` used by
--    `users_name_trgm_idx` (0006_normalize_uz.sql) so a search also matches across the Latin/Cyrillic
--    and modifier-letter variants of the same title (H14.1), not only a byte-for-byte substring.
--
-- Expand-only (I-15): adds two indexes, drops one now-redundant one. Safe to run against a table with
-- existing data (`create index if not exists` / `drop index if exists`, no data rewritten).
set role devon_migrator;

create index if not exists cards_department_assignee_status_due_idx
  on app.cards (department_id, assignee_user_id, status, due_at)
  where deleted_at is null;

drop index if exists cards_department_assignee_idx;

create index if not exists cards_title_trgm_idx
  on app.cards using gin (app.normalize_uz(title) gin_trgm_ops)
  where deleted_at is null;

reset role;
