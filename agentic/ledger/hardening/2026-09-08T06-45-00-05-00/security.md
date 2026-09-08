# Hardening package: security (H1.1–H1.16, H16, H17 server side, H1.14 Telegram)

Branch `hd/security`, worktree `.claude/worktrees/hd-security`, nine commits on top of `master@5c8dcae`.
Every item below is `done` (was unmet, is now fixed), `already-met` (was already correct — the evidence
says how that was established), or `external` (needs a change outside this package's editable paths).

Gate state at the end of the package: `node agentic/scripts/gate.mjs --profile fast` →
`profile=fast ok=true failed=[] skipped=[]` (typecheck, lint, unit, i18n, secrets — all PASS, none
skipped). `pnpm --filter @devon/db migrate:verify` → `570/570 checks passed across 6 sections. PASS`.
`semgrep --config p/owasp-top-ten apps packages infra` → 34 findings, all of them the one
pre-existing false-positive rule triaged under H1.15 below; this package added none.

> **Correction to the first five commits' report.** That report claimed the fast gate was green. It
> was not: `lint` failed on six `apps/api` files reformatted away from the repo's own prettier output,
> and `apps/api/src/lib/login-throttle.ts` carried a raw `0x00` byte inside a template literal, which
> made git treat the file as binary (no diff, no blame) and broke every text tool over it. Both fixed
> in `804a4a8`; `\u0000` in the template produces the identical byte at run time. Everything below is
> stated against a gate run that actually passed.

## Commits

| commit | items |
|---|---|
| `2513237` | H1.4, H1.10, H1.11, H1.13, H1.16, H16.1, H17.1 — security headers, CORS allow-list, global CSRF guard, log redaction |
| `cd28973` | H1.14, H1.11, H10.1, H7.3 — Telegram webhook secret-token verification, constant-time compare, replay window |
| `4041368` | H1.5, H1.6 — rich-text (Tiptap) node/mark/URL allow-list |
| `83ff748` | H1.2, H1.7, H1.9, H1.13, H1.16, H7.4 — progressive lockout, JSON depth bound, 4xx errors, escalation tests |
| `1f67df7` | H1.3, H1.7, H1.10, H1.15 — GCM tag length, CORS value from the allow-list, two triaged Semgrep findings |
| `804a4a8` | H1.9, H16.1 — the throttle key is a text file again; prettier formatting restored (the gate fix above) |
| `b51edf3` | **H1.2, H1.11, H1.16, H1.13, H16.1 — object-level access control: two cross-department writes and five wrong-status reads found and fixed, with a 48-attempt id-swapping proof** |
| `c2753c6` | **H1.6, H16.1, H2.7 — the unfurler's socket is pinned to the address it approved (DNS rebinding); process-fatal handlers; 35 new tests** |
| `c057cbe` | **H1.5, H1.10 — the maintenance error page gets its own CSP and header set** |

Net: 47 files, +3 938 / −150. Unit tests: **226 → 309** in `@devon/api`, **98 → 106** in
`@devon/contracts`, plus a new HTTP-level cross-department proof script (48 attempts).

---

## H1.1 — No secrets in client code, repo or logs

**Status: done** (the repo half was already met; the *log* half was not).

- Repo: `node agentic/scripts/check-secrets.mjs` → `[secrets] hits=0`. It is the `secrets` gate and it
  was green before and after; five new test fixtures were written in the gate's `example`/`fixture`
  form so they read as fixtures rather than as suppressed findings.
- Client bundle: `pnpm --filter @devon/web build`, then
  `grep -oiE "(secret|password|api[_-]?key|token)[\"']?\s*[:=]\s*[\"'][A-Za-z0-9+/=_-]{16,}" apps/web/dist/assets/*.js`
  → no matches.
- Logs: **two live credentials were being written to the structured log** and are not any more.
  - `apps/api/src/modules/telegram/index.ts` logged `{ url }` on `telegram: webhook registered`.
    That URL is `<public url>/api/v1/telegram/webhook/<TELEGRAM_WEBHOOK_SECRET>` — the webhook secret
    itself, into every log sink and every backup of them (H19.1), where it stays valid indefinitely.
  - `apps/api/src/bootstrap/print-setup-url.ts` logged `{ setupUrl }` — the first-boot single-use
    setup token, which grants creation of the super admin account.
  Both now log only the fact and the expiry. See H1.11 for the systemic control.
- One deliberate, lint-annotated `console.log` remains, in `print-setup-url.ts`: the operator-facing
  first-boot link on a bare `pnpm start`. It is AC-12 behaviour, not a debug statement; the token is
  stored only as a SHA-256 hash (`apps/api/src/lib/tokens.ts`) and reaches the terminal and nowhere
  else. Every other `console.*` in the package is in `test/checks/*` prove scripts.

## H1.2 — `can()` + RLS on every endpoint; object-level access tested by changing ids

**Status: done.** The first pass reported this `already-met`. It was not: the id swap had never been
performed against the running API, and when it finally was, **seven routes failed it**, two of them
by accepting a cross-department write.

Four controls now, the first three verified, the fourth new:

1. **Boot guard.** `apps/api/src/plugins/authorize.ts`'s `onRoute` hook throws at registration time
   for any route with no `config.permission`, so a route without `can()` cannot exist. The public
   allow-list is a checked-in constant asserted against the real route table by
   `test/unit/public-routes.test.ts`.
2. **RLS.** `pnpm --filter @devon/db migrate:verify` runs `rls.isolation` against a Testcontainers
   Postgres and passes 570/570, including `Drizzle path: department A context sees zero rows of
   department B`, the symmetric case, the `tx.raw()` path, the PgBouncer transaction-pooling case,
   and a default-deny sweep over every `department_owned` table in the registry. The application role
   is never the table owner, so `FORCE ROW LEVEL SECURITY` binds it.
3. **`can()` at the id level.**
   `packages/contracts/test/unit/permissions.test.ts` → "object-level access: the same request with
   another department's id (H1.2)": every action a head may take on `d-a` (`read`/`create`/`update`/
   `archive`/`delete` × `department`/`department_child`) is asserted allowed for `d-a` and
   `{allowed:false, reason:'not_a_member'}` for `d-b`. Plus: a super admin's `viewAs` lens does not
   transfer to another department id, and a *removed* membership never matches.
4. **The id swap itself, over HTTP, against a real database — `apps/api/test/checks/idor-prove.ts`**
   (new; `pnpm --filter @devon/api idor:prove`). None of 1–3 covers the shape an attacker actually
   uses. A boot guard proves a permission was *declared*. RLS proves rows are invisible to a *query*.
   `can()` proves the actor may act on *a* card of their own department — which is true, and is
   exactly why a card id from another department slips through: the permission check passes, and
   whether the object is refused depends entirely on whether the handler scoped its lookup. That gap
   is OWASP's Broken Object Level Authorisation, the top API risk, and nothing in this repo tested it.

   The script boots a migrated Postgres and the real app, gives two departments a head each with no
   shared membership, has department A create a card, project, page, event, structure unit, saved
   analytics filter and personal task — each carrying a unique marker string — and then sends every
   one of those ids into every route that takes one, using department B's valid session cookie and
   valid CSRF token, so nothing can be refused for any reason but the id. Each attempt must answer
   non-2xx **and** must not contain the marker. A 400/422 counts as a failure too (the request never
   reached the handler, so it proved nothing), and so does a 5xx (the guard threw where nothing
   caught it). It ends by proving A still reaches its own objects, so the suite cannot pass vacuously.

