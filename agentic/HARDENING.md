# Production hardening checklist (binding; decision 17)

Every item is an acceptance criterion somewhere: either a deterministic gate (`agentic/gates.json`),
a reviewer/security check on every epic, or an explicit work item of EPIC-014, which executes the
whole list against the finished product and writes `docs/03-plan/PRODUCTION-READINESS.md` with
before/after measurements. Verifiers cite item ids (`H1.3`) in findings. "Implement, don't describe":
where an item is unmet, the fix is made, not recommended, unless it needs infrastructure the agents
cannot touch, in which case it goes into the report's section 10.

## H1 Security
1.1 No secrets in client code, repo or logs; `check-secrets` gate; `.env.example` only. 1.2 All
privileged operations server-side; auth and authorisation enforced on every endpoint (`can()` +
RLS); object-level access tested by changing ids (cross-department test in CI). 1.3 No
mass-assignment: every write goes through a Zod schema with an explicit allow-list; ownership,
roles, ids and computed values never trusted from the client. 1.4 argon2id passwords; sessions
HttpOnly/Secure/SameSite=Lax with rotation on login and expiry; CSRF double-submit; logout
everywhere. 1.5 XSS: React escaping, Tiptap schema allow-list, DOMPurify on any HTML, CSP with
nonces, no `dangerouslySetInnerHTML` outside the sanitiser. 1.6 Server-side validation of type,
size, format, range, enum, id, URL (SSRF-safe: no private ranges on link unfurling), filename, MIME
(sniffed). 1.7 Parameterised queries only (Drizzle); no string SQL from input. 1.8 Uploads:
extension + MIME + size allow-lists, random storage keys, no user filenames on disk, ClamAV, private
signed URLs, path-traversal impossible by construction. 1.9 Rate limits on login, register, join,
reset, 2FA, AI, uploads; progressive lockout; no enumeration (uniform responses and timing). 1.10
Security headers (helmet: HSTS, CSP, frame-ancestors none, referrer policy, permissions policy);
HTTPS forced by Caddy; CORS allow-list only the app origin. 1.11 Responses never include hashes,
tokens, internal ids beyond need, other users' private fields; logs redact passwords, tokens, codes,
contact blocks. 1.12 Dependencies scanned (Trivy, npm audit high) and pruned; lockfile deterministic;
Renovate self-hosted. 1.13 Production errors: generic message + request id; no stack, SQL, paths.
1.14 Telegram webhook secret token verified; Mini App `initData` HMAC verified; webhook signatures
HMAC-SHA256 with replay window. 1.15 Join keys, invite passwords, reset codes, 2FA codes, link codes:
random from CSPRNG, hashed at rest, expiring, single-use where applicable. 1.16 Privilege escalation
review: member → head → super admin paths tested negatively; admin routes separately reviewed; least
privilege for DB roles (app role cannot touch `audit` beyond INSERT/SELECT).

## H2 Network and API
2.1 Brotli/gzip for all compressible responses. 2.2 Sparse fieldsets; list endpoints return summary
shapes; no full objects by default. 2.3 Cursor pagination on every list; server-side filter/sort/
search. 2.4 Query dedupe (TanStack Query), no duplicate requests on mount, no waterfalls (loaders
prefetch in parallel). 2.5 HTTP caching: immutable fingerprinted assets, `ETag`/`If-None-Match` on
GETs, `Cache-Control: private, no-store` on authenticated JSON. 2.6 Realtime via Centrifugo instead
of polling; digests batch notifications. 2.7 Debounced search/autosave; AbortController on stale
requests; timeouts on every outbound call; retries only for idempotent/transient failures with
backoff + jitter and a cap. 2.8 Streaming for exports and large files. 2.9 Payload budget measured
on the six main routes (report before/after).

## H3 Database
3.1 No N+1: relational queries or batched loads; no query in a loop (Semgrep rule). 3.2 Bulk
inserts/updates for seeds, imports, digests, activity fan-out. 3.3 Pool sizing per process;
PgBouncer-safe `set_config(..., true)`. 3.4 Indexes justified by access patterns: `(department_id,
assignee_user_id, status, due_at)`, `(department_id, project_id)`, order keys, FTS GIN, trigram GIN
on names, `(user_id, read_at)` on notifications; `EXPLAIN` evidence in the report; no redundant
indexes. 3.5 No `select *`; no table scans on hot paths; aggregates precomputed nightly
(`analytics_daily`) and patched on write. 3.6 Transactions around multi-row writes; short; row
versions for optimistic concurrency; unique constraints for idempotency (`idempotency_keys`,
`(event_id, user_id)` RSVP, `(poll_id, option_id, voter_hash)`). 3.7 Migrations safe on production
data (expand/contract), tested twice on Testcontainers; constraints and foreign keys with explicit
cascade rules; enums for states.

## H4 Frontend rendering
4.1 Profile with React DevTools/Performance tracks before optimising; memoise only measured hot
spots (React Compiler on). 4.2 Virtualise boards, tables, archives, activity timelines. 4.3
Route-level code splitting; heavy libs (Excalidraw, FullCalendar, charts, Tiptap) lazy. 4.4 `size-
limit` shell ≤ 200 kB; tree-shake; no duplicate packages. 4.5 No layout thrash (batched reads/writes),
compositor-only animations, `content-visibility` on long lists. 4.6 Cleanup of listeners, timers
(Pomodoro), sockets, observers; no leaks across navigation (heap snapshot before/after in report).

