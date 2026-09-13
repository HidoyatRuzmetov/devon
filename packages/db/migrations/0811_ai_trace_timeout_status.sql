-- v1.1 critique SEV2 #23 -- `timeout` joins `app.ai_trace_status`.
--
-- The head's own Foydalanish tab recorded latencies of 112 123 ms, 129 203 ms and 275 962 ms against
-- the real GLM, and three failures in seven calls. The 276-second one was not one slow request: it
-- was up to six of them, because `AI_REQUEST_TIMEOUT_MS` bounds a single HTTP attempt while a run can
-- make the initial call, a doubled-max_tokens retry and a schema retry, each with its own transport
-- retry underneath. `@devon/ai`'s gateway now carries a per-run wall-clock budget
-- (`DEFAULT_FEATURE_TIMEOUT_MS`, 75 s for `catch_up`), and a run that exceeds it ends with its own
-- status rather than being filed under `provider_error`.
--
-- Why that distinction earns a migration: "the provider refused" and "we stopped waiting" are
-- different facts about a government deployment. The first is GLM's problem and should push the
-- circuit breaker towards open; the second is ours, is retryable by the person who asked, and must
-- not make the breaker trip on a busy afternoon. The head's console says so in different words too.
--
-- Expand-only: `ADD VALUE` on an enum adds a label and rewrites nothing. `IF NOT EXISTS` makes a
-- re-run a no-op, which is what `migrate:apply` against an already-migrated database needs.
set role devon_migrator;

alter type app.ai_trace_status add value if not exists 'timeout';

reset role;
