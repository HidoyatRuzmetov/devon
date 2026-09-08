-- H3.6/H10.1: idempotency/uniqueness under concurrency for poll votes. HARDENING.md names the exact
-- constraint this table was missing: "unique constraints for idempotency (... poll
-- (poll_id,option_id,voter_hash))". `app.poll_votes` (0400_events.sql) had ordinary (non-unique)
-- indexes on `poll_id`/`option_id` only -- nothing stopped two concurrent `voteOnPoll` calls for the
-- same (poll, option, voter) from both passing `replacePollVotes`'s delete-then-insert and leaving two
-- rows for what the UI (and `tallyPoll`'s `count(*) group by option_id`) treats as one vote, double
-- counting that voter for that option.
--
-- One column is present for a registered voter (`user_id`) and the other for an anonymous one
-- (`voter_hash`) -- `apps/api/src/modules/events/service.ts`'s `pollToDto`/`voteOnPoll` never sets
-- both on the same row (see `voterHashFor`). A single `unique (poll_id, option_id, voter_hash)` index
-- would not actually dedupe registered voters: Postgres treats every NULL as distinct in a unique
-- index, so N rows with `voter_hash is null` (every registered vote) would all coexist. Two *partial*
-- unique indexes, one per identity column, each `where <column> is not null`, cover both shapes
-- exactly.
--
-- Expand-only (I-15): adds indexes, drops nothing. Safe to run against a table that may already have
-- (poll_id, option_id, user_id) or (poll_id, option_id, voter_hash) duplicates from before this fix
-- shipped -- `create unique index concurrently` is not used here (this migration runner does not run
-- outside a single connection/transaction per file, and the table is expected to be small), so a
-- pre-existing duplicate would fail this migration rather than silently continue: exactly the
-- behaviour wanted (surface the data-integrity problem instead of masking it).
set role devon_migrator;

create unique index if not exists poll_votes_poll_option_user_key
  on app.poll_votes (poll_id, option_id, user_id)
  where user_id is not null;

create unique index if not exists poll_votes_poll_option_voterhash_key
  on app.poll_votes (poll_id, option_id, voter_hash)
  where voter_hash is not null;

reset role;