## H5 UI latency
5.1 Optimistic updates for card moves, status, RSVP, checklist, comments, personal tasks; rollback
on failure with toast. 5.2 Never blank screens: skeletons matching layout; keep stale data during
revalidation; prefetch on hover/focus. 5.3 Double-submit prevention via idempotency keys and
per-control pending state. 5.4 Navigation instant (kept-alive panels, View Transitions).

## H6 Assets
6.1 WebP/AVIF, responsive sizes, lazy below the fold; avatars 64/128/512. 6.2 Fonts subset (Latin
Extended + Cyrillic + modifier letters), `font-display: swap`, preloaded critical faces only. 6.3
Fingerprinted assets with 1-year immutable cache; minified; source maps not public (uploaded to
error tracking only). 6.4 Unused CSS/assets removed (report lists bytes saved).

## H7 Backend request path
7.1 No synchronous filesystem or CPU-heavy work in handlers; parallel independent I/O; expensive work
to pg-boss (exports, AI, thumbnails, digests). 7.2 Clients/pools reused (DB, Valkey, HTTP, AI). 7.3
Config parsed once at boot with Zod; startup fails fast on missing env. 7.4 Limits on request body,
JSON depth, upload size, AI input length.

## H8 Dependencies and bottlenecks
8.1 Timeouts and circuit breakers for AI, Telegram, ClamAV, MinIO; graceful degradation (AI off →
features hide; Telegram down → inbox still works; ClamAV down → uploads queue). 8.2 No third-party
scripts in the app; illustrations and fonts self-hosted. 8.3 Single points of failure listed in the
report with mitigation (single server accepted by decision; backups + restore drill).

## H9 Caching
9.1 Explicit cache map (browser/Caddy/Valkey/query/computation) with key, TTL, invalidation, user
isolation; never cache private JSON across users; stampede protection for analytics aggregates.

## H10 Concurrency and idempotency
10.1 Unique constraints + idempotency keys + row versions; RSVP/seat/poll races tested with parallel
requests; job idempotency; webhook replay protection.

## H11 Resources
11.1 Bounded queues/caches/maps; streaming for files; timers cleared; sockets closed; k6 soak (30 min)
shows flat memory.

## H12 Scalability
12.1 Stateless API (sessions in Valkey/DB); worker horizontally scalable; pool and connection limits
computed and documented; load test at 1/10/100/1 000 virtual users with p50/p95/p99 in the report.

## H13 Reliability
13.1 Behaviour verified when Postgres, Valkey, MinIO, ClamAV, AI, Telegram are down or slow;
health/readiness endpoints; graceful shutdown; dead-letter queue for jobs; safe restart.

## H14 Data integrity
14.1 Constraints, FKs, cascades reviewed; transactions on multi-step flows; UTC + tz handling;
numeric types for money (UZS integer); UTF-8 with Uzbek modifier letters normalised; state
transitions enforced in services and tested.

## H15 Observability
15.1 Structured logs with request/user/department ids; latency histograms per route; DB timing;
queue metrics; AI latency/cost; error rates; health page in the admin console; slow-request log.

## H16 Error handling
16.1 Consistent RFC 9457 errors; correct status codes; no swallowed exceptions; unhandled rejection
handler that logs and exits cleanly; error boundaries per route; loading states never stuck.

## H17 Build and production config
17.1 Production builds only; debug/dev endpoints and demo seed disabled unless `--demo`; env
validated; secure cookies; `trustProxy` set for Caddy; compression on; log level info; no
`console.log`; no test accounts in production.

## H18 Deployment
18.1 Reproducible builds; pinned digests; migrations before rollout with backward compatibility;
readiness gating; rollback documented; graceful shutdown; jobs preserved.

## H19 Backups
19.1 pgBackRest + MinIO mirror; retention 30 days + monthly for a year; automated weekly restore
verification; quarterly drill script; backups encrypted; secrets excluded.

## H20 Dependencies
20.1 Unused removed; duplicates deduped; heavy libs justified; vulnerabilities none high; abandoned
packages replaced or vendored; prod vs dev deps separated.

## H21 Third-party scripts
21.1 None in the app (verified by CSP report and bundle analysis).

## H22 Accessibility and HTML
22.1 Semantic HTML validated; keyboard and focus complete; labels; contrast; reduced motion; alt
text; custom controls with ARIA patterns; axe gate 0 serious/critical.

## H23 SEO/web basics
23.1 Public pages (login, join, maintenance) have titles/meta, `robots.txt` disallows the app,
canonical URLs, correct status codes; app routes `noindex`.

## H24 Core Web Vitals
24.1 LCP < 2.5 s, INP < 200 ms, CLS < 0.1 on the six main routes at 4G throttling (Lighthouse CI);
before/after in the report.

## H25 Testing
25.1 Auth, authorisation, permissions, CRUD integrity, validation, idempotency, ritual flows, security
boundaries covered by unit + integration + e2e; no meaningless tests.

## H26 Load testing
26.1 k6 scenarios for board load, card moves, RSVP bursts, analytics, AI; first bottleneck found and
fixed; numbers in the report.

## H27 Cost
27.1 AI calls cached by prompt hash where deterministic; digests batched; logs bounded; no repeated
processing of unchanged data; analytics precomputed.

## H28 Architecture quality
28.1 Single source of business rules (`packages/contracts`); no circular deps (madge check); no
hardcoded URLs; dead code removed (knip).

## H29 Artificial bottlenecks
29.1 Semgrep rules for await-in-loop over independent items, query-in-loop, sync fs in handlers,
polling; violations fixed.

## H30 Final audit
30.1 Six user flows traced end to end (register→department→invite→join; board move; group project;
sprint + Pomodoro; event with carpool + poll; admin pause) with time/CPU/bytes/queries per hop
before and after; report sections 1–10 written; remaining external configuration listed precisely.
