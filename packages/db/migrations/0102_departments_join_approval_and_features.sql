-- v1.1 SPEC §2.2 (joining) and §7 (Imkoniyatlar). Expand-only (I-15): one changed DEFAULT and one
-- added column. Nothing existing is dropped, rewritten or back-filled with a different meaning.
--
-- 1. `join_requires_approval` now defaults to TRUE for departments created from here on.
--    `0100_accounts_departments.sql` shipped it `false`, which means anyone holding the invite link
--    and the department password becomes a full member of a ministry department with no head in the
--    loop (WALKTHROUGH-FINDINGS §1.3). The safe default was unusable until v1.1 because nothing
--    could approve a pending membership; `apps/api/src/modules/departments/index.ts` now has the
--    queue (list / approve / reject / undo), so the default can finally be the safe one.
--
--    A DEFAULT applies to future INSERTs only, which is exactly the intent: every department that
--    already exists keeps the setting its head chose (or inherited), and the demo department stays
--    open so a demo join is still one step (`packages/db/src/seed/modules/core.ts` sets it
--    explicitly rather than relying on any default, in either direction).
--
-- 2. `features` is the department's Imkoniyatlar switch set (SPEC §7): one jsonb object of
--    `<featureKey>: boolean`, head-only to write, readable by every member. A column on
--    `app.departments` rather than a new `department_settings` table because the department's
--    settings already live here as jsonb (`app.departments.settings`) and a second table would add a
--    join, a second RLS policy and a second tenancy-registry entry for one object that is always read
--    with the department itself. `'{}'` means "every switch at its default", and the defaults live in
--    one place in code (`packages/contracts/src/features.ts`) so a new switch does not need a
--    migration to become available.
set role devon_migrator;

alter table app.departments alter column join_requires_approval set default true;

alter table app.departments add column if not exists features jsonb not null default '{}'::jsonb;

reset role;