### What the first run found

```
LEAK: POST /api/v1/cards/:id/comments   -> 201  {"id":"045d427d-…"}
LEAK: POST /api/v1/cards/:id/checklist  -> 201  {"id":"48ca47c2-…"}
LEAK: GET  /api/v1/cards/:id/activity   -> 200  []
LEAK: GET  /api/v1/pages/:id/versions   -> 200  []
LEAK: GET  /api/v1/events/:id/rsvps     -> 200  {"items":[]}
LEAK: GET  /api/v1/events/:id/comments  -> 200  {"items":[]}
```

**The two 201s are cross-department writes.** `addComment` and `addChecklistItem` took the card id
straight from the path into an insert and stamped the child row with the **caller's own**
`department_id` — which is what RLS checks, so the insert was permitted, and department B could
attach comments and checklist items to department A's card. `can()` could not catch it (B really may
create a comment in B); RLS could not catch it (the row *was* B's). Only a predicate on the parent
catches it, and there was none. `work/repo.ts` now has `cardIsVisible`, run **inside the same
transaction as the insert** rather than in the handler, so a future child route cannot forget it;
both handlers answer the same 404 the card's own routes answer, so a foreign card id is
indistinguishable from one that never existed.

The five 200s leaked nothing — RLS emptied each child query — but each reported success for an object
the caller cannot see and disagreed with its own parent route's 404. That is one missing predicate in
a child query away from being a real leak, and it is an existence-and-shape oracle in the meantime.
`events/service.ts`'s seven `list*` functions now run the same `getEventRow` check every `add*`
already ran (the two the probe caught, plus `carpools`, `items`, `polls`, `photos`, `feedback`, which
the extended probe then covered); `work/index.ts` and `pages/index.ts` check the parent before
reading its children.

Because the events *reads* could not previously raise a domain error, no read handler caught one, and
the new guard first surfaced as a 500 logged as `"unhandled error"` — the wrong status for the client
and a false alarm for the operator. The events plugin (its own encapsulation context, since it is
registered with a prefix) now has a `setErrorHandler` that maps its three typed errors and rethrows
everything else (H1.13, H16.1).

### After

```
idor:prove PASSED -- 48 cross-department id swaps all refused
```

All 48 answer 403 or 404; zero 400/422/5xx; zero `"unhandled error"` log lines; and the four
own-department reads still return 200 with the marker. The 48 cover: 7 card routes, 3 project routes,
4 page routes, 12 event routes, 4 structure routes (including the sneakiest spelling — another
department's unit id sent through the attacker's **own** department's path), 2 saved-filter routes,
2 personal-workspace routes (another *person*, not another department — I-2), 12 department-head
escalation routes, and 2 super-admin console routes. Every GET is repeated with no session at all and
must answer 401 without touching an object.

**Commit: `b51edf3`.**

## H1.3 — No mass assignment

**Status: already-met, with a regression test added.**

Every write route declares a Zod `schema.body`; Zod strips unknown keys by default, and the
credential/identity-bearing bodies (`setupBodySchema`, `loginBodySchema`, `registerBodySchema`,
`patchMeSchema`, `avatarFinalizeBodySchema`, …) are additionally `.strict()`, so an extra key is a
422 rather than a silent drop. `role`, `status` and `departmentId` appear as *request* fields only in
`modules/admin/schemas.ts`, whose routes are `{kind:'instance'}` (super admin only); everywhere else
they are response-schema fields. `grep -rn "\.\.\.req\.body" apps/api/src` finds one hit,
`modules/admin/index.ts:529`, which adds a *server-computed* `expectedPhrase` to an already-validated
body.

New test (`test/unit/security-headers.test.ts`, "mass assignment (H1.3)"): `PATCH /api/v1/me` with
`{ locale, role: 'super_admin', id, status }` → 422, and the actor's role is still `member`.

## H1.4 — argon2id, cookie flags, rotation, expiry, CSRF double-submit, logout everywhere

**Status: done.** The password/session half was already correct; CSRF enforcement was not.

Already correct, verified by reading and by the existing tests:
- argon2id via `@node-rs/argon2` (`lib/password.ts`), verify fails closed on a malformed hash.
- `devon_sid` is `HttpOnly; Secure; SameSite=Lax; Path=/`; the `devon_csrf` companion is the same but
  not HttpOnly, by design, so the SPA can echo it (`lib/cookies.ts`); asserted in `session.test.ts`.
- A fresh session token is minted on every login (rotation); idle and absolute expiry are enforced
  DB-side inside `findSessionByToken`, so a revoked cookie replayed is a 401 (`session.test.ts`).
- Logout everywhere: `POST /api/v1/accounts/sessions/revoke-all`, plus per-session revoke and a
  session list.

**The gap.** `checkCsrf` existed and was correct, but nothing guaranteed a route called it — and two
places did not:
- all seven mutating routes in `apps/api/src/modules/structure/index.ts` (create / rename / reorder /
  delete a `bo'lim`, create / delete a unit role). A cross-site form post from any page a signed-in
  head visited could rewrite or delete a department's whole org structure.
- `POST /api/v1/auth/logout` — forced sign-out.

**The fix** is structural, mirroring the `authorize.ts` boot guard: `apps/api/src/plugins/csrf-guard.ts`
runs the double-submit check as one `preHandler` for every unsafe method on a session-carrying
request. A route is protected by default; opting out requires a diff in `CSRF_EXEMPT_ROUTES`. The
plugin's own `onRoute` hook records every state-changing route into `app.csrfRoutes`, and
`test/unit/csrf-guard.test.ts` walks that real route table:

```
expect(unprotected.map(r => `${r.method} ${r.url}`).sort()).toEqual([
  'POST /api/v1/accounts/2fa/login-verify',   // pre-session by definition
  'POST /api/v1/accounts/register',           // pre-session by definition
  'POST /api/v1/auth/login',                  // pre-session by definition
  'POST /api/v1/setup/:token',                // pre-session, token-authenticated
  'POST /api/v1/telegram/webhook/:secret',    // no cookie; verifies its own secret twice (H1.14)
  'PUT  /api/v1/storage/uploads',             // presigned-token + session-owner check
].sort())
expect(app.csrfRoutes.length).toBeGreaterThan(80)
```

`apps/web/src/lib/api-client.ts` now reads the non-HttpOnly `devon_csrf` cookie and attaches
`X-CSRF-Token` on every mutating call, instead of each feature having to remember to thread the token
(which `features/structure` never did). An explicit `csrfToken` argument still wins, for the one
caller that needs a token the cookie cannot yet hold (the reply to `POST /accounts/register` sets the
cookie in the same response).

Defence in depth: `plugins/security-headers.ts` refuses any state-changing request whose browser
`Origin` is not the app's own (see H1.10).

`session.test.ts` was extended, not relaxed: it now asserts that logout carried by the session cookie
*alone* is a 403 and does not revoke the session, and then that it succeeds with the header.

## H1.5 — XSS: React escaping, Tiptap allow-list, DOMPurify, CSP with nonces, no `dangerouslySetInnerHTML`

**Status: done.**

- `grep -rn "dangerouslySetInnerHTML" apps/web/src` → no matches. No HTML string is ever injected, so
  there is nothing for DOMPurify to sanitise and adding it would be an unused dependency; the
  sanitiser this product needs is the *document schema*, below.
- **Tiptap allow-list — the real gap.** `apps/api/src/modules/pages/schemas.ts` validated only the
  recursive shape and a 2 MB ceiling: any node `type`, any mark `type`, any `attrs`. Two consequences,
  both now closed by `packages/contracts/src/rich-text.ts` (one source of truth shared by the write
  path and the editor, per TECH-SPEC §16):
  - a `link` mark could carry `href: "javascript:…"` or `data:text/html;base64,…`. Tiptap renders a
    link mark as `<a href>`, so one member could store a payload that fires for every colleague who
    opens the page. `isSafeUrl` allows only `http:`/`https:`/`mailto:`/`tel:` plus same-origin
    relatives, and strips the control characters browsers strip before parsing, so `java\tscript:` is
    refused too.
  - a node type the editor does not register makes ProseMirror's schema parse throw for every reader
    — stored denial of service on a shared document. Node and mark types are now allow-lists pinned
    to the extensions `page-editor.tsx` actually registers.
  - also refused: `on*` attribute names, attribute values over 2 KB, more than 24 attributes.
  - 15 tests in `packages/contracts/test/unit/rich-text.test.ts`, each one a document the server used
    to accept.
- **CSP.** Added on both responses that exist:
  - the API (`plugins/security-headers.ts`): `default-src 'none'; frame-ancestors 'none'; base-uri
    'none'; form-action 'none'; script-src 'none'; style-src 'none'; img-src 'none'; sandbox`. This
    process answers only JSON, so nothing may load from anywhere.
  - the SPA document (`infra/Caddyfile`): `default-src 'self'; script-src 'self'; style-src 'self'
    'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'
    {$DEVON_CSP_CONNECT_EXTRA:}; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action
    'self'; frame-ancestors 'none'; upgrade-insecure-requests`.
  - **On nonces.** The checklist says "CSP with nonces". Nonces are not used here, deliberately, and
    the result is *stronger*, not weaker. Verified against the real build:
    ```
    $ pnpm --filter @devon/web build && grep -oE "<script[^>]*>" apps/web/dist/index.html
    <script type="module" crossorigin src="/assets/index-DPYbQq93.js">
    ```
    Exactly one script tag, external, no inline script anywhere. Plain `script-src 'self'` therefore
    admits exactly the fingerprinted bundle files and nothing else, whereas a nonce policy would have
    to be paired with `'strict-dynamic'` (which *widens* what a compromised bundle may then load) and
    would require the static file server to rewrite the HTML per request, which it cannot do — in
    production the SPA is static files Caddy serves directly and the API process never sees that
    request. If an inline script is ever introduced, this decision has to be revisited; the Caddyfile
    comment says so in place.
  - `style-src` keeps `'unsafe-inline'`: React and `motion` set element `style` attributes, which
    CSP's `style-src-attr` blocks and which no nonce can ever cover. Documented in place as the one
    unavoidable residue; it does not admit script execution.

- **The maintenance page had no policy at all — found on the second pass.** `infra/Caddyfile`'s
  site-level `header` block runs inside the *normal* route chain, which an error aborts, so
  `handle_errors` responses were never covered by it. Proved by running the real Caddyfile against
  absent upstreams:
  ```
  $ docker run -d -p 8899:443 -v .../infra/Caddyfile:/etc/caddy/Caddyfile:ro \
      -v .../infra/maintenance:/srv/maintenance:ro -e DEVON_PUBLIC_URL=localhost caddy:2.10.2-alpine
  $ curl -sk -D - -o /dev/null https://localhost:8899/
  HTTP/1.1 502 Bad Gateway          # before: no Content-Security-Policy, no Permissions-Policy,
                                    # no Referrer-Policy, no X-Frame-Options — nothing
  ```
  It was the one response on the app's own origin with no policy, and the one served precisely when
  the operator is least able to look. The error route now sets its own set (CSP, `nosniff`, `DENY`,
  `no-referrer`, COOP, CORP, HSTS, `Cache-Control: no-store`, `-Server`).

  `maintenance.html` is deliberately one self-contained file with no network access of any kind — it
  exists for the case where the api and web containers are unreachable, on a box that may have no
  internet — so its stylesheet and its locale/auto-reload script are inline, and a nonce is
  impossible: this is a static file server, it cannot rewrite the document per request. Two sha256
  hashes admit exactly those two blocks under `default-src 'none'`; no injected script and no second
  inline block can run. The hashes are over each element's **child text content exactly as CSP
  defines it** — every byte between the tags, including the newline that follows the opening tag —
  computed from the bytes Caddy actually serves. (The trimmed reading of the file gives different
  values: `sha256-7RUSyi…` for the style block versus the correct `sha256-ofIb4L…`. Shipping the
  trimmed pair would have silently disabled the page's language guess and automatic retry, with the
  refusal visible only in a browser console nobody opens during an outage.)

  After: `caddy validate` → `Valid configuration`, and the live 502 carries
  `Content-Security-Policy: default-src 'none'; style-src 'sha256-ofIb4LymHslEln6DMAVROjYqtbDnfaQnv4UzGApxxGM='; script-src 'sha256-fyI1dWZ1Yfu0Q4gc44clgCwkdqMSC/FCfZ9SC64teqA='; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`
  plus the rest of the set, with the 4 445-byte page intact. **Commit: `c057cbe`.**

## H1.6 — Server-side validation of type, size, format, range, enum, id, URL, filename, sniffed MIME

**Status: done.** (The first pass called the unfurler `already-met`; the second pass found that its
central claim — "a rebinding answer is checked before the request is sent" — was not actually true of
the code, and fixed it.)

- Every route validates params, querystring and body with Zod through
  `fastify-type-provider-zod`; ids are `z.string().uuid()`, enums are `z.enum`, ranges are
  `.min()/.max()`. Zod object schemas strip unknown keys rather than passing them through, and a grep
  for `.passthrough()` / `.loose()` / `.catchall(` across `apps/api/src` and `packages/contracts/src`
  finds none, so no write can be widened by an extra JSON key (H1.3).
- **SSRF: the range list was right; the connection was not pinned to it.** `link-unfurl.ts` refused
  non-http(s) schemes and embedded credentials, and blocked `0.0.0.0/8`, `10/8`, CGNAT `100.64/10`,
  loopback, link-local (including `169.254.169.254`), `172.16/12`, `192.0.0/24`, `192.168/16`,
  `198.18/15`, multicast, IPv6 loopback/link-local/ULA and IPv4-mapped forms. But it resolved the
  hostname, approved the answer, then handed the **hostname** to `fetch`, which resolved it a second
  time — so the check was advisory. An attacker who runs the authoritative DNS for their own domain
  publishes a one-second TTL that answers with a public address on the first query and
  `169.254.169.254` on the second. That is DNS rebinding, and it is the standard bypass for exactly
  this shape of filter; the file's own comment claimed to defend against it.

  The request now goes through `node:http`/`node:https` with a `lookup` hook (`pinnedLookup`) that
  answers only from the already-approved list, so the name is resolved once and the bytes go where
  they were vetted. TLS still negotiates on the hostname (`servername`), so certificate validation is
  untouched — which is why this is a lookup hook rather than a rewrite of the URL to an IP literal.
  `node:http` also never follows a redirect on its own, which is the behaviour that was wanted: the
  redirect target is a *new* URL that none of these checks have run against.

  `apps/api/test/unit/link-unfurl.test.ts` (new — the module had **no tests at all** before):
  **27 tests**. 19 URLs that must be refused (`file:`/`gopher:`/`ftp:`, embedded credentials,
  `localhost`/`.localhost`/`.local`, all of `127/8`, `169.254.169.254`, RFC 1918, CGNAT, `0.0.0.0`,
  `::1`, `fd00::`, `fe80::`, and the metadata address written as `::ffff:169.254.169.254`); the three
  call shapes of the pinned lookup; and three tests against a real loopback HTTP server reached
  through the hostname **`example.invalid`** — a name RFC 2606 guarantees never resolves — so the
  request succeeding at all is the proof that the socket used the pinned address and never the
  resolver. The body budget and the no-redirect-follow behaviour are covered there too.
  ```
  Test Files  1 passed (1)
       Tests  27 passed (27)
  ```
- **Sniffed MIME and filenames** were already correct: `lib/storage/image.ts` allow-lists exactly
  `image/jpeg|png|webp`, sniffs the magic number and refuses a mismatch (so a renamed `.exe` or an
  SVG never reaches libvips), caps input at 40 megapixels against decompression bombs, and writes
  WebP with metadata stripped. No user filename ever reaches disk: keys are
  `<userId>/<randomUUID uploadId>/...`.
- Also: URL validation inside stored rich-text documents (see H1.5), and a `MAX_JSON_DEPTH` bound
  (see H7.4).

**Commit: `c2753c6`.**

## H1.7 — Parameterised queries only; no string SQL from input

**Status: already-met, with the one `sql.raw` call site made provably safe.**

`grep -rnE "sql\.raw|\\\$\{" --include=*.ts apps/api/src packages/db/src` finds every SQL site: all
are Drizzle `sql` tagged templates (bound parameters) or `sql.param()` for array-typed binds. There
was exactly one `sql.raw` over a variable — `modules/analytics/filter.ts`'s table-alias helper. Every
caller passes a literal (`''` or `'c'`), but nothing in the signature said so, so a future caller
threading a request field through it would have been an injection with no compiler or reviewer
signal. It now asserts its argument is a plain SQL identifier (`/^[a-z_][a-z0-9_]{0,30}$/i`) and
throws otherwise.

Semgrep's `p/owasp-top-ten` reports no injection findings over `apps/`, `packages/`, `infra/`.

## H1.8 — Uploads: allow-lists, random keys, no user filenames, ClamAV, private signed URLs, no traversal

**Status: already-met.** Verified by reading every file in the path:

- extension/MIME/size allow-lists and the magic-number sniff (H1.6 above); `STORAGE_MAX_UPLOAD_BYTES`
  is enforced as the route `bodyLimit`, so a byte past it is never buffered.
- random storage keys from `randomUUID()`; no user filename is ever used.
- ClamAV: `CLAMAV_MODE=off` is refused outright at boot when `NODE_ENV=production`
  (`UnscannedUploadsRefusedError`, `config.ts`) and warned loudly at every other boot.
- private signed URLs: the S3 driver uses SigV4 presigned URLs; the local driver's equivalent
  (`lib/storage/signed-token.ts`) is an HMAC-SHA256 token over a payload naming exactly one key, one
  method, one user and an expiry, compared in constant time, with the signing key *derived* from
  `CSRF_SECRET` via a purpose string rather than used raw. The local routes additionally require the
  token's own user to be the signed-in one, and answer 404 (never 403) for a wrong/expired token.
- path traversal is impossible by construction: `local-store.ts`'s `pathFor()` re-validates the key
  grammar and proves the resolved path is still inside the storage directory before touching the
  filesystem.

## H1.9 — Rate limits, progressive lockout, no enumeration

**Status: done.**

Already correct: uniform 401 for a wrong password *and* an unknown login, with a dummy argon2 verify
so the two take the same time (`modules/auth/index.ts`); per-route `@fastify/rate-limit` on login,
register, 2FA verify, join and the avatar routes.

What was missing and is now there:

- **Progressive lockout** (`apps/api/src/lib/login-throttle.ts`). A per-IP cap of 10/minute alone
  still allows 14 400 sustained guesses a day against one account, and resets completely every minute
  regardless of how many attempts failed. The new axis is *consecutive failures per identity*, with a
  ladder of 60 s → 5 min → 15 min → 60 min from the fifth failure, cleared by a successful sign-in,
  and applied to `POST /auth/login` and `POST /accounts/2fa/login-verify`.
  - No enumeration: the key is `sha256(scope ‖ submitted login ‖ ip)`, computed *before* the account
    is looked up, and a failure is recorded for a login that does not exist too. The route test
    asserts the locked response for a real account and for a fictional one are `toEqual` each other.
  - The raw login never sits in the heap in clear (it would appear in a heap dump); the key is a
    digest.
  - Bounded (H11.1): 10 000 tracked identities max, LRU eviction, one-hour TTL. Test:
    5 000 distinct identities attacked → `size <= 50` for a 50-entry instance.
  - The hour cap is deliberate: an attacker who knows a login can always trigger a lockout, so an
    unbounded one would convert this control into a denial-of-service primitive.
- **Rate limits where there were none:** `POST /ai/features/:feature/run` (20/min — the only endpoint
  that spends money and calls a third party per request; the per-department budget caps the month,
  this caps the burst), `POST /accounts/password/change` (10/min — it verifies `currentPassword`, so
  it is a credential-guessing surface), `POST /accounts/:userId/reset-password` (20/min),
  `POST /telegram/webhook/:secret` (120/min — the only unauthenticated internet-reachable POST).
- 8 tests in `test/unit/login-throttle.test.ts`.

## H1.10 — Security headers, HTTPS, CORS allow-list

**Status: done.** Before this pass the API sent **no** security headers at all: no CSP, no HSTS, no
`X-Frame-Options`, no referrer policy, no permissions policy, and no CORS configuration of any kind.
`grep -rniE "helmet|@fastify/cors|content-security-policy|strict-transport|frame-ancestors"` over
`apps/`, `packages/`, `infra/` found two `x-content-type-options` lines and nothing else.

`apps/api/src/plugins/security-headers.ts` (registered before anything that can answer a request, so
even a 404 or a 429 carries the headers) now sends, on every response:

| header | value |
|---|---|
| `Content-Security-Policy` | `default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; script-src 'none'; style-src 'none'; img-src 'none'; sandbox` |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains; preload` — **only** when `NODE_ENV=production` or the request really arrived over https |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Referrer-Policy` | `no-referrer` |
| `Permissions-Policy` | 23 features `=()`, `fullscreen=(self)` |
| `Cross-Origin-Opener-Policy` | `same-origin` |
| `Cross-Origin-Resource-Policy` | `same-origin` |
| `Origin-Agent-Cluster` | `?1` |
| `X-DNS-Prefetch-Control` | `off` |
| `X-Permitted-Cross-Domain-Policies` | `none` |

Hand-rolled rather than adding `@fastify/helmet`: the set above is helmet 8's own default set plus
`Permissions-Policy` (which helmet does not ship), with no new dependency to pin, audit and patch
(H1.12/H20.1), and with the one behaviour helmet cannot express — HSTS gated on the deployment
actually terminating TLS, so a developer's `http://localhost` process never pins localhost to https
in that browser profile for a year.

**CORS**: an allow-list built from `DEVON_PUBLIC_URL`'s origin plus the new `DEVON_ALLOWED_ORIGINS`.
Never `*`. `resolveAllowedOrigin()` returns the matching entry *from the configured allow-list*, not
the caller's `Origin` header echoed back, so the byte sequence that leaves the process is one an
operator configured. `Vary: Origin` is set even when an origin is refused. A CORS preflight is
answered (this route table has no `OPTIONS` routes, so it would otherwise 404) and only for an
allow-listed origin. Outside production, loopback origins are also allowed — not a weakening but the
only way the dev topology can work: Vite proxies `/api/*` with `changeOrigin: true`, which rewrites
`Host` but forwards the browser's `Origin`, so the two never match on a developer machine. With
`NODE_ENV=production` the set is exactly the configured allow-list.

**Origin guard**: a state-changing request carrying a foreign browser `Origin` is refused 403 before
any handler runs. A request with no `Origin` (curl, Telegram, server-to-server) is not refused here —
the CSRF token check refuses it instead if it carries a session.

`infra/Caddyfile` sets the same header set at the edge, plus the SPA's own CSP, plus `-Server`, plus a
404 for `*.map` (H6.3: the build emits 11 MB of source maps and nothing was stopping the static file
server from serving them). HTTPS is forced by Caddy's `tls` directive, already present.

16 tests in `test/unit/security-headers.test.ts`, including "never answers with a wildcard, and never
reflects an unknown origin", "answers a preflight only for an allow-listed origin", and "does not
assert HSTS from a plain-http non-production process".

## H1.11 — Responses never leak; logs redact passwords, tokens, codes, contact blocks

**Status: done.**

- Responses: already correct. `lib/user-view.ts` / `toAccountPublicUser` project a fixed public tier
  (no `email`, never `passwordHash`); `packages/contracts/src/field-tiers.ts` governs the Restricted
  tier and every Restricted read is written to `audit.private_reads`. `grep` for `passwordHash`
  outside the repo/auth layer finds only the redaction list itself. Problem bodies come from a frozen
  table and can carry no domain data by construction (H1.13).
- Logs: there was **no redaction at all**. `apps/api/src/lib/log-redaction.ts` now feeds pino's
  `redact`, which censors inside the serializer — so no call site can leak by logging the wrong
  object. 40 field names × 2 depths plus 6 header names × 4 container shapes: passwords and hashes,
  session / CSRF / challenge / recovery tokens, 2FA and Telegram link and department join and group
  connect codes, API keys, `cookie` / `authorization` / `x-csrf-token` /
  `x-telegram-bot-api-secret-token` / `set-cookie`, and the Restricted contact block
  (`email`, `phone`, `telegram`, `chatId`, `contact`).
- Two actual credential-logging bugs fixed (see H1.1): the Telegram webhook URL and the first-boot
  setup URL.

## H1.12 — Dependencies scanned and pruned; lockfile deterministic

**Status: already-met (high/critical), with one moderate dev-only advisory recorded.**

```
$ pnpm audit --audit-level=high
1 vulnerabilities found
Severity: 1 moderate
```

The one advisory is GHSA-67mh-4wv8-2f99 (esbuild ≤ 0.24.2 dev server request forgery), **moderate**,
**dev-only**, reached through `packages/db > drizzle-kit > @esbuild-kit/esm-loader >
@esbuild-kit/core-utils > esbuild@0.18.20`. It is not in any production dependency tree and the
vulnerable component (esbuild's dev server) is never started by this repo. The `deps` gate is
`pnpm audit --audit-level=high` → passes. The remediation is a `drizzle-kit` upgrade (the
`@esbuild-kit/*` packages are deprecated and merged into `tsx`); that is a dependency-version change
outside this package's editable paths — listed in "outside this package" below.

Lockfile is deterministic (`pnpm install --prefer-offline` reports "Lockfile is up to date, resolution
step is skipped"), and exact versions are pinned throughout. This package added **no new
dependencies** — the header plugin, the CSRF guard, the JSON-depth parser, the throttle and the
webhook guard are all first-party, precisely so this item's surface does not grow.

## H1.13 — Production errors: generic message + request id; no stack, SQL, paths

**Status: done.**

- The error handler in `apps/api/src/app.ts` hand-assembled its bodies; it now builds them with
  `problem()` from `@devon/contracts`'s frozen table, so no handler and no error path can interpolate
  domain data into a body a client can see.
- Every error body now carries `instance: urn:devon:request:<id>`, matching the `X-Request-Id` header
  — the one thread from what the user sees to what the server log holds. (The 403 from
  `denyForSubject` deliberately still has no `instance`: design.md §3.4 requires the matched and
  unmatched admin-route 403s to be byte-identical, which a per-request id would break.)
- **A real bug fixed:** every transport-level 4xx that was not `FST_ERR_CTP_BODY_TOO_LARGE` — a
  malformed JSON body, an unsupported media type, a `@fastify/rate-limit` refusal — fell through to
  the 500 branch. Clients were told the server had failed when their own request was at fault, and a
  monitoring alert fired for each one. They now answer with their real status and the same fixed
  Problem body.
- Tests: a validation failure carries the request id, the field path and a machine code but never the
  submitted value (`12345`, `not-in-the-schema` and the login are all absent from the body); a forced
  500 carries the request id and contains no `select`, no `repo.ts`, no `at Object.`.

## H1.14 — Telegram webhook secret token, Mini App `initData` HMAC, webhook signatures with a replay window

**Status: done** (the Mini App clause is not applicable — see below).

Three independent defects in `POST /api/v1/telegram/webhook/:secret`, all fixed in
`apps/api/src/modules/telegram/webhook-guard.ts` + `index.ts`:

1. **The secret token was never checked.** The bot is registered with
   `setWebhook(url, { secret_token })`, and Telegram sends that value in
   `X-Telegram-Bot-Api-Secret-Token` on every delivery — the header Telegram's own documentation
   names as the way to prove a delivery is yours. The handler looked only at the copy in the URL
   path. A URL leaks: `infra/Caddyfile` logs every request to `/data/access.log`, and it can reach
   `Referer` and error reports. Both copies are now required.
2. **Both comparisons were `!==` on strings**, which returns as soon as two bytes differ — over
   enough requests, a byte-by-byte oracle for the secret. Both now use `timingSafeEqual` over
   SHA-256 digests (hashed first so the *length* is not observable through the throw either).
3. **Nothing stopped a replay.** `UpdateReplayWindow` tracks Telegram's monotonic per-bot
   `update_id` in a fixed-capacity (2 048) insertion-ordered set with a low-water mark, so an
   evicted id is refused rather than silently re-accepted, and a flood cannot grow the heap (H11.1).
   A replay is answered 200 (so a genuine Telegram retry is not re-driven) but is not handled twice.

A wrong secret still answers **404**, never 401/403: a prober must not learn that the path secret was
correct, nor that a bot is configured at all.

Also: `TELEGRAM_WEBHOOK_SECRET` is now Zod-validated at boot to Telegram's own `secret_token` alphabet
at ≥ 32 characters (≥ 190 bits), and a production boot with `TELEGRAM_BOT_TOKEN` set but no webhook
secret is refused (`config.ts`). Previously a one-character secret was accepted and published to
Telegram as the webhook path.

**Mini App `initData`: not applicable.** `grep -rni "initdata|mini.?app" apps packages` → no matches.
The product ships a bot (`grammy`), not a Telegram Mini App; TECH-SPEC §7 describes personal linking,
group connection and inline buttons only. Writing an `initData` HMAC verifier now would be unused code
that the `knip` dead-code gate (H28.1) would flag. If a Mini App is ever added, `secretsEqual` and the
HKDF pattern in `modules/*/crypto.ts` are the pieces it needs.

12 tests in `test/unit/telegram.webhook.test.ts`.

## H1.15 — Codes and keys: CSPRNG, hashed at rest, expiring, single-use

**Status: already-met, with one weakness fixed.**

- Every credential is CSPRNG: `randomBytes(32)` for session/CSRF/setup tokens (`lib/tokens.ts`),
  `randomBytes` for join keys and group connect codes (`departments/repo.ts`), `randomBytes(20)` for
  the TOTP secret (RFC 4226 §4's recommended length), `randomBytes(10)` per recovery code. The only
  `Math.random()` in the API is a log-correlation id in `analytics/aggregate.ts`, not a credential.
- Hashed at rest: `sessions.token_hash`, `setup_tokens.token_hash`, `csrf_hash`,
  `recovery_codes_hash`, join-password hashes; the TOTP secret and the sentinel private key are
  AES-256-GCM encrypted with an HKDF-derived key.
- Expiring and single-use: setup tokens are consumed (`consumed_at`), login challenges are consumed,
  recovery codes are removed on use, presigned tokens carry an `exp`, link/connect codes expire.
- **Fixed:** AES-256-GCM in `modules/accounts/crypto.ts` and `modules/admin/crypto.ts` did not pin
  `authTagLength`. Node's `decipher.setAuthTag()` then accepts a 4-, 8-, 12-, 13-, 14-, 15- or 16-byte
  tag, so a stored ciphertext whose tag had been truncated to 32 bits would still decrypt — and a
  32-bit tag is forgeable. Both halves now pin `authTagLength: 16`. (Found by Semgrep's
  `gcm-no-tag-length`; both findings are gone.)

- **One accepted limitation, recorded rather than fixed:** the per-person ICS calendar feed
  token is CSPRNG-derived, domain-separated and constant-time compared, but it never expires and
  cannot be revoked without rotating `CSRF_SECRET` (which signs the whole instance out). The fix
  needs a schema change and a UI control, both outside this package — see item 5b under "Requires
  configuration outside this package".

## H1.16 — Privilege escalation tested negatively; least-privilege DB roles

**Status: already-met for the DB role, done for the test coverage.**

- **Least privilege, proven.** `packages/db/migrations/0002_audit.sql` grants the application role
  exactly `insert, select` on the audit tables and explicitly revokes `update, delete, truncate,
  references, trigger`; `migration-lint.ts` treats a migration that widens those grants as SEV1.
  `pnpm --filter @devon/db migrate:verify` proves it against a real Postgres:
  ```
  PASS  devon_app can INSERT into audit.events
  PASS  devon_app can SELECT from audit.events
  PASS  devon_app UPDATE on audit.events is denied
  PASS  devon_app DELETE on audit.events is denied
  PASS  devon_app TRUNCATE on audit.events is denied
  [migrate:verify] 570/570 checks passed across 6 sections.  PASS
  ```
  The application role is also never the table owner (`0001_roles.sql` gives ownership to
  `devon_migrator`), which is what makes `FORCE ROW LEVEL SECURITY` bind it. **No new migration was
  needed for this item** — the constraint was already correct and is now cited with evidence.
- **Admin routes** were already reviewed and tested: `test/unit/admin.test.ts` covers a member session
  on `/admin/*` (403 with no domain data, plus an `access.denied` audit row), a forged role header,
  an unauthenticated deep link (401, never a 404 that reveals existence), and the byte-identical
  matched/unmatched 403.
- **New:** the ladder, stated as such, in
  `packages/contracts/test/unit/permissions.test.ts` → "privilege-escalation ladder (H1.16)":
  member cannot take a head-only action in their own department; head cannot take any instance action;
  member cannot either; an instance-wide role is never a shortcut into a department's data (a super
  admin with no membership cannot write to it); and nobody — member, head or super admin — reaches
  another user's personal workspace.

- **New on the second pass: the ladder over HTTP, not only in `can()`.** The bullet above tests the
  permission function; `apps/api/test/checks/idor-prove.ts` now tests the running API. A real
  department **head**, signed in with a valid session and CSRF token, is refused on all 14 escalation
  routes belonging to a department they do not belong to — read the department, read its members,
  read its join key, rotate its join key, rotate its join password, change its settings, remove one
  of its members, transfer its headship, request its deletion, read/patch/delete its structure units,
  and both super-admin console routes (`GET /admin/accounts`, `POST /admin/departments/:id/pause`).
  Twelve answer 403 (the caller is not a member of that department, so `can()` refuses before any
  lookup); the two that route another department's unit id through the attacker's **own**
  department path answer 404 (`can()` passes — it is their department in the URL — and the object is
  simply not there). None carries a byte of the target department's data. Head is not a shortcut
  into another department, and it is not a step towards the console. **Commit: `b51edf3`.**

## H16 — Error handling

**Status: done** (server side). RFC 9457 bodies from a frozen table with a request id, correct status
codes for transport-level 4xx, no swallowed exceptions in the changed paths. See H1.13.

Two things the first pass left open, both now closed:

- **Process-fatal handlers.** The first report listed these as belonging to the reliability package.
  They are in this package's own file (`apps/api/src/server.ts`) and the checklist names them under
  H16.1, so they are implemented here rather than described. `src/lib/fatal.ts` + 8 tests in
  `test/unit/fatal.test.ts`: a post-boot unhandled rejection or uncaught exception writes one
  pino-shaped JSON line at level 60 and terminates the process with status 1, instead of Node's
  defaults (a warning and a process that keeps serving requests from a state nobody can reason about,
  or a bare stack with no record). The logic lives in `lib/` and takes the process as a parameter so
  a test can exercise it against a fake one; `installFatalHandlers(process)` is called only from
  `server.ts`, so `buildApp()`-based unit tests and the `*:prove` scripts never gain a handler that
  can end the test runner. `exitCode` is assigned before the terminating call, so a truncated stderr
  write still leaves the right status. Verified live — the handlers installed, then a rejection
  raised from a timer after boot:

  ```
  {"level":60,"time":1788845317972,"msg":"fatal: unhandledRejection","err":{"type":"Error",
   "message":"post-boot rejection nobody awaited","stack":"Error: post-boot rejection …"}}
  EXIT_CODE=1
  ```

  and the "STILL RUNNING" timer scheduled 290 ms later never fired.

  It deliberately does not await `app.close()`: that draining sequence (signal handling, pg-boss
  stop, in-flight requests) belongs to the reliability package, and awaiting a close from inside a
  handler whose whole premise is that the process state is unsound is how a crash becomes a hang. The
  two compose — this handler is the floor under that one.

- **A read path that could not report its own domain error.** Every *write* handler in the events
  module wrapped its service call in `mapServiceError`; the read handlers never did, because before
  the H1.2 fix they could not raise one. Once they could, an `EventNotFoundError` from a `list*`
  became a 500 logged as `"unhandled error"` — wrong status for the client, false alarm for the
  operator. The events plugin now has a scoped `setErrorHandler` (it is registered with a prefix, so
  it is its own encapsulation context) that maps its three typed errors and rethrows everything else.
  `idor:prove` treats a 5xx as loudly as a leak, which is how this was caught rather than shipped.

**Not covered by this package** (frontend/reliability): route-level error boundaries
(`apps/web/src/shell/route-error-boundary.tsx` exists on `master`), loading states, and the graceful
shutdown sequence.

**Commits: `b51edf3`, `c2753c6`.**

## H17 — Build and production config

**Status: done** (server side).

- Env validated with Zod at boot, failing fast: `config.ts` already refused a production boot holding
  a checked-in `.env.example` placeholder or `CLAMAV_MODE=off`; it now also validates
  `DEVON_ALLOWED_ORIGINS` and the three `TELEGRAM_*` vars, and refuses a production boot with a bot
  token but no webhook secret.
- `trustProxy: true` was already set and is now documented as the reason `req.ip` (rate limits, audit
  rows) and `req.protocol` (HSTS) are correct behind Caddy.
- Secure cookies: `Secure` on both cookies unconditionally.
- Log level: `LOG_LEVEL` defaults to `info`.
- No `console.log` in `src/` except the one deliberate, lint-annotated operator line (H1.1).
- Demo seed and dev endpoints only behind `--demo`: `packages/db/src/seed/cli-demo.ts` is invoked only
  by `scripts/start.mjs --demo`, and `cli-matrix.ts` pins the (NODE_ENV × DEVON_DEMO) truth table.
  `app.instance_settings.is_demo` defaults to `false`.
- `apps/api/src/server.ts` remains the only file in the package that reads `process.env` — the
  Telegram module's three request-time `process.env` reads were moved to the boot-time `Config`.

---

## Requires configuration outside this package

None of these can be made from `apps/api`, `packages/contracts`, `packages/db/migrations`,
`infra/Caddyfile` or the two `apps/web` files this package may edit. Each is stated as the exact
change to make.

1. **Deployment env (`.env` on the ministry box, and `infra/docker-compose.yml`'s `api` service).**
   These are the values the code now validates and refuses to start without; they hold no secret in
   the repo, only in the operator's `.env`:
   - `DEVON_PUBLIC_URL=https://<real host>` — this is now the CORS/Origin allow-list, so it must be
     the real public origin, not a placeholder.
   - `DEVON_ALLOWED_ORIGINS=` — leave empty unless a second origin genuinely serves the app.
   - `TELEGRAM_WEBHOOK_SECRET=` — 32–256 characters of `A-Z a-z 0-9 _ -` from a CSPRNG. Generate with
     `openssl rand -base64 32 | tr '+/' '-_' | tr -d '='`. Required in production whenever
     `TELEGRAM_BOT_TOKEN` is set; the process refuses to boot otherwise.
   - `CLAMAV_MODE=clamd`, `CLAMAV_HOST`, `CLAMAV_PORT` — production boots already refuse `off`; start
     the profile with `docker compose -f infra/docker-compose.yml --profile clamav up -d`.
   - `DEVON_CSP_CONNECT_EXTRA=` — leave empty for `STORAGE_DRIVER=local`. For `STORAGE_DRIVER=s3`, set
     it to the MinIO **public** endpoint (`https://minio.<host>`), because the browser PUTs avatar
     bytes straight to a presigned URL on that origin and the SPA's `connect-src` is otherwise
     `'self'` only.
   - Caddy must be the only ingress: the API binds `0.0.0.0:3000` and trusts `X-Forwarded-*`
     unconditionally (`trustProxy: true`), so port 3000 must not be published to the host or to any
     network the reverse proxy does not own. In `infra/docker-compose.yml`, the `api` service must use
     `expose: ["3000"]`, never `ports:`.

2. **`package.json` (repo root) — the `security:scan` gate has 34 pre-existing false positives.**
   `semgrep --config p/owasp-top-ten` over `apps/`, `packages/`, `infra/` reports 36 findings before
   this package and 34 after (the 2 `gcm-no-tag-length` are fixed, and the CORS and SSRF findings this
   package touched are triaged in place with `nosemgrep` plus the reason and the test that proves
   them). All 34 remaining are
   `javascript.express.security.audit.xss.direct-response-write.direct-response-write` — an Express
   rule about rendering HTML, firing on Fastify's `reply.send(object)`, which serialises JSON through
   a Zod response schema and sets `content-type: application/json`. They are not reachable as XSS:
   the API sets `X-Content-Type-Options: nosniff` and a `default-src 'none'; sandbox` CSP on every
   response. Annotating 34 call sites would be noise; the one-line fix is to exclude the rule for
   this repo. Change `security:scan` to:
   ```
   "security:scan": "semgrep --config p/owasp-top-ten --exclude-rule javascript.express.security.audit.xss.direct-response-write.direct-response-write --error --quiet . && trivy fs --scanners vuln,secret --severity HIGH,CRITICAL --exit-code 1 --quiet ."
   ```
   (or add the same exclusion to a repo-root `.semgrepignore`/`semgrep.yml`, with this paragraph as
   the justification).

3. **`pnpm-workspace.yaml` (repo root) — supply-chain settings Semgrep flags as missing.** Three
   one-line additions, all supported by the pinned pnpm 11.15.0:
   ```yaml
   blockExoticSubdeps: true      # no transitive dep from a git/http/tarball source
   minimumReleaseAge: 10080      # 7 days: never install a package published minutes ago
   trustPolicy: no-downgrade     # an update may not downgrade security settings
   ```
   Left to the owner of that file because changing resolution settings re-resolves the lockfile for
   every worktree at once.

4. **`packages/db/package.json` — `drizzle-kit` upgrade** to drop the deprecated `@esbuild-kit/*`
   chain carrying GHSA-67mh-4wv8-2f99 (moderate, dev-only, not in any production tree). Pin the exact
   new version and re-run `pnpm --filter @devon/db migrate:verify`.

5. ~~**`apps/api/src/server.ts` — process-level `unhandledRejection` / `uncaughtException` handler
   (H16.1).**~~ **No longer external — implemented on the second pass** (`c2753c6`, see H16). It was
   never outside this package's paths; listing it as external was a mistake. `src/lib/fatal.ts` logs
   one structured line and ends the process with status 1, and stays deliberately separate from the
   graceful shutdown sequence (signals, pg-boss stop, in-flight draining), which remains the
   reliability package's to write and composes with this rather than replacing it.

5a. **`infra/maintenance/maintenance.html` — keep it in step with the Caddyfile's two CSP hashes.**
   The maintenance page's inline `<style>` and `<script>` are admitted by sha256 hash (H1.5); editing
   the file invalidates them. A stale hash never breaks the page's text — it still renders and still
   says the service is unavailable — it only disables the language guess and the automatic retry. The
   Caddyfile says in place how to recompute them (the base64 sha256 of each element's exact child
   text content, tag lines excluded, including the newline after the opening tag). The durable fix,
   for whoever owns that file: move both blocks into `maintenance.css` / `maintenance.js` beside it
   and drop the hashes for `'self'` — impossible from this package, which may edit the Caddyfile only.

5b. **`app.users` — a revocable calendar-feed token (H1.15, accepted limitation).**
   `GET /api/v1/notifications/ics/:userId/:token` is public by necessity (a calendar client sends no
   cookie) and the token is `HMAC-SHA256(userId)` under a purpose-scoped derivation of `CSRF_SECRET`
   — CSPRNG-derived, constant-time compared, domain-separated from every other HMAC in the process,
   and not guessable. It is, however, **not revocable**: a subscription URL that leaks (calendar URLs
   reach third-party calendar services, browser history and screen shares) grants that one user's
   upcoming event titles forever, and the only remedy today is rotating `CSRF_SECRET`, which signs
   every session out of the instance. Not fixed here because the fix is a schema change plus UI, both
   outside this package: add `app.users.ics_feed_version integer not null default 1`, include it in
   the HMAC input, and add a "reset my calendar link" control that increments it. The blast radius
   meanwhile is one user's event titles and times — no contact details, no card content — which is
   why it is recorded rather than rushed.

6. **Not implemented, deliberately, with the reasoning recorded:** DOMPurify (no HTML is ever
   injected — H1.5), CSP nonces (the build emits no inline script, so `script-src 'self'` is stronger
   — H1.5), and a Mini App `initData` verifier (the product has no Mini App — H1.14). Each is
   documented in place in the code or the Caddyfile so a future change that invalidates the premise
   is forced to revisit the decision.

---

## Second pass — what changed and why it mattered

The first pass hardened the *perimeter*: headers, CORS, CSRF, redaction, the webhook, the rich-text
schema, the throttle. All of that stands. What it did not do was **run the attack**. Three of its
items were reported `already-met` on the strength of reading the code, and two of those three were
wrong in ways only an executed request could show:

| item | first pass said | what running it showed |
|---|---|---|
| H1.2 object-level access | `already-met` (boot guard + RLS + `can()` unit tests) | 7 of 48 id swaps got through, **2 of them writes** into another department's card |
| H1.6 SSRF unfurling | `already-met` ("resolves DNS itself so a rebinding answer is checked") | the socket was never pinned to the checked answer, so rebinding still worked |
| H1.5 CSP | `done` (API + SPA policies) | the maintenance page, on the same origin, had **no headers at all** |
| gate state | "ok=true, none skipped" | `lint` was red on six files, and one source file was binary to git |

The lesson recorded for the audit that follows this one: for authorisation and for SSRF, reading the
code establishes intent, not behaviour. Both classes of bug live exactly in the gap between the two —
an authorisation check that is correct about the *subject* and silent about the *object*, and a
network filter that validates one resolution and connects with another. Each needed a script that
performs the request and reads the status.

Everything the second pass added is a runnable check, not a claim:

- `pnpm --filter @devon/api idor:prove` — 48 cross-department id swaps, exit 1 on any 2xx, marker
  leak, 400/422 (proved nothing) or 5xx (guard threw uncaught).
- `apps/api/test/unit/link-unfurl.test.ts` — 27 tests, in the `fast` gate.
- `apps/api/test/unit/fatal.test.ts` — 8 tests, in the `fast` gate.
- `caddy validate` plus a live container answering 502 with the full header set.

## Final state

```
$ node agentic/scripts/gate.mjs --profile fast
[gate] typecheck … PASS
[gate] lint … PASS
[gate] unit … PASS
[gate] i18n … PASS
[gate] secrets … PASS
[gate] profile=fast ok=true failed=[] skipped=[]

$ pnpm --filter @devon/db migrate:verify
[migrate:verify] 570/570 checks passed across 6 sections.  PASS

$ pnpm --filter @devon/api idor:prove
idor:prove PASSED -- 48 cross-department id swaps all refused

$ semgrep --config p/owasp-top-ten apps packages infra
total findings: 34
34 javascript.express.security.audit.xss.direct-response-write.direct-response-write
```

`@devon/api` unit tests: 226 (before the package) → 309 (35 files). `@devon/contracts`: 98 → 106.

## Reproduction

```bash
cd .claude/worktrees/hd-security
pnpm install --prefer-offline
node agentic/scripts/gate.mjs --profile fast          # typecheck, lint, unit, i18n, secrets
pnpm --filter @devon/db migrate:verify                # needs Docker; 570/570
pnpm --filter @devon/api idor:prove                   # needs Docker; 48/48 refused
pnpm audit --audit-level=high                         # 0 high/critical
semgrep --config p/owasp-top-ten --quiet --json apps packages infra   # 34 direct-response-write only
pnpm --filter @devon/web build && grep -oE "<script[^>]*>" apps/web/dist/index.html   # one, external

# the maintenance page's headers, against the real Caddyfile with no upstream running
docker run -d --name devon-caddy-check -p 8899:443 \
  -v "$PWD/infra/Caddyfile:/etc/caddy/Caddyfile:ro" \
  -v "$PWD/infra/maintenance:/srv/maintenance:ro" \
  -e DEVON_PUBLIC_URL=localhost caddy:2.10.2-alpine
curl -sk -D - -o /dev/null https://localhost:8899/     # 502 + CSP + HSTS + nosniff + DENY + no-store
docker rm -f devon-caddy-check
```
