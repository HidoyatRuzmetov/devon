-- Expand-only (I-15). Idempotent: `create or replace function`; collation creation guarded by an
-- existence check; the name-sort index is created via `execute format(...)` inside a `do` block so the
-- collation choice can be conditional.
set role devon_migrator;

-- Best-effort fold for matching (not display): apostrophe variants away, Cyrillic to a Latin-ish
-- approximation. TS mirror lives in `src/normalize-uz.ts`; `test/normalize-uz.test.ts` asserts the two
-- agree. Full transliteration accuracy against real text is EPIC-004's job (design §2.5) -- this only
-- has to exist and be internally consistent for this epic.
create or replace function app.normalize_uz(t text) returns text
language plpgsql immutable strict parallel safe as $$
declare
  s text;
begin
  s := lower(translate(t, 'ʻʼʹ‘’' || chr(39) || '`', ''));
  s := replace(s, 'ц', 's');
  s := replace(s, 'ч', 'ch');
  s := replace(s, 'ш', 'sh');
  s := replace(s, 'ё', 'yo');
  s := replace(s, 'ю', 'yu');
  s := replace(s, 'я', 'ya');
  s := replace(s, 'а', 'a');
  s := replace(s, 'б', 'b');
  s := replace(s, 'в', 'v');
  s := replace(s, 'г', 'g');
  s := replace(s, 'д', 'd');
  s := replace(s, 'е', 'e');
  s := replace(s, 'ж', 'j');
  s := replace(s, 'з', 'z');
  s := replace(s, 'и', 'i');
  s := replace(s, 'й', 'y');
  s := replace(s, 'к', 'k');
  s := replace(s, 'л', 'l');
  s := replace(s, 'м', 'm');
  s := replace(s, 'н', 'n');
  s := replace(s, 'о', 'o');
  s := replace(s, 'п', 'p');
  s := replace(s, 'р', 'r');
  s := replace(s, 'с', 's');
  s := replace(s, 'т', 't');
  s := replace(s, 'у', 'u');
  s := replace(s, 'ф', 'f');
  s := replace(s, 'х', 'x');
  s := replace(s, 'ы', 'i');
  s := replace(s, 'э', 'e');
  s := replace(s, 'ў', 'o');
  s := replace(s, 'қ', 'q');
  s := replace(s, 'ғ', 'g');
  s := replace(s, 'ҳ', 'h');
  return s;
end;
$$;

-- Collation: names sort with an ICU "uz" tailoring where the server can provide one, falling back to
-- the ICU root collation, falling back to the database default. `create collation` has no
-- `if not exists`, so existence is checked first; a server built without ICU support raises here,
-- which we catch and simply skip (default collation is still correct, just not Uzbek-tailored).
do $$
begin
  if not exists (select 1 from pg_collation where collname = 'uz-x-icu') then
    begin
      execute 'create collation "uz-x-icu" (provider = icu, locale = ''uz'')';
    exception when others then
      raise notice 'could not create collation uz-x-icu: %', sqlerrm;
    end;
  end if;

  if not exists (select 1 from pg_collation where collname = 'uz-x-icu')
     and not exists (select 1 from pg_collation where collname = 'und-x-icu') then
    begin
      execute 'create collation "und-x-icu" (provider = icu, locale = ''und'')';
    exception when others then
      raise notice 'could not create collation und-x-icu: %', sqlerrm;
    end;
  end if;
end $$;

do $$
declare
  coll text;
begin
  if exists (select 1 from pg_collation where collname = 'uz-x-icu') then
    coll := 'uz-x-icu';
  elsif exists (select 1 from pg_collation where collname = 'und-x-icu') then
    coll := 'und-x-icu';
    raise notice 'uz-x-icu collation not available; falling back to und-x-icu for name sorting';
  else
    coll := null;
    raise notice 'no ICU collation available; using the database default collation for name sorting';
  end if;

  if coll is not null then
    execute format(
      'create index if not exists users_name_sort_idx on app.users ((lower(family_name) collate %I), (lower(given_name) collate %I))',
      coll, coll
    );
  else
    execute 'create index if not exists users_name_sort_idx on app.users (lower(family_name), lower(given_name))';
  end if;
end $$;

-- Trigram index helper: EPIC-004 owns real search UX, but the function + index pairing has to exist
-- and work now so it is not designed for the first time under deadline pressure.
create index if not exists users_name_trgm_idx
  on app.users using gin (app.normalize_uz(given_name || ' ' || family_name) gin_trgm_ops);

reset role;
