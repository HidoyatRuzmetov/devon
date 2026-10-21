set role devon_migrator;
alter table app.units add column if not exists expected_people integer
  check (expected_people >= 0 and expected_people <= 10000);
reset role;
