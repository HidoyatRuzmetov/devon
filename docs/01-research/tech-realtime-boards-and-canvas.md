# Realtime boards, collaborative pages, and Miro-like canvas

**TL;DR:** Keep boards and lists **server-authoritative**: every write lands in Postgres first, then fans out over **Centrifugo** to subscribed clients on a per-board channel; optimistic UI is a client-side illusion reconciled against a row `version`/`ETag`, never a second source of truth. Card ordering uses **fractional indexing**, not integer positions, so concurrent drags never require renumbering a column. For collaborative pages, **Yjs + a self-hosted Hocuspocus v3 server with Postgres persistence** is the right architecture *when we actually build it*, but for v1 a plain **last-write-wins autosave with version conflict detection** is the correct call at this scale — real simultaneous co-editing of the same page is rare enough that CRDT infrastructure would solve a problem we don't have yet. For the Miro-like retro/brainstorm canvas, **Excalidraw (MIT, genuinely free, self-hostable relay)** is the only option with no licensing risk for a government tool; **tldraw's SDK is proprietary and dev-only by default** — production requires a paid commercial license or a watermark that is a non-starter for an internal ministry product, so it stays a **later-budget option, not a v1 dependency**. **React Flow (xyflow)** stays MIT forever and fits *structured* diagrams (org charts, process flows, mind maps), not freeform sticky-note retros. Board feature depth should mine Trello and Jira for what people actually miss (swimlanes, WIP limits, checklists, quick filters, bulk actions, keyboard-accessible drag-and-drop) while skipping Jira's admin-configuration tax; a **JQL-lite parser** (a few hundred lines, not a query-language framework) covers saved views without the complexity. At our real scale — one department today, a credible path to ~20 ministries later — a small Centrifugo cluster with a Redis or NATS broker comfortably covers presence, typing indicators, and board fan-out; the real scaling risk is sloppy channel naming and full-board snapshots instead of deltas, not raw connection count.

## Methodology note

This report's web-search budget was already exhausted by concurrent research in this session before this dimension's queries could run (the same shared-quota constraint several other reports in this directory flag — see `README.md`). All findings below come from direct `WebFetch` reads of primary sources: centrifugal.dev, docs.yjs.dev, tiptap.dev/hocuspocus, github.com/excalidraw, docs.excalidraw.com, tldraw.dev's own license page, reactflow.dev, atlassian.design's pragmatic-drag-and-drop docs, and liveblocks.io (pattern reference only). Where a fetch 404'd (Hocuspocus's packaged database-extension page, an older tldraw license path, an older React Flow pricing path, a couple of Atlassian sub-pages), the report says so inline rather than silently patching the gap with an unsourced claim.

## 1. Realtime for boards and lists

### 1.1 Event model: server-authoritative Postgres + Centrifugo fan-out

The only architecture worth building for a government system of record is **write-through-the-database, fan-out-after**: a client never pushes a mutation directly to other clients, and Centrifugo never holds state Postgres doesn't already have. Concretely:

1. Client sends a mutation (`PATCH /cards/:id`, `POST /cards/:id/move`) to the API.
2. The API checks `can()` for the acting user, applies the write inside a Postgres transaction, and bumps the row's `version` column.
3. On commit, the API publishes a small event — not the whole row, just `{type, entityId, version, boardId}` plus the fields that changed — to Centrifugo via its HTTP or gRPC publish API.
4. Centrifugo fans the event out to every client currently subscribed to that board's channel.
5. Subscribed clients that don't already hold the new version refetch (or apply the delta if it was included) through the normal TanStack Query cache, exactly like the pattern already adopted in `frontend-architecture-and-sync.md`.

Centrifugo's own architecture description matches this shape directly: it positions itself as a "user-facing PUB/SUB server" where "your application publishes messages via HTTP or gRPC APIs to Centrifugo" and, notably, that "PostgreSQL integration enables transactional state publishing — change events can be published within the same database transaction as business logic, eliminating dual-write complexity" ([centrifugal.dev — architecture overview](https://centrifugal.dev/docs/getting-started/introduction)). Rather than "write to Postgres, then separately call Centrifugo's publish API and hope both succeed," this is a transactional-outbox-friendly pattern where the publish is driven from the same commit — an `outbox_events` table drained by a small worker is the standard, boring way to get this guarantee without two-phase commit.

Centrifugo's **proxy** feature keeps authorization in one place instead of duplicating it into channel-naming conventions. When a client tries to subscribe to `board:{tenant}:{boardId}`, Centrifugo calls back into our own API first: "your backend processes these requests and responds with allow/deny decisions... For a subscribe operation, Centrifugo sends the client ID, user, channel name, and connection metadata to your backend" ([centrifugal.dev/docs/server/proxy](https://centrifugal.dev/docs/server/proxy)). The subscribe-proxy endpoint runs the exact same `can(user, 'board:view', boardId)` check the REST API already runs for `GET /boards/:id` — one authorization function, called from two places, never two independently-maintained rule sets. The same proxy mechanism handles the connect event, pre-subscribing an authenticated user to their personal notification channel (`user:{userId}:notifications`) without a second round trip.

### 1.2 Channel shape

| Channel | Purpose | Who subscribes |
|---|---|---|
| `board:{tenantId}:{boardId}` | Card/list/column CRUD events for one board | Everyone currently viewing that board |
| `board:{tenantId}:{boardId}#presence` (via Centrifugo's built-in presence, not a separate channel) | Who is viewing this board right now | Same |
| `card:{tenantId}:{cardId}:comments` | New comments + typing indicators on one card's detail panel | Users with that card's detail panel open |
| `user:{userId}:notifications` | Personal inbox events (assigned, mentioned, watcher-triggered) | That user only, server-subscribed on connect |

Centrifugo channel names are plain ASCII strings up to 255 characters (configurable via `channel.max_length`), where `:` is the reserved namespace separator and namespace-level config (presence on/off, history size) attaches per namespace, not per literal channel — "a namespace is an inalienable component of the channel name... publishing to `chat` won't reach subscribers of `public:chat`" ([centrifugal.dev/docs/server/channels](https://centrifugal.dev/docs/server/channels)). So the `board:`/`card:` prefixes above should be real Centrifugo namespaces, presence enabled only where needed, not just an application-code convention.

### 1.3 Optimistic updates with version numbers / ETags

Every mutable table carries a `version integer not null default 1` column (or reuses `updated_at` as the concurrency token — a version integer is easier to reason about in application code and easier to expose as an `ETag`/`If-Match` pair over HTTP). The write path:

```sql
UPDATE cards
SET title = $1, version = version + 1, updated_at = now()
WHERE id = $2 AND version = $3
RETURNING *;
```

If the `UPDATE` affects zero rows, the client's `version` was stale — someone else wrote first. The API returns `409 Conflict` with the current row attached, and the client's `onError` handler replaces its optimistic patch with the server's authoritative version rather than retrying blindly. Over HTTP this is naturally expressed with `ETag`/`If-Match`:

```
GET /cards/42          -> 200, ETag: "7"
PATCH /cards/42
  If-Match: "7"
  { "title": "Renamed" }
                        -> 200, ETag: "8"   (success)
                        -> 409, ETag: "9", body: <current card>   (conflict; someone else moved to 9 first)
```

This is the same `onMutate` → optimistic patch → `onError` → rollback pattern already recommended in `frontend-architecture-and-sync.md` §4/§5 for the rest of the app; boards don't need a different mutation pattern, just a different *conflict rule* for the one field that's genuinely concurrent — ordering.

### 1.4 Conflict rules for card moves: fractional indexing

Integer positions (`position = 1, 2, 3…`) force a renumbering write across every card below the drop point whenever a card moves — expensive, and a guaranteed conflict magnet the moment two people drag different cards in the same column at once. The standard fix, used by Figma-adjacent sync engines and by Trello's own successor systems, is **fractional indexing**: store an opaque, lexicographically-sortable string key per card, and generate a new key *between* its new neighbors on move — no other row is touched.

`fractional-indexing` (Rocicorp's implementation, the same team behind the Zero sync engine surveyed in the frontend report) exposes exactly this API:

```js
import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';

generateKeyBetween(null, null);       // "a0"  — first card in an empty list
generateKeyBetween('a0', null);       // "a1"  — append after "a0"
generateKeyBetween(null, 'a0');       // "Zz"  — insert before "a0"
generateKeyBetween('a0', 'a1');       // "a0V" — insert between two existing cards

// Dragging 5 cards into one list at once, without a key per pairwise insert:
generateNKeysBetween('a1', 'a2', 5);  // 5 evenly-spaced keys, shorter than 5x generateKeyBetween calls
```

(API confirmed directly from the package's own README — [github.com/rocicorp/fractional-indexing](https://github.com/rocicorp/fractional-indexing).)

**Conflict rule for a card move, concretely:** the client computes the new key locally (`generateKeyBetween(prevCard.key, nextCard.key)`) and optimistically re-renders the card in its new slot; `PATCH /cards/:id/move { listId, key, version }` carries the *card's* expected version, not the list's — the design decision that avoids false conflicts, since two people dragging *different* cards into the same list must both succeed, and only two people dragging the *same* card actually conflicts. The server writes `list_id = $listId, position_key = $key, version = version + 1 WHERE id = $cardId AND version = $expectedVersion`; because position is a per-card string rather than a per-list integer array, this is a single-row write with no lock contention against other cards in the same list. Whichever `UPDATE` commits second on a genuine same-card race gets a 409, refetches, and the loser's drag silently snaps back — rare enough at our scale that a toast ("Someone else just moved this card") is sufficient UX, not a merge dialog. **Key growth housekeeping:** keys lengthen with heavy reordering at the same position over time, a known fractional-indexing characteristic; a background job that periodically re-keys a list from scratch during low-traffic hours (fresh short `a0, a1, a2…` keys) keeps them bounded without ever blocking a live drag.

### 1.5 Presence: "who is viewing"

Centrifugo's built-in presence is the right primitive here rather than a hand-rolled heartbeat table: "Centrifugo's presence system provides a real-time view of users currently subscribed to that channel," exposed as either a full presence call (every subscriber's client ID, user ID, and attached `info`) or a cheap presence-stats call returning just two counters — client count and unique-user count ([centrifugal.dev/docs/server/presence](https://centrifugal.dev/docs/server/presence)). Subscribing to `board:{tenant}:{boardId}` is what makes a user "present" on that board; no separate presence table is needed. Two caveats from the docs are worth designing around: presence "might increase the load on your Centrifugo server" (enable it only on the `board` namespace, not every namespace by default), and join/leave events are delivered "at most once" — a flaky connection could miss a leave, so the UI should treat presence as "recently active," decaying an avatar after a short silence window rather than trusting a leave event to always arrive.

### 1.6 Typing indicators for comments

Typing indicators are the one place an **ephemeral, non-persisted** publish is correct — there is no Postgres row for "Aziz is typing," and there shouldn't be. The client publishes a lightweight `{type: 'typing', userId}` message directly to the card's comment channel (through a scoped, short-lived client-side publish permission rather than round-tripping the full API), and every other subscriber shows a "typing…" chip that expires client-side after ~3 seconds of silence — no server storage, no history, no version conflict logic needed, because nothing here is a system-of-record fact.

## 2. Collaborative pages: Yjs + Hocuspocus, or plain autosave?

### 2.1 What Yjs actually buys you

Yjs is a CRDT (conflict-free replicated data type) library whose shared types "can be manipulated, fire events when changes happen, and automatically merge without merge conflicts," and critically requires **no central authority for conflict resolution** — documents converge correctly "as long as all changes eventually arrive," regardless of order ([docs.yjs.dev](https://docs.yjs.dev/)). It is explicitly "network agnostic," which makes it a genuine fit for offline-first editing: a client edits fully offline, and reconnecting is the same merge Yjs does for any two divergent update sets, not a special case.

### 2.2 Hocuspocus v3 as the self-hosted server

Hocuspocus is "a suite of tools to bring collaboration to your application," built on top of Yjs, shipping as "a WebSocket backend, which has everything to get started quickly, to integrate Y.js in your existing infrastructure," and runs on plain Node.js (also Bun/Deno/Cloudflare Workers, but self-hosted Node is the right target here) ([tiptap.dev/docs/hocuspocus/introduction](https://tiptap.dev/docs/hocuspocus/introduction)). It confirms it can "sync awareness states" and explicitly supports "offline-first apps" that sync later. Persistence to Postgres runs through Hocuspocus's extension hooks — `onLoadDocument` reads the stored Yjs binary update and applies it to a fresh `Y.Doc`; `onStoreDocument` (debounced) serializes the current state back:

```js
import { Server } from '@hocuspocus/server';
import * as Y from 'yjs';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const server = new Server({
  async onLoadDocument({ documentName, document }) {
    const { rows } = await pool.query(
      'SELECT state FROM page_docs WHERE page_id = $1',
      [documentName],
    );
    if (rows[0]) {
      Y.applyUpdate(document, rows[0].state); // bytea column
    }
    return document;
  },

  async onStoreDocument({ documentName, document }) {
    const state = Y.encodeStateAsUpdate(document);
    await pool.query(
      `INSERT INTO page_docs (page_id, state, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (page_id) DO UPDATE SET state = $2, updated_at = now()`,
      [documentName, Buffer.from(state)],
    );
  },
});

server.listen();
```

(Shape confirmed against Hocuspocus's own documented persistence/extension model, adapted here to a raw `pg` pool rather than the packaged database extension — the packaged `@hocuspocus/extension-database` page itself 404'd during this research, so treat its exact API surface as needing a hands-on spike, while the `onLoadDocument`/`onStoreDocument` hook shape is confirmed from the introduction page.) `documentName` should be namespaced as `page:{tenantId}:{pageId}`, and the `onLoadDocument`/`onAuthenticate` hooks are exactly where the same `can()` check used everywhere else in the API gets enforced before a client opens a socket onto a page's Yjs document at all.

**Awareness and cursors** ride on Yjs's separate Awareness protocol (`y-protocols/awareness`), which Hocuspocus explicitly supports syncing: each client sets an ephemeral local state field — cursor position, selection range, name, color — and every other client renders those live; awareness is never persisted to Postgres, matching the typing-indicator pattern above.

**Offline** for a Yjs-backed page is `y-indexeddb`: a client edits its local `Y.Doc` while disconnected, IndexedDB persists the pending update log, and reconnecting triggers the normal Yjs sync handshake — no special "replay my offline queue" logic, because CRDT merge *is* the replay logic.

### 2.3 The actual v1 recommendation: last-write-wins autosave, not Yjs

This is the one place in this report where the mature, correct-looking technology is **not** the right v1 call. Running a Hocuspocus cluster, wiring Postgres persistence, and testing CRDT merge edge cases is real, ongoing operational surface — justified when *simultaneous* editing of the *same* page is routine, not an edge case. At department scale, and even at eventual 20-ministry scale, the common case for a shared page is **sequential** editing, not two people typing into the same paragraph at once — the same shape `frontend-architecture-and-sync.md` already reached for the rest of the app's data: **last-write-wins per field, server as tiebreaker**, the lesson Figma's own team drew when they rejected pure CRDTs for their canvas as "unnecessarily complex."

**v1 design, concretely:** a page is a single `content` (rich-text JSON or Markdown) column plus `version`; autosave fires on a 2-3s debounce via the same `If-Match: version` pattern as cards (`PATCH /pages/:id { content, version }`); if two people do have the page open at once and one autosaves while the other's tab is stale, the second save gets a `409` and a small, honest "This page changed while you were editing — reload to see the latest, or keep editing to overwrite" choice, rather than silently discarding either side — rare enough at our scale that a manual choice, not automatic merge, is the right failure mode; and a lightweight `page_revisions` table (snapshot on every save) makes "who changed what when" auditable, far simpler than replaying a Yjs update log for the same purpose.

**When to revisit Yjs+Hocuspocus:** the trigger is observable, not speculative — usage data showing two or more users regularly holding the same page open and typing within the same few-second window (a rising count of "my edit got overwritten" tickets, or a decision to build a genuinely collaborative drafting tool) is the point to stand up Hocuspocus for *that specific surface*, the same "reserve CRDTs for genuinely concurrent editing" posture `frontend-architecture-and-sync.md` already recommends, now with a concrete trigger instead of a vague someday.

## 3. Miro-like canvas for retros, brainstorming, and team building

### 3.1 Excalidraw — MIT, self-hostable, the correct default

Excalidraw's GitHub repository confirms it is released under the **MIT license** ([github.com/excalidraw/excalidraw](https://github.com/excalidraw/excalidraw)) — no revenue threshold, no watermark, no field-of-use restriction, which for a government-operated internal tool is the only licensing posture with zero legal ambiguity. Real-time collaboration is handled by a small, separate relay service, **excalidraw-room**, described in its own repository as an "Example of excalidraw collaboration server" built on **Socket.IO**, itself also MIT-licensed, with a Dockerfile and a documented pm2 production config for self-hosting ([github.com/excalidraw/excalidraw-room](https://github.com/excalidraw/excalidraw-room)). It does not persist scene state or run our authorization — it is a bare relay between browsers already holding an end-to-end-encrypted scene — so it should sit *behind* the same `can()` check as everything else, gating who ever receives a room's encryption key, with our own API remaining the source of truth for "this retro board belongs to project X, only its members may join."

For retro/brainstorm/team-building use cases specifically:
- **Sticky notes**: Excalidraw's native rectangle + bound-text elements are already the sticky-note primitive; a small wrapper fixes size/color presets rather than exposing the full freeform toolbar for this mode.
- **Voting dots**: small colored circle elements a user drops onto notes during dot-voting; tallying is a client-side reduce over elements filtered by color/owner — the canvas *is* the vote record, no separate data model needed.
- **Timer**: not a canvas concern — a shared countdown component driven by the same Centrifugo board channel (`{type: 'timer', endsAt}` published once; every client renders a local countdown against that shared timestamp, no per-second chatter).
- **Templates**: Excalidraw's `initialData` prop accepts a pre-built scene (a retro board with "Went well / Didn't go well / Action items" columns as background rectangles) from our own template library, not Excalidraw's gallery.

### 3.2 tldraw — real licensing risk for a government tool

tldraw's own license page is unambiguous and worth quoting precisely because it inverts the usual open-source assumption: **"The tldraw SDK operates under a proprietary license that permits use only in development by default. Production deployment requires one of three licensed options"** ([tldraw.dev/community/license](https://tldraw.dev/community/license)):

1. **Trial License** — free for 100 days, but pings tldraw's servers with a hashed license key for analytics.
2. **Commercial License** — for business/production projects, priced through a sales conversation (possible startup discount).
3. **Hobby License** — free, but *requires displaying a "made with tldraw" watermark on the canvas*, and is explicitly scoped to **non-commercial** projects.

A ministry's internal operations tool is not a hobby project and is not "non-commercial" in the sense that tier is written for, even though it never generates revenue — it is official government software running an official function, which means the Hobby tier's watermark-and-non-commercial terms are the wrong fit and a paid Commercial License (contact-sales pricing, unknown until negotiated) is the honest reading of tldraw's own terms here. That is a procurement decision, not a technical one, and should not be made implicitly by an engineer reaching for tldraw because its drag/resize/multi-select polish is genuinely excellent. tldraw's site separately touts **tldraw sync** — "simultaneous editing... live cursors, viewport following, and cursor chat" — with a self-hostable Multiplayer Starter Kit on Cloudflare Durable Objects ([tldraw.dev](https://tldraw.dev/)), but that kit still ships the same SDK, so the same license applies — self-hosting the sync server does not exempt the app from the SDK's license.

**Recommendation: do not adopt tldraw for v1.** Revisit only with an explicit budget line and a product decision that its UX is worth paying for over Excalidraw's free equivalent; do not ship the Hobby tier's watermark on an official ministry product, and do not treat "we're not charging users" as "non-commercial" without asking tldraw directly.

### 3.3 React Flow (xyflow) — for structured diagrams, not sticky-note retros

React Flow's own FAQ states plainly: **"React Flow is open-source MIT-licensed software, and it will be forever,"** confirming commercial use requires no subscription ([reactflow.dev/pro](https://reactflow.dev/pro)). The paid Pro tiers (Starter $169/mo, Professional $289/mo, Enterprise custom) buy pro example code, prioritized issues, and maintainer support — optional add-ons, never a requirement to ship.

Where it fits differs from Excalidraw's freeform canvas: React Flow is a **node-and-edge graph** library — nodes are typed React components with connection "handles," edges snap between them, and the graph is backed by a structured `{nodes: [], edges: []}` model rather than freeform pixel-positioned shapes. That is the right shape for **org charts** (`data-dense-ui-components.md`), **mind maps**, and **process/approval flow diagrams** (reusing the node/edge model `documents-approvals-and-workflows.md` needs for visualizing routing) — structured, filterable, exportable data, not a scribble. It is the wrong tool for a retro board's freeform stickies-and-dot-voting shape, where Excalidraw's unstructured canvas fits better.

### 3.4 Recommendation summary

| Tool | License | Cost for us | Best fit | Verdict |
|---|---|---|---|---|
| **Excalidraw** | MIT | Free, self-host the relay | Retro boards, brainstorming, freeform stickies, team-building canvases | **Adopt for v1** |
| **tldraw** | Proprietary, dev-only free tier; Hobby = watermark + non-commercial only; Commercial = paid, contact sales | Unknown (sales-negotiated) or watermark (unacceptable) | Same use case as Excalidraw, nicer interaction polish | **Avoid for v1** — revisit only with a budget line |
| **React Flow (xyflow)** | MIT forever | Free (Pro tiers are optional support/examples) | Org charts, mind maps, structured process/approval flow diagrams | **Adopt**, for structured diagrams specifically, alongside Excalidraw |

## 4. Board feature depth: what Trello and Jira got right (and what to skip)

Trello's enduring appeal is that a card is legible in under two seconds — cover, labels, a due-date chip, an avatar stack, a checklist badge — with zero configuration before the first board is usable. Jira's value, once teams outgrow Trello, is filtering and reporting at scale, but its complexity tax (custom-field administration, workflow-scheme configuration, permission-scheme sprawl) is exactly what "Jira's power without Jira's learning curve" needs to refuse. The right feature set borrows Trello's card-level richness and Jira's query/reporting power without importing either's configuration surface:

| Feature | Source | Design note for us |
|---|---|---|
| **Swimlanes** | Jira | Horizontal grouping across columns by assignee, epic, or priority — a view option on the existing board data, not a second data model |
| **WIP limits** | Kanban/Jira | Per-column soft max; column header shows `4/3` in a warning color past the limit, never a hard block — matches the "humane, not punitive" product tone |
| **Card covers / colors** | Trello | Cover image or a solid accent color on the card's top edge; purely presentational, one column on `cards` |
| **Checklists** | Trello | Sub-item list with a progress badge (`3/5`) rendered directly on the card face |
| **Labels** | Trello | Tenant-scoped label table, many-to-many with cards; combine with quick filters below |
| **Due dates** | Both | One `due_at` (+ optional `start_at` for the timeline view below); overdue renders as a distinct color, not just a date string |
| **Watchers** | Jira | Explicit opt-in follow list per card, drives the notification/inbox model from `notifications-telegram-mobile.md` rather than a separate mechanism |
| **Card templates** | Trello (Power-Up) / Jira (issue templates) | A saved card shape (title pattern, checklist, labels) instantiated on "new card from template" — genuinely saves setup time for repeatable task types (e.g., a recurring compliance check) |
| **Quick filters** | Trello | A filter bar (assignee, label, due-date bucket) above the board that narrows visible cards client-side against already-loaded data — instant, no server round trip |
| **Saved views** | Jira | A named, shareable JQL-lite query (see §4.1) plus optional swimlane/grouping choice, stored per user or per board |
| **Bulk move / archive / undo** | Trello + Jira | Multi-select (a toolbar toggle, not a hidden shortcut) then a bulk action bar; archive is a soft `archived_at` timestamp, and every archive/bulk-move shows an "Undo" toast (~8s) that nulls it back out or restores the pre-move `list_id`/`position_key` — cheap since nothing was hard-deleted |
| **Timeline view sharing the same data** | Jira (Timeline/Gantt) | A view, not a separate table: any card with `start_at`/`due_at` renders as a bar; the same `can()` and `version` rules already governing the board view apply unchanged, because it's the same rows |
| **Keyboard-accessible drag-and-drop** | Neither does this well | See §4.2 |

### 4.1 A JQL-lite filter grammar

Full JQL is a large surface (functions, custom fields, `ORDER BY`, nested subqueries) that would reintroduce exactly the complexity this product refuses. A small, purpose-built grammar covering the 90% case — field comparisons, boolean combination, `IN` lists, and quoted text search — is a few hundred lines, not a query-language framework:

```
query      := orExpr
orExpr     := andExpr ( "OR" andExpr )*
andExpr    := term ( "AND" term )*
term       := "NOT" term | "(" orExpr ")" | comparison | freeText
comparison := field operator value
field      := "assignee" | "label" | "list" | "due" | "status" | ...
operator   := "=" | "!=" | "IN" | ">" | "<" | ">=" | "<="
value      := quotedString | word | "(" valueList ")"
freeText   := quotedString          // bare text searches card title/description
```

Example saved-view strings this grammar accepts: `assignee = me AND due < 2026-09-12`, `label IN ("urgent", "blocked") AND list != "Done"`, or a bare `"budget report"` free-text search. Implementation is a hand-written tokenizer (regex-split on quoted strings, operators, parens) feeding a recursive-descent parser that compiles to a parameterized SQL `WHERE` fragment — never string-concatenated, since this runs against the tenant-scoped `cards` table under the same RLS policy as every other query. Saved views persist as `{id, tenant_id, board_id nullable, owner_id, name, query_string, is_shared, grouping}` — a nullable `board_id` supports both per-board filters and a cross-board "everything assigned to me" view.

### 4.2 Keyboard-accessible drag-and-drop, with screen reader announcements

Atlassian's own **pragmatic-drag-and-drop** library is the right reference here — it is the DnD engine behind the current Jira and Trello (Atlassian now owns both), built to replace the older `react-beautiful-dnd`. Its accessibility guidelines explicitly reject arrow-key-based keyboard reordering as the primary pattern: **"Directional arrow movement does not translate well to all experiences"** and carries real implementation overhead; the recommended pattern instead is a **visible menu-based alternative** — a "More actions" (`…`) button or a converted drag-handle icon that opens a menu of concrete move outcomes ("Move to top," "Move to list *Doing*"), with modal-driven forms for moves needing more input than a menu item can express ([atlassian.design — accessibility guidelines](https://atlassian.design/components/pragmatic-drag-and-drop/accessibility-guidelines)). This is also, independently, the better UX for a civil-servant, low-training-budget user base: a discoverable menu beats an undiscoverable keyboard gesture.

For live feedback during and after a move, the same guidelines specify a dedicated live-region announcer:

```js
import { announce } from '@atlaskit/pragmatic-drag-and-drop-live-region';

announce('Task "Prepare quarterly report" moved to list "In review" from "To do".');
```

The guidance is explicit that the announcement must name **the item and both its old and new position**, fire **both during and after** the interaction (not just on drop), and that focus must return to the original trigger element so keyboard users never lose their place in the DOM ([same source](https://atlassian.design/components/pragmatic-drag-and-drop/accessibility-guidelines)). This maps directly onto `wp-a11y-i18n`'s keyboard-walkthrough mandate — a concrete, already-vetted format to hold the build to rather than inventing one from scratch.

## 5. Scaling: from one department to ~20 ministries

The department-scale numbers here are genuinely small — a few dozen concurrent users today, plausibly a few thousand at full 20-ministry adoption — nowhere near where Centrifugo's own architecture needs unusual care. The discipline that matters is **channel naming and payload size**, not raw connection count:

- **Tenant isolation in channel names.** Every channel is prefixed `{namespace}:{tenantId}:{entityId}` (e.g., `board:mindt:4821`), so a ministry's clients can never receive another ministry's events even on a client bug — the tenant segment is part of the channel identity, and Centrifugo's own docs are explicit that "a namespace is an inalienable component of the channel name," so this is structurally enforced, not a convention that can drift.
- **Small payloads, not full-board snapshots.** Publish `{type: 'card.moved', cardId, listId, positionKey, version}`, never the whole board's card array — Centrifugo channels are pub/sub relays, not a database, and the client already holds the rest of the board state in its TanStack Query cache. A full-snapshot publish habit, not connection count, is the realistic way a system like this hits message-size or bandwidth trouble.
- **Clustering for horizontal scale and HA.** Centrifugo "scales horizontally across multiple nodes by... using high-performance PUB/SUB brokers (Redis, Redis Cluster, or NATS) to route messages between nodes" ([centrifugal.dev](https://centrifugal.dev/docs/getting-started/introduction)). A 2-3 node cluster behind a load balancer, backed by a Redis instance already likely present for job queues (`backend-architecture-and-multitenancy.md`), is enough from day one purely for deploy-time HA, not because load requires it — cheap insurance, not premature scaling.
- **Presence cost discipline.** Presence tracking "might increase the load on your Centrifugo server, since Centrifugo need[s] to maintain an addition[al] data structure" ([centrifugal.dev/docs/server/presence](https://centrifugal.dev/docs/server/presence)) — enable it only on board-shaped namespaces, not globally.
- **No documented hard limits found.** The channel docs fetched here publish no numeric caps on channel count, message size, or subscribers per channel — capacity is a function of deployment resources and engine choice (Memory vs. Redis vs. NATS), a non-issue at our order of magnitude; re-verify with a load test before any capacity claim goes into an ADR.

## 6. Testing realtime: two-browser Playwright patterns

Realtime features are exactly the class of bug a single-browser test suite cannot catch — the defect is almost always "works for the person who made the change, breaks for the person watching." The correct Playwright pattern is **two independent `BrowserContext` instances** (not two tabs in one context, which would share cookies/session) driving one shared server:

```ts
import { test, expect } from '@playwright/test';

test('card move is visible to a second viewer in real time', async ({ browser }) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  await loginAs(pageA, 'user.a@example.uz');
  await loginAs(pageB, 'user.b@example.uz');

  await pageA.goto('/boards/42');
  await pageB.goto('/boards/42');

  // User A drags a card from "To do" to "In review"
  await dragCard(pageA, { card: 'Prepare quarterly report', toList: 'In review' });

  // User B, who never touched anything, should see it move without a manual reload
  await expect(
    pageB.locator('[data-list="In review"] [data-card="Prepare quarterly report"]'),
  ).toBeVisible({ timeout: 5000 });

  await contextA.close();
  await contextB.close();
});
```

This same two-context shape covers the rest of this report's realtime surfaces with only the assertion changing: presence (B's avatar appears in A's "viewing" list shortly after B navigates to the board), typing indicators (B types in a comment box, A sees a "typing…" chip that then disappears after the idle window), and collaborative-page awareness if/when Hocuspocus is adopted (B's cursor color/name appears in A's editor). Keep these tests few and high-value — one per realtime surface, not a combinatorial matrix — and run them against a real test-tenant Centrifugo instance rather than a mock, since the point is to catch transport-layer fan-out bugs a mocked WebSocket cannot reproduce.

## What this means for us

1. **[ADOPT] Server-authoritative writes with Centrifugo fan-out**, publish driven from the same Postgres transaction (transactional outbox) — never a client-to-client push, never dual-write drift.
2. **[ADOPT] `version`/`ETag` optimistic concurrency on every mutable row**, `409` + current state on conflict, reusing the `onMutate`/rollback pattern already recommended for the rest of the app.
3. **[ADOPT] Fractional indexing for all card/list ordering**, keyed per-card (not per-list-array), with a periodic background re-key job to bound key-string growth.
4. **[ADOPT] Centrifugo's built-in presence for "who is viewing,"** scoped only to board namespaces, and its proxy/connect/subscribe hooks as the single point where `can()` gates channel access.
5. **[ADOPT] Ephemeral, non-persisted publishes for typing indicators and the retro timer** — no database row, no history, client-side expiry.
6. **[AVOID] Yjs + Hocuspocus for v1 collaborative pages.** Ship last-write-wins autosave with `version`-based conflict detection and a `page_revisions` audit trail instead — simpler, sufficient at our scale, and consistent with the LWW posture already adopted for the rest of the data model.
7. **[ADAPT] Revisit Yjs + self-hosted Hocuspocus v3** (Postgres persistence, Yjs Awareness for cursors, `y-indexeddb` offline) only when usage data shows real simultaneous-editing conflicts — a measurable trigger, not a someday.
8. **[ADOPT] Excalidraw (MIT) for the Miro-like retro/brainstorm canvas**, self-hosting the `excalidraw-room` relay behind our own `can()` check, with sticky notes/voting dots as constrained wrappers over native shapes and templates as pre-built `initialData` scenes.
9. **[AVOID] tldraw for v1.** Proprietary, dev-only by default; production needs either a paid Commercial License (unbudgeted) or a watermarked, non-commercial Hobby tier — neither fits an official ministry product. Revisit only with a budget line.
10. **[ADOPT] React Flow (MIT forever) for structured diagrams** — org charts, mind maps, process/approval flows — sharing one node/edge data model; paid Pro tiers are optional support, never required.
11. **[ADOPT] Trello-style card depth plus Jira-style structure** (covers, checklists, labels, due dates, watchers, templates, swimlanes, WIP limits, saved views, a timeline view on the same data) without Jira's configuration-scheme complexity.
12. **[ADOPT] A hand-written JQL-lite parser** (tokenizer + recursive-descent to a parameterized SQL `WHERE` fragment) for quick filters and saved views — a few hundred lines, not a query-language dependency.
13. **[ADOPT] Soft-delete-backed archive/bulk-move with an "Undo" toast** (~8s) as the default for every destructive-feeling board action, matching this project's "undo over confirm" convention.
14. **[ADOPT] Pragmatic-drag-and-drop's menu-based keyboard alternative and live-region `announce()` pattern** (item, old and new position, during and after the move, focus returned to trigger) as the a11y bar for every drag-and-drop surface, feeding `wp-a11y-i18n`'s keyboard checks.
15. **[ADOPT] A small (2-3 node) Centrifugo cluster with a Redis/NATS broker from day one**, for deploy-time HA rather than current load; tenant-scoped channel naming as structural isolation; delta-shaped publishes, never full-entity snapshots.
16. **[ADOPT] Two-`BrowserContext` Playwright tests, one per realtime surface**, run against a real test-tenant Centrifugo instance — kept few and high-value, not a combinatorial suite.

## Open questions

- **Exact Centrifugo capacity numbers** (connections per node, safe message-rate ceiling) were not published as hard limits in the pages fetched here; load-test against the real deployment target before any capacity claim goes into an ADR.
- **`@hocuspocus/extension-database`'s exact API surface** could not be fetched (404) — the hook shape above is confirmed from Hocuspocus's introduction page, but spike it hands-on before writing it into a TECH-SPEC contract.
- **tldraw's actual Commercial License price** for a government-scale deployment is unknown — pricing is sales-negotiated, not published; get a real quote before comparing it against "free Excalidraw."
- **Whether any ministry's network policy blocks long-lived WebSocket connections** was not something this dimension could check — confirm with whoever owns network/security posture; Centrifugo's SSE/HTTP-streaming fallbacks cover this if needed.
- **The measurable trigger for revisiting Yjs+Hocuspocus** (§2.3) needs a concrete metric owner and threshold once live, not a qualitative "if it becomes a problem."
- **Voting-dot tallying and retro-board data retention** is a product-policy question this report doesn't resolve.

## Sources

- [Centrifugo — architecture / getting started](https://centrifugal.dev/docs/getting-started/introduction)
- [Centrifugo — channels documentation](https://centrifugal.dev/docs/server/channels)
- [Centrifugo — presence documentation](https://centrifugal.dev/docs/server/presence)
- [Centrifugo — proxy documentation](https://centrifugal.dev/docs/server/proxy)
- [Yjs documentation](https://docs.yjs.dev/)
- [Hocuspocus — introduction](https://tiptap.dev/docs/hocuspocus/introduction)
- [Excalidraw (GitHub) — license and repository](https://github.com/excalidraw/excalidraw)
- [excalidraw-room (GitHub) — collaboration relay server](https://github.com/excalidraw/excalidraw-room)
- [Excalidraw developer docs](https://docs.excalidraw.com/)
- [tldraw — SDK license](https://tldraw.dev/community/license)
- [tldraw.dev — product site (sync / multiplayer starter kit)](https://tldraw.dev/)
- [React Flow (xyflow) — Pro/pricing and licensing FAQ](https://reactflow.dev/pro)
- [Atlassian Design — pragmatic-drag-and-drop overview](https://atlassian.design/components/pragmatic-drag-and-drop/about)
- [Atlassian Design — pragmatic-drag-and-drop accessibility guidelines](https://atlassian.design/components/pragmatic-drag-and-drop/accessibility-guidelines)
- [Liveblocks — how Liveblocks works (pattern reference only, not adopted)](https://liveblocks.io/docs/concepts/how-liveblocks-works)
- [fractional-indexing (GitHub, Rocicorp)](https://github.com/rocicorp/fractional-indexing)
- [frontend-architecture-and-sync.md (internal)](./frontend-architecture-and-sync.md)
- [data-dense-ui-components.md (internal)](./data-dense-ui-components.md)
- [documents-approvals-and-workflows.md (internal)](./documents-approvals-and-workflows.md)
- [notifications-telegram-mobile.md (internal)](./notifications-telegram-mobile.md)
- [backend-architecture-and-multitenancy.md (internal)](./backend-architecture-and-multitenancy.md)

*Note: this session's shared WebSearch quota was exhausted before this dimension's research began (12+ queries attempted, all returned "budget used"); every finding above is grounded in direct WebFetch retrieval of primary/official documentation. A handful of sub-pages 404'd during fetching (Hocuspocus's packaged database-extension page, an older tldraw license path, an Atlassian sub-page, Excalidraw's collaboration-specific docs page) — those gaps are called out inline above, not silently patched over.*
