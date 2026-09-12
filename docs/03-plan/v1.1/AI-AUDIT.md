# AI audit — Devon (WorkPortal) v1.1

Read-only audit of every AI feature in `packages/ai` and every place `apps/web` calls one.
Scope: `packages/ai/src/**`, `packages/ai/evals/**`, `apps/api/src/modules/ai/**`,
`apps/web/src/features/ai/**` and the eleven host screens that call
`useRunAiFeatureMutation` / render `SparkleButton` / `AiPreviewPanel`.

Binding references: `docs/03-plan/TECH-SPEC.md` §8, `docs/03-plan/integrations/glm-api-instruction.md`,
`DESIGN.md`, `packages/i18n/TERMS.md`, `agentic/INVARIANTS.md`.

Status: analysis only. No product code was changed by this audit.

---

## 0. Verdict — why it feels random, gray, and "mostly translates to Uzbek"

The CTO is right, and there are four separate causes. None of them is "the model is bad".

**0.1 — Translate is wired to the wrong target language in two of its three real call sites.**
`apps/web/src/features/work/components/card-detail.tsx:247` calls translate with
`{ text: source, locale }` where `locale` is `useLocale()` — *the viewer's own UI language*.
`apps/web/src/features/pages/page-editor.tsx:194` does the same: `translateMutation.mutate({ text, locale })`.
The `translate` feature treats `locale` as the **target**. So a uz-Latn user pressing the sparkle
next to an Uzbek description asks GLM to translate Uzbek → Uzbek, and the prompt
(`packages/ai/src/prompts/translate.ts`) explicitly says *"If the text is already in the target
language, still return it (lightly polished if needed)"*. The observable product behaviour is
literally "it translated my text into Uzbek and nothing happened". Only
`apps/web/src/features/personal/notes-view.tsx:49` gets it right, via a `TRANSLATE_TARGET` map.
There is no target-language picker anywhere.

**0.2 — Three of the four "smart" features are thin wrappers whose best output is thrown away.**

| Feature | Model returns | What the UI keeps |
|---|---|---|
| `quick_add_parse` on `/work` | title, assigneeName, dueDate, priority, labels | everything except `labels` — `quick-add-bar.tsx:125` hard-codes `labels: []` |
| `quick_add_parse` on `/personal` | same five fields | **only `title`** — `use-quick-add-ai.ts:29`, and it is called with `memberNames: []` so the assignee resolution is dead by construction |
| `draft_event` on `/events` | title, description, checklist, pollOptions, carpoolPlan | **only title + description** — `event-form-dialog.tsx:172` `onApply({ title, description })`; the checklist, the poll and the carpool plan are rendered in the preview and then discarded |
| `plan_sprint` on `/projects/view` | ordered plan + focus + reason | **one field patch**: `project-page-screen.tsx:184` sets `priority: 'urgent'` on the focus card. The whole ordering is displayed then dropped |

A civil servant sees a well-formed preview, presses Accept, and almost nothing changes. That is the
exact shape of "feels random".

**0.3 — The features are input-starved, so the model is guessing.**
- `quick_add_parse` has **no `today` field** in its input schema (`packages/ai/src/prompts/quick-add-parse.ts:13`)
  while its system prompt orders the model to *"Resolve relative dates … against today's date"*.
  The model has no date. Every "ertaga"/"juma"/"завтра" is a hallucinated date, or `null`.
- `plan_sprint` gets title + optional `estimateMin`. No due dates, no capacity, no sprint end date,
  no priority, no blockers. It cannot do anything except re-sort by estimate, which is what the
  offline `simulate()` already does for free.
- `weekly_summary` gets three flat `{id,title}` lists. No assignee, no dates, no unit, no overdue
  days, no trend versus last week. It can only produce "3 done, 1 overdue, 2 new" restated in prose.
- `nl_analytics` gets `knownUnits` only. Never `knownLabels`/`knownProjects` (the schema has them;
  `ask-analytics.tsx:38` passes neither) and never the member list, so `assignee:@…` is unreachable.

**0.4 — Two of the ten features have no product surface at all, and the tenth has no head surface.**
`deadline_risk` and `what_did_i_miss` are reachable **only** from the `/ai` → *Yordamchi* tab, where
you type card ids into a textarea by hand (`apps/web/src/features/ai/feature-forms.ts:148,215`).
`weekly_summary` is wired only to the *personal* period screen
(`apps/web/src/features/personal/sprints-view.tsx:274`) and narrates your own to-dos — there is no
head's department briefing anywhere, despite TECH-SPEC §8 promising *"weekly summary per person and
per department (drafts the digest)"* and *"department health narrative for the head"*. The Telegram
weekly department digest (`apps/api/src/modules/notifications/jobs.ts:127-150`) is a hand-built count
string with a hard-coded `Haftalik xulosa / Weekly summary:` literal and never calls `@devon/ai` at all.

**0.5 — "Gray" is also literal.** The `/ai` screen is a budget ring, a number input, and ten
identical toggle rows with no description of what each one does, where it appears, or what it costs
(`apps/web/src/features/ai/ai-settings-screen.tsx:210-247`; evidence:
`agentic/ledger/ui-blitz/2026-09-07T11-25-00-05-00/final/ai__1440__light__uz-Latn.png`).
`featureDescriptionKey()` exists in `apps/web/src/features/ai/types.ts:47` — the descriptions are
already translated in all four locales — and **is never called anywhere**. The Assistant tab is a
raw JSON playground: it prints `JSON.stringify(result.data, null, 2)` in a `<pre>`
(`assistant-panel.tsx:97`) and "Accept" copies that JSON to the clipboard.

**0.6 — Nothing verifies the citation guard rail.** TECH-SPEC §8 requires *"citations (links to
cards/events) in every summary"*. `weekly_summary`, `what_did_i_miss` and `summarize_thread` all
return id arrays, and every prompt file's comment claims *"the caller drops any id in the response
that is not in its own input before rendering"*. No caller does this. `card-detail.tsx:923` uses
`citedCommentIds.length` as a count and never intersects it with the real comment ids;
`sprints-view.tsx:303` ignores `highlightIds` entirely. No summary in the product renders a single link.

---

## 1. Map: feature → prompt → surface

| # | Feature id | Prompt file (`packages/ai/src/prompts/`) | Tool name | Host surface (route) | Verdict |
|---|---|---|---|---|---|
| F1 | `quick_add_parse` | `quick-add-parse.ts` | `emit_quick_add` | `/work` board + column footers (`work/components/quick-add-bar.tsx:63`); `/personal` Today + Tasks (`personal/lib/use-quick-add-ai.ts:17`, `personal/tasks-view.tsx:62`) | Keep, fix inputs |
| F2 | `subtask_breakdown` | `subtask-breakdown.ts` | `emit_subtasks` | `/work/card` checklist (`work/components/card-detail.tsx:702`); `/personal` task row (`personal/tasks-view.tsx:63`) | Keep, best-working feature |
| F3 | `plan_sprint` | `plan-sprint.ts` | `emit_sprint_plan` | `/personal` periods (`personal/sprints-view.tsx:144`); `/projects/view` objective tab (`projects/components/project-page-screen.tsx:114`) | Rebuild |
| F4 | `deadline_risk` | `deadline-risk.ts` | `emit_deadline_risk` | **none** — `/ai` Assistant form only | Rebuild as "explain this risk badge" |
| F5 | `weekly_summary` | `weekly-summary.ts` | `emit_weekly_summary` | `/personal` periods header only (`personal/sprints-view.tsx:145`) | Split: personal recap + head briefing |
| F6 | `draft_event` | `draft-event.ts` | `emit_event_draft` | `/events?new=1` dialog (`events/components/event-form-dialog.tsx:151`) | Keep, apply all fields |
| F7 | `summarize_thread` | `summarize-thread.ts` | `emit_thread_summary` | `/work/card` comments (`card-detail.tsx:898`); `/events` event thread (`events/components/comments-panel.tsx:37`) | Keep, change output shape |
| F8 | `nl_analytics` | `nl-analytics.ts` | `emit_analytics_query` | `/analytics` (`analytics/ask-analytics.tsx:31`) | Keep, must answer with numbers |
| F9 | `translate` | `translate.ts` | `emit_translation` | `/work/card` description (`card-detail.tsx:132`); `/pages` editor selection (`pages/page-editor.tsx:178`); `/personal` notes (`personal/notes-view.tsx:63`) | Fix target locale + terminology |
| F10 | `what_did_i_miss` | `what-did-i-miss.ts` | `emit_missed_digest` | **none** — `/ai` Assistant form only | Merge into F5 |

Backend: one dynamic route `POST /api/v1/ai/features/:feature/run`
(`apps/api/src/modules/ai/index.ts:120`), plus `GET/PATCH /api/v1/ai/settings` and `GET /api/v1/ai/usage`.
`plan_sprint` is the only one whose permission subject is `{kind:'personal'}` (`index.ts:featureRunSubject`).

TECH-SPEC §8 lists **fourteen** features. Four were never built: *smart reminder timing suggestions*,
*duplicate/related card detection*, *retro/feedback summarisation*, *department health narrative for the head*.

---

## 2. Gateway audit (`packages/ai/src/gateway.ts`, `glm-provider.ts`, `budget.ts`, `trim.ts`, `config.ts`)

### 2.1 What is correct today

- **`reasoning_content`**: read off the wire at `glm-provider.ts:151` (`choice.message.reasoning_content ?? null`),
  carried on `ChatCompletionResult.reasoningContent`, and **never** logged, stored, traced, or replayed
  into history. `toWireMessage` never emits it. Correct per TECH-SPEC §8 and the GLM instruction sheet.
- **Empty-content retry**: `gateway.ts:96-126` — if `content` is empty *and* `toolCalls` is empty *and*
  `finish_reason === 'length'`, it doubles `max_tokens` once, capped at `DEFAULT_MAX_MAX_TOKENS = 8192`.
  This is exactly the rule in `glm-api-instruction.md` point 1.
- **`max_tokens ≥ 1024`**: enforced twice — `MIN_MAX_TOKENS = 1024` in `config.ts:26` and re-clamped in
  `gateway.ts:74` (`Math.max(options.maxTokens ?? config.minMaxTokens, config.minMaxTokens)`).
  Per-feature starting points: 1024 (quick-add, deadline-risk, nl-analytics), 1280 (subtasks, plan, missed),
  1536 (weekly, event, thread), 2048 (translate).
- **Schema retry**: one retry carrying `z.prettifyError` back as a `role:'tool'` message (`gateway.ts:150-172`).
- **Transport retries**: `glm-provider.ts:117-176` — one bounded retry for transport failure only; an
  HTTP error status is deliberately *not* retried. `AbortController` + `requestTimeoutMs = 30_000`. Correct.
- **Budget**: `budget.ts` is pure and exhaustively testable. `capUzs <= 0` is an implicit hard stop, so
  a department that has never configured a budget cannot spend. `19_500 UZS` per million matches the sheet.
- **Trace privacy**: `ai_traces` has no content column (`packages/db/migrations/0800_ai.sql:34-46`), and
  `InsertTraceInput` (`apps/api/src/modules/ai/repo.ts`) has no field that could carry prompt text.
- **Trace durability**: `service.ts:runFeatureForActor` writes the trace in its **own** transaction,
  committed before the failure is thrown, so a call that spent tokens and then failed validation is
  still billed. Deliberate and right.
- **Streaming**: there is none, and the UI does not pretend otherwise —
  `packages/ui/src/primitives/ai-preview-panel.tsx:70-80` renders three `Shimmer` lines at decreasing
  width, with an explicit comment refusing a fake token-by-token reveal. This is the honest choice and
  should stay until a real SSE transport exists.

### 2.2 Gateway defects

| id | Where | Problem | Impact |
|---|---|---|---|
| G-1 | `gateway.ts:112-125` | The doubling retry only fires when **both** `content` and `toolCalls` are empty. A *truncated tool call* (`finish_reason: 'length'` with partial `arguments`) fails `JSON.parse` in `extractArguments`, falls straight to the schema-retry path, and retries at the **same** `maxTokens`. | `weekly_summary` / `draft_event` / `summarize_thread` at 1536 tokens will fail twice and bill twice on long inputs. |
| G-2 | `gateway.ts:105-110` | `temperature` is never set. GLM's default sampling is used for ten structured-extraction tasks. | Two identical quick-adds give different labels/priorities. This *is* "feels random", literally. Set `temperature: 0` for F1/F4/F8/F9, ~0.3 for F6. |
| G-3 | `gateway.ts:191` | `reasoningTokens: 0` hard-coded with a comment saying it is not reconstructable. GLM bills reasoning inside `completion_tokens`, so the cost is right, but the UZS-per-answer breakdown a ministry will ask for ("why did a 40-word summary cost 2 100 tokens?") cannot be given. | Budget conversations with the ministry are unanswerable. |
| G-4 | `apps/api/src/modules/ai/service.ts:150` | `canAffordCall()` is exported from `packages/ai` and **never called**. Only `checkBudget` runs, i.e. the hard stop is "have you already exceeded", not "would this call exceed". | The call that crosses the cap always goes through, at up to 8192 tokens. |
| G-5 | `service.ts:126,130` + `repo.ts:InsertTraceInput` | `blocked_flag` and `blocked_budget` are valid trace statuses in the DB enum, the API DTO and the web `Trace` schema — but `runFeatureForActor` throws *before* `insertTrace`, so neither is ever written. | The Usage tab has two status rows (`ai.usage.status.blocked_budget`, `…blocked_flag`, translated in four locales) that can never appear. A head cannot see "people tried and were blocked" — the strongest signal for raising a budget. |
| G-6 | `gateway.ts:159-166` | On schema retry the tool-result message is keyed to `lastToolCalls[0]!.id` regardless of which tool actually matched. | Harmless today (one tool per feature), a latent bug the moment a feature exposes two tools. |
| G-7 | `agentic/gates.json` | The `ai-evals` gate is defined (`blocking_on_release: true`) but appears in **no profile** — not `fast`, `item`, `integration` or `release`. | The golden set has never run in a gate. `packages/ai/evals/cases.ts` has 15 cases and no CI ever executes them. |
| G-8 | `apps/api/src/modules/ai/index.ts:104` | `GET /ai/usage` is `read` on `department_child`, so any member reads every member's traces — including `plan_sprint`, the personal-workspace feature (I-1). | Metadata only (no content), but it reveals who used the private workspace and when. Should be self-only for members, all-rows for head. |
| G-9 | `trim.ts` + `gateway.ts:82` | `marginForReply = requestedMaxTokens * 2` reserved from a 256 000 budget. No feature is anywhere near it. Correct but untested at the boundary for the future multi-turn feature. | Low. |

### 2.3 Mock vs. real key

`createProvider()` (`packages/ai/src/index.ts`) is the only branch: `AI_API_KEY` present → `GlmProvider`,
absent → `MockProvider` wired to `buildOfflineRespond()`, which recovers the typed input from the user
message JSON and calls that feature's `simulate()`. This is a genuinely good design — the whole
pipeline (traces, budget, retry accounting, preview UI) behaves identically either way.

The problem is that for six of the ten features **the offline simulator is nearly as good as the real
model would be given the same starved inputs**, which is why the features read as pointless:

| Feature | Offline `simulate()` | Does a real key change the answer meaningfully? |
|---|---|---|
| F1 quick-add | substring member match + 6 hard-coded date words (`today/bugun/сегодня/tomorrow/ertaga/завтра`) + `/urgent\|zudlik\|shosh\|срочно/` | Yes for Uzbek morphology ("Nodiraga", "jumagacha") — but **no** for dates, because no `today` is supplied to either path. |
| F2 subtasks | splits the description on `[.\n;]` | Yes, clearly. This is the one feature that visibly benefits. |
| F3 plan sprint | sort by `estimateMin` ascending | Barely — with only titles and estimates there is nothing else to reason over. |
| F4 deadline risk | deterministic thresholds (`daysLeft<0 \|\| (≤1 && <80%) \|\| stale>7 → high`) | **No.** The deterministic rule is *better* (auditable, free, instant). Only the prose differs. |
| F5 weekly summary | `"{name}, {period}: 3 card(s) finished, 1 overdue"` | Marginally — same three counts, nicer sentence. |
| F6 draft event | 4 canned checklist items, 3 canned poll options, 1 canned carpool paragraph in **English** | Yes, strongly. The mock is visibly fake here. |
| F7 thread summary | last 3 comments truncated to 80 chars, joined with `\|` | Yes, strongly. |
| F8 nl analytics | 2 regexes + a unit substring match | Yes for Uzbek/Russian phrasings. |
| F9 translate | **returns the input unchanged** | Yes — offline it is a no-op by design. |
| F10 what did I miss | `"Since X: 1 new card(s), 1 comment(s), 1 upcoming event(s)"` | Marginally. |

**Demo risk**: the frozen demo stack (`tools/`, memory note "Management demo stack") runs on the seed
which enables all ten flags with a 2 000 000 UZS budget
(`packages/db/src/seed/modules/ai.ts:27-37,216`). If that box has no `AI_API_KEY`, the CTO pressed
sparkle buttons and got the table above — English canned event checklists, an un-translated
"translation", and count-restating summaries. **Confirm which provider the demo box ran** before
attributing any of this to GLM.

---

## 3. Feature-by-feature

Each section: (1) what it does today, (2) what a member or head actually wants, (3) the complete v1.1
prompt specification, (4) UI expectations.

Conventions used by every v1.1 spec below:

- **Language constraint (shared)** — replaces `localeInstruction()`:
  > Write every human-readable string in {LOCALE_NAME}. For `uz-Latn` you MUST use the characters
  > `oʻ` and `gʻ` (U+02BB modifier letter turned comma), never `o'`/`g'`/`ў`/`ғ`. Use the department
  > vocabulary exactly: vazifa (task), topshiriq (assignment from a superior), muddat (deadline),
  > boʻlim (unit), xodim (employee), tadbir (event), boshqarma boshligʻi (head). Never translate a
  > JSON key or an enum literal.
  (source: `packages/i18n/TERMS.md`, `packages/i18n/terms.json`; a `normalize-uz.ts` already exists in
  `packages/i18n/src` and must be run over every model string before it is shown.)
- **Anti-fabrication constraint (shared)**:
  > Every person, card, date and number in your answer must appear in the input you were given.
  > If you cannot ground a statement, omit it. Never invent an id. Never invent a date.
- **Citation constraint (shared, for F4/F5/F7/F8/F10)**:
  > Reference cards by their `id` from the input, inside the dedicated id field. Never write a raw id
  > into prose — the client renders the link.
- **Uncertainty**: every v1.1 schema that guesses adds `confidence: 'high'|'medium'|'low'` plus a
  `notes` string, so the UI can render a "check this" chip instead of silent wrongness.

---

### F1 — `quick_add_parse`

#### (1) Today

**File**: `packages/ai/src/prompts/quick-add-parse.ts`.

**Input schema**: `{ locale, text ≤500, memberNames: string[] ≤200 }`. **No date, no label list,
no project list, no timezone.**

**System prompt** (verbatim, with the member branch shown for the non-empty case):
> You turn one free-typed sentence into structured department-board card fields. The sentence may be
> in Uzbek (Latin or Cyrillic), Russian, or English, and may mix a name, a task, a relative date word,
> and an urgency cue in any order. The only valid assignees are: {names}. Never invent a name that is
> not in this list. Resolve relative dates (today/tomorrow/a weekday name in any of the three source
> locales) against today's date. The title must be the task itself with the name and date words
> removed, kept in its original language. {localeInstruction} Call emit_quick_add exactly once.

**Output schema**: `{ title, assigneeName: string|null, dueDate: 'YYYY-MM-DD'|null, priority: none|low|medium|high|urgent, labels: string[] ≤8 }`.

**Where the output goes**:
- `/work` — `quick-add-bar.tsx:112` previews title/assignee/due/priority in a `<dl>`;
  `acceptAi()` at line 118 creates the card but passes **`labels: []`**, discarding the model's labels.
  Assignee is re-resolved client-side against the member list (`resolveAiAssignee`, exact full-name or
  given-name match, case-insensitive) — good hallucination guard, but it silently drops
  "Nodiraga"/"Nodira K." style answers.
- `/personal` — `use-quick-add-ai.ts` and `tasks-view.tsx` keep **`title` only**, and pass
  `memberNames: []`, so the prompt's own no-member branch fires: *"No member list was given — always
  return assigneeName: null."* An LLM round trip whose entire product effect is stripping a date word.

**Before/after the user sees**: types into the quick-add input → presses sparkle → three shimmer lines →
a 4-row definition list → Accept creates a card. The non-AI local grammar parse
(`work/lib/quick-add.ts`) already shows assignee + due as a hint row below the same input, so for the
`"Nodira: EGDI paketi, juma"` shape the AI adds nothing at all.

**Mock vs. real**: mock does substring member matching and six hard-coded date words, so `ertaga`
works offline and `juma`/`пятница` does not. With a real key it still cannot resolve `juma`,
because **neither path is told today's date**. This is a correctness bug, not a prompt weakness.

#### (2) What people actually want

Typing `Nodira: EGDI paketi juma` or `Nodiraga EGDI paketini jumagacha tayyorlashni topshir, shoshilinch`
should produce, in one keystroke:

- assignee = Nodira Karimova (resolved, with her avatar shown, and a "not sure" state if ambiguous),
- title = "EGDI paketi" (clean, in the original language, without the name or the date),
- due = the **actual next Friday** in Asia/Tashkent,
- priority = urgent (from "shoshilinch"),
- labels = existing department labels only, e.g. `EGDI`,
- project = the existing project if one is named,
- and a per-field confidence, so the two fields it guessed are the two fields highlighted for review.

It must never invent a label or a project that does not exist, and it must never silently drop a field.

#### (3) v1.1 prompt specification

**Role**
> You are the quick-add parser for a ministry department's work board in Uzbekistan. You convert one
> free-typed sentence into structured card fields. You never create anything; a person reviews and
> accepts your answer.

**Inputs** (fetched by `quick-add-bar.tsx` from data already in the React Query cache — no new API call):

```ts
{
  locale: 'uz-Latn'|'uz-Cyrl'|'ru'|'en',
  text: string,                                  // ≤ 500
  today: string,                                 // 'YYYY-MM-DD' in Asia/Tashkent   ← NEW, required
  weekStartsOn: 1,                               // Monday                          ← NEW
  members: { userId, fullName, givenName, handle }[],   // ≤ 200  ← replaces memberNames
  labels:   { id, name }[],                      // ≤ 100, from useLabelsQuery()    ← NEW
  projects: { id, title }[],                     // ≤ 50,  from useProjectsQuery()  ← NEW
  defaultAssigneeUserId: string|null             // the board column's owner        ← NEW
}
```

**Instructions**
1. Identify the task itself and write it as `title`, in the sentence's own language, imperative or
   noun-phrase, with the person's name, the date words and the urgency words removed.
2. Resolve a person: match against `members` on full name, given name, handle, or any Uzbek case
   suffix of the given name (`-ga`, `-ni`, `-dan`, `-ning`, `-da`) and Russian dative/accusative
   (`Анвару`, `Нодиру`). Return that member's `userId`. If two members match equally, return `null`
   and list both in `ambiguous`.
3. Resolve a date against `today` (Asia/Tashkent, week starts Monday): `bugun/сегодня/today`;
   `ertaga/завтра/tomorrow`; `indinga`; weekday names in uz-Latn/uz-Cyrl/ru/en meaning *the next
   occurrence*, where `jumagacha`/`к пятнице`/`by Friday` = that same date; `keyingi hafta`; explicit
   `DD.MM`, `DD/MM`, `YYYY-MM-DD`. If no date is expressed, return `null`. **Never guess a date.**
4. Priority: `shoshilinch/zudlik bilan/срочно/urgent/ASAP` → `urgent`; `muhim/важно/important` →
   `high`; otherwise `none`.
5. Labels: only ids from `labels` whose name appears in the text (case- and suffix-insensitive).
   Never a new label.
6. Project: only an id from `projects`.
7. Confidence per guessed field, and one short `notes` sentence naming what you were unsure about
   (empty string if nothing).

**Constraints**: shared language + anti-fabrication constraints above. Additionally:
`title` MUST NOT contain the assignee's name or the date phrase. `dueDate` MUST be ≥ `today`
unless the text explicitly says a past date.

**Output JSON schema** (`emit_quick_add`)

```jsonc
{
  "type": "object", "additionalProperties": false,
  "required": ["title","assigneeUserId","dueDate","priority","labelIds","projectId","confidence","ambiguous","notes"],
  "properties": {
    "title":          { "type": "string", "minLength": 1, "maxLength": 500 },
    "assigneeUserId": { "type": ["string","null"] },
    "dueDate":        { "type": ["string","null"], "pattern": "^\\d{4}-\\d{2}-\\d{2}$" },
    "priority":       { "type": "string", "enum": ["none","low","medium","high","urgent"] },
    "labelIds":       { "type": "array", "maxItems": 8,  "items": { "type": "string" } },
    "projectId":      { "type": ["string","null"] },
    "confidence": {
      "type": "object", "additionalProperties": false,
      "required": ["assignee","dueDate","priority"],
      "properties": {
        "assignee": { "type": "string", "enum": ["high","medium","low"] },
        "dueDate":  { "type": "string", "enum": ["high","medium","low"] },
        "priority": { "type": "string", "enum": ["high","medium","low"] }
      }
    },
    "ambiguous": { "type": "array", "maxItems": 5, "items": { "type": "string" } },
    "notes":     { "type": "string", "maxLength": 200 }
  }
}
```

Server-side post-validation (in `runFeature`, not only in the client): `assigneeUserId ∈ members`,
`labelIds ⊆ labels`, `projectId ∈ projects`, else coerce to `null`/`[]` and downgrade confidence.

**Few-shot examples** (embed two in the system prompt, the rest in the golden set)

```
today = 2026-09-12 (Saturday), members = [Nodira Karimova, Anvar Aliyev], labels = [EGDI, hisobot]

in : "Nodira: EGDI paketi juma"
out: title "EGDI paketi", assignee Nodira, dueDate 2026-09-18, priority none,
     labelIds [EGDI], confidence {assignee high, dueDate high, priority high}, notes ""

in : "Anvarga hisobotni indinga tayyorlashni topshir, shoshilinch"
out: title "Hisobotni tayyorlash", assignee Anvar, dueDate 2026-09-14, priority urgent,
     labelIds [hisobot], notes ""

in : "Поручить Анвару подготовить отчёт к пятнице"
out: title "Подготовить отчёт", assignee Anvar, dueDate 2026-09-18, priority none, labelIds [hisobot]

in : "Prepare the quarterly report"
out: title "Prepare the quarterly report", assignee null, dueDate null, priority none,
     confidence {assignee high, dueDate high, priority high}, notes ""

in : "Karimovaga yuborish"        // two Karimovas in the department
out: assigneeUserId null, ambiguous ["Nodira Karimova","Dilnoza Karimova"],
     confidence.assignee "low", notes "Ikki xodimning familiyasi mos keldi"
```

**Golden-set evaluation cases** (extend `packages/ai/evals/cases.ts`)

| id | asserts |
|---|---|
| `quick-add.uz-latn.weekday-suffix` | `jumagacha` with `today=2026-09-12` → `dueDate === '2026-09-18'` |
| `quick-add.uz-latn.dative-name` | `Nodiraga` → `assigneeUserId === nodira.userId` |
| `quick-add.uz-cyrl.basic` | Cyrillic input → correct assignee + `title` stays Cyrillic |
| `quick-add.ru.dative` | `Анвару` → Anvar |
| `quick-add.en.no-date` | `dueDate === null`, never a fabricated date |
| `quick-add.any.no-invented-label` | `labelIds ⊆ input.labels` |
| `quick-add.any.title-excludes-name` | title does not contain the assignee's given name |
| `quick-add.uz-latn.ambiguous` | two same-surname members → `assigneeUserId === null`, `ambiguous.length === 2` |
| `quick-add.uz-latn.orthography` | every string in the output is free of `o'` / `g'` (ASCII apostrophe) |
| `quick-add.determinism` | same input run 3× at `temperature: 0` → identical output |

#### (4) UI expectations

- **Affordance**: stays where it is — `SparkleButton` to the right of the quick-add `Input`
  (`quick-add-bar.tsx:163`), and at each board column footer in `compact` size. Add `Ctrl/⌘+Enter`
  as the keyboard path (today only the click works), and register `work.quickAdd.ai` in the Ctrl+K palette.
- **Preview**: not a definition list of strings — an **editable inline card**. Assignee as an
  `Avatar` + `MemberPicker` (already imported in `card-detail.tsx`), due as a `DatePicker`, priority as
  a `Select`, labels as `Chip`s with `labelChipColors`. Any field whose `confidence` is not `high`
  gets an `attention`-tone underline and is focused first on Tab. `notes` renders as one muted line.
- **Accept / Edit / Discard**: Accept creates the card with **all** fields including `labelIds` and
  `projectId` (fix `quick-add-bar.tsx:125`). Edit puts focus in the preview's first low-confidence
  field, it does **not** clear the preview. Discard clears and restores the typed text, so nothing is lost.
- **Empty**: sparkle disabled while the input is empty (already correct, line 168).
- **Error**: keep the `AiPreviewPanel` error state; add a specific message for a `forbidden` problem
  that names the reason — flag off vs. budget exhausted — instead of today's single
  `ai.errors.forbidden` ("Bu funksiya oʻchirilgan yoki byudjet tugagan").
- **Offline**: if `navigator.onLine === false`, hide the sparkle and show the local grammar hint only.
- **Cost line**: `{tokens} token · {ms} ms` is not meaningful to a civil servant. Show
  `≈ {n} soʻm · {ms} ms` using `formatUzs`, matching the budget gauge's own unit. (Applies to all ten features.)

---

### F2 — `subtask_breakdown`

#### (1) Today

**File**: `packages/ai/src/prompts/subtask-breakdown.ts`.
**Input**: `{ locale, cardTitle, cardDescription?, existingSubtasks[], targetCount = 6 }`.
**System prompt** (verbatim):
> You break one work-board card into a checklist of concrete, independently-completable subtasks.
> Each subtask is a short imperative phrase (a verb first), never a restatement of the whole card
> title, and never a subtask that is already in the existing list you are given. Aim for about
> {targetCount} subtasks. {localeInstruction} Call emit_subtasks exactly once.

**Output**: `{ subtasks: string[1..20] }`. 1280 max tokens.

**Where it goes**: `/work/card` checklist — `card-detail.tsx:702-745`; Accept de-duplicates
case-insensitively against existing items and appends them all with `Promise.all`
(`acceptSubtasks`, `card-detail.tsx:731`). `/personal` — `tasks-view.tsx:63`, appended as child tasks.

**Before/after**: sparkle in the `Field` action slot next to "Roʻyxat (2/5)" → bulleted preview →
Accept appends. This is the one feature that works end to end as designed.

**Mock vs. real**: mock splits the description on `[.\n;]`, or emits
`Prepare: X / Execute: X / Review and close: X` — visibly English and visibly fake. A real key is a
large improvement.

#### (2) What people actually want

Given "EGDI paketini tayyorlash", a member wants 5–7 steps that reflect **how this ministry actually
works**: gather data from the boʻlim, draft, internal review, boshliq approval, submit to the
ministry portal, archive. They want an owner suggestion and a rough estimate per step, and they want
to tick off the ones they do not need before accepting, not accept all seven and delete two.

#### (3) v1.1 prompt specification

**Role**
> You break one work item of a ministry department into an ordered checklist of concrete steps. You
> know how Uzbek government office work runs: data is gathered from the boʻlim, a draft is written,
> it is reviewed internally, the boshqarma boshligʻi approves it, then it is submitted and archived.

**Inputs**

```ts
{
  locale, cardTitle,
  cardDescription: string|null,
  existingSubtasks: string[],            // never repeat these
  labels: string[],                      // card's labels, as domain hints   ← NEW
  projectTitle: string|null,             // ← NEW
  dueInDays: number|null,                // ← NEW, so steps can be sized
  targetCount: number                    // default 6
}
```

**Instructions**
1. Produce `targetCount ± 2` steps in the order they must be done.
2. Each step: a verb-first phrase, ≤ 80 characters, one deliverable, independently tickable.
3. Never restate the card title. Never duplicate (even paraphrased) anything in `existingSubtasks`.
4. Give each step `estimateMin` (15/30/60/120/240) — a working estimate, not a promise.
5. Mark `needsApproval: true` on any step that requires the boshliq's sign-off.
6. If `cardDescription` is empty and the title is too vague to break down (< 4 words, no verb),
   return **one** step asking for the missing detail and set `insufficientInput: true`.

**Constraints**: shared language + anti-fabrication. Never name a person. Never invent a deadline.

**Output JSON schema** (`emit_subtasks`)

```jsonc
{
  "type":"object","additionalProperties":false,
  "required":["subtasks","insufficientInput"],
  "properties":{
    "subtasks":{"type":"array","minItems":1,"maxItems":20,"items":{
      "type":"object","additionalProperties":false,
      "required":["text","estimateMin","needsApproval"],
      "properties":{
        "text":{"type":"string","minLength":1,"maxLength":120},
        "estimateMin":{"type":"integer","enum":[15,30,60,120,240]},
        "needsApproval":{"type":"boolean"}
      }}},
    "insufficientInput":{"type":"boolean"}
  }
}
```

**Few-shot**

```
in : cardTitle "EGDI paketini tayyorlash", labels ["EGDI"], dueInDays 5
out: [
  {"text":"Boʻlimlardan EGDI koʻrsatkichlari boʻyicha maʼlumot yigʻish","estimateMin":120,"needsApproval":false},
  {"text":"Maʼlumotlarni jadvalga jamlash va tekshirish","estimateMin":60,"needsApproval":false},
  {"text":"Paket loyihasini yozish","estimateMin":240,"needsApproval":false},
  {"text":"Ichki koʻrib chiqish uchun yuborish","estimateMin":30,"needsApproval":false},
  {"text":"Boshqarma boshligʻi tasdigʻini olish","estimateMin":60,"needsApproval":true},
  {"text":"Vazirlik portaliga yuklash","estimateMin":30,"needsApproval":false}
], insufficientInput false

in : cardTitle "Hisobot", cardDescription null
out: [{"text":"Qaysi hisobot va qaysi davr uchun ekanini aniqlashtirish","estimateMin":15,"needsApproval":false}],
     insufficientInput true
```

**Golden-set cases**

| id | asserts |
|---|---|
| `subtasks.uz-latn.egdi` | 4–8 steps, none equal to the title, every `text` verb-first |
| `subtasks.uz-latn.no-duplicate` | with `existingSubtasks` given, no output step matches one case-insensitively |
| `subtasks.uz-latn.vague` | `cardTitle: "Hisobot"`, no description → `insufficientInput === true`, exactly 1 step |
| `subtasks.ru.report` | output strings are Russian when `locale: 'ru'` |
| `subtasks.any.no-person` | no output step contains a member name from a supplied list |
| `subtasks.uz-latn.orthography` | no ASCII `'` in any Uzbek Latin string |

#### (4) UI expectations

- **Affordance**: unchanged — `SparkleButton` in the checklist `Field`'s action slot. Add a second
  entry point on an **empty** checklist: replace the bare "Add an item" input with an empty-state line
  *"Roʻyxat boʻsh — AI 6 ta qadam taklif qilsinmi?"* and the sparkle inline (DESIGN.md: every empty
  state offers a way forward).
- **Preview**: each suggested step is a **checkbox row, pre-checked**, with its `estimateMin` as a
  muted suffix and a small lock/approval icon when `needsApproval`. The user unchecks what they don't
  want. Accept appends only the checked rows. Today it is a non-interactive bulleted list and Accept
  takes all of them (`card-detail.tsx:736`).
- **Edit**: inline-editable row text (a `Textarea` swap as in `tasks-view.tsx:407` is acceptable, but
  per-row editing is better).
- **Empty/insufficient**: when `insufficientInput` is true, do not show Accept — show the single
  clarifying question and a "Tavsifni toʻldirish" button that focuses the description textarea.
- **Cost line**: `≈ {n} soʻm · {ms} ms`.

---

### F3 — `plan_sprint`

#### (1) Today

**File**: `packages/ai/src/prompts/plan-sprint.ts`.
**Input**: `{ locale, sprintKind: '3h'|'day'|'week'|'custom', goal?, tasks: {title, estimateMin?}[] }`.
**System prompt** (verbatim):
> You help one person plan their personal {sprintKind} sprint. You are given their open to-dos
> (title + optional time estimate in minutes) and an optional goal. Reorder the exact same set of task
> titles into a sensible working order (do not invent, drop, merge, or rename any task) and name the
> single task they should start with. Keep scheduleNote to one or two short sentences explaining the
> ordering logic. {localeInstruction} Call emit_sprint_plan exactly once.

**Output**: `{ orderedTaskTitles: string[], focusTaskTitle: string|null, scheduleNote }`.

**Where it goes**:
- `/personal` periods (`sprints-view.tsx:210-272`): Accept maps titles back to ids by **exact string
  match** and calls `reorderTasks`. Unmatched tasks are appended in their original order — a
  reasonable guard, but a single renamed title silently reorders nothing.
- `/projects/view` objective tab (`project-page-screen.tsx:149-189`): calls it with
  `sprintKind: 'day'` and `goal: project.title` (a category error — the project title is not a sprint
  goal), then **Accept only sets `priority: 'urgent'` on the focus card** and discards the whole plan.

**Mock vs. real**: the mock sorts by `estimateMin` ascending. With only titles and estimates, a real
model has no additional information to reason with, so the answers differ mostly in prose.
Note the offline `scheduleNote` is hard-coded **English** and will appear verbatim in an Uzbek UI.

#### (2) What people actually want

"Bugungi rejam" should look at what is actually open, what is due, how long the period has left, and
say: *do these five, in this order, because these two are due tomorrow and this one is blocking
Nodira; the other four will not fit — move them to next week*. It must be honest about capacity
(the word the CTO used: "propose an ordered plan **with reasons**"), and on the project screen it
must plan **the project's cards**, including who they are assigned to.

#### (3) v1.1 prompt specification

Split into two callers of one feature, distinguished by `scope`.

**Role**
> You plan one working period. You are given the open items, their deadlines and estimates, and how
> much working time is left in the period. You order them, you say which will not fit, and you give
> one short reason per decision. You never invent an item and you never move a deadline.

**Inputs**

```ts
{
  locale,
  scope: 'personal' | 'project',                 // ← NEW
  periodKind: '3h'|'day'|'week'|'custom',
  periodEndsAt: string,                          // ISO ← NEW
  now: string,                                   // ISO, Asia/Tashkent ← NEW
  capacityMin: number,                           // working minutes left in the period ← NEW
  goal: string|null,
  items: {
    id: string,                                  // ← NEW: ids, not titles
    title: string,
    estimateMin: number|null,
    dueAt: string|null,                          // ← NEW
    priority: 'none'|'low'|'medium'|'high'|'urgent',  // ← NEW
    assigneeName: string|null,                   // project scope only ← NEW
    blockedByIds: string[]                       // ← NEW (from card links)
  }[]
}
```

**Instructions**
1. Order **every** item by id. Never drop, merge, rename or invent one.
2. Respect `blockedByIds`: a blocker always precedes what it blocks.
3. Everything overdue or due before `periodEndsAt` comes before anything that is not.
4. Within the same urgency, put a short item first when it unblocks momentum, but never let a short
   item push a due item past its deadline.
5. Sum `estimateMin` down the order; the items past `capacityMin` go into `wontFitIds` — they stay in
   `orderedIds` too, just flagged. Set `overCommittedByMin` to the overflow (0 if none).
6. `focusId` = the single item to start now.
7. One `reason` per item, ≤ 90 characters, naming the concrete cause ("ertaga muddati tugaydi",
   "Nodiraning ishini bloklayapti"). Never generic filler.
8. `summary`: two sentences max — what this period is really about and the one risk.

**Constraints**: shared language + anti-fabrication + citation. In `scope: 'project'`, you may name
an assignee only if their name appears in `items[].assigneeName`.

**Output JSON schema** (`emit_sprint_plan`)

```jsonc
{
  "type":"object","additionalProperties":false,
  "required":["orderedIds","focusId","reasons","wontFitIds","overCommittedByMin","summary"],
  "properties":{
    "orderedIds":{"type":"array","minItems":1,"maxItems":100,"items":{"type":"string"}},
    "focusId":{"type":["string","null"]},
    "reasons":{"type":"array","maxItems":100,"items":{
      "type":"object","additionalProperties":false,
      "required":["id","reason"],
      "properties":{"id":{"type":"string"},"reason":{"type":"string","maxLength":120}}}},
    "wontFitIds":{"type":"array","maxItems":100,"items":{"type":"string"}},
    "overCommittedByMin":{"type":"integer","minimum":0},
    "summary":{"type":"string","minLength":1,"maxLength":400}
  }
}
```

Server-side post-validation: `set(orderedIds) === set(items[].id)` exactly; `focusId ∈ orderedIds`;
`wontFitIds ⊆ orderedIds`; every `reasons[].id ∈ orderedIds`. Fail the run rather than render a
partial plan — this is a case where a schema-valid but unfaithful answer is worse than an error.

**Few-shot**

```
now 2026-09-12T09:00+05, periodEndsAt 2026-09-12T18:00+05, capacityMin 420
items:
  t1 "Xatlarga javob berish"        est 20   due null        prio none
  t2 "Choraklik hisobotni yozish"   est 240  due 2026-09-13  prio high
  t3 "Yigʻilish"                    est 60   due 2026-09-12  prio none
  t4 "Sayt matnini tahrirlash"      est 180  due null        prio low
out:
  orderedIds [t3,t2,t1,t4], focusId t3,
  reasons [
    {t3,"Bugun belgilangan vaqtda oʻtadi"},
    {t2,"Ertaga muddati tugaydi, 4 soat kerak"},
    {t1,"Qisqa, hisobotdan keyin sigʻadi"},
    {t4,"Muddati yoʻq, keyingi kunga qoldirsa boʻladi"}],
  wontFitIds [t4], overCommittedByMin 80,
  summary "Bugungi kun choraklik hisobotga qaratilgan. Sayt matni bugun sigʻmaydi — ertaga rejalashtiring."
```

**Golden-set cases**

| id | asserts |
|---|---|
| `plan.personal.day.faithful` | `set(orderedIds) === set(inputIds)`, no extras, no losses |
| `plan.personal.day.due-first` | the item due tomorrow precedes every item with no deadline |
| `plan.personal.blocked` | `t_blocker` precedes `t_blocked` when `blockedByIds` says so |
| `plan.personal.capacity` | sum of estimates past `capacityMin` → those ids in `wontFitIds`, `overCommittedByMin > 0` |
| `plan.personal.fits` | total under capacity → `wontFitIds === []`, `overCommittedByMin === 0` |
| `plan.project.assignee-grounded` | no reason names a person absent from the input |
| `plan.uz-latn.reasons-localised` | every `reason` is Uzbek Latin with correct `oʻ`/`gʻ` |
| `plan.any.one-reason-per-item` | `reasons.length === orderedIds.length` |

#### (4) UI expectations

- **Affordance**: `/personal` — the `SparkleButton` on each active period card stays
  (`sprints-view.tsx:477`). `/projects/view` — move it out of the objective tab's header row into the
  project header next to the progress ring, labelled "Rejani tuzish".
- **Preview**: an ordered list where each row shows the title, the reason as a muted second line, and
  a running time total in the gutter. The items in `wontFitIds` render **below a divider** labelled
  *"Bu davrga sigʻmaydi ({n} daqiqa ortiqcha)"* in `attention` tone. `focusId` gets the existing
  `Badge tone="attention"` focus chip.
- **Accept**: `/personal` — reorder by **id** (drop the fragile title matching at
  `sprints-view.tsx:256-266`) and offer, as a single secondary action in the same panel,
  "Sigʻmaydiganlarni keyingi davrga koʻchirish". `/projects/view` — Accept must reorder the cards,
  not silently set one card to urgent (`project-page-screen.tsx:184`).
- **Edit**: drag to reorder inside the preview; reasons stay attached.
- **Empty**: today `runPlanAi` toasts `personal.ai.planSprint.emptyBucket` when the bucket is empty
  (`sprints-view.tsx:218`) — that is fine, but the sparkle should be `disabled` instead of toasting.
- **Error**: on a faithfulness failure (ids don't match), show *"Reja toʻliq chiqmadi — qayta urinib
  koʻring"* and Retry, never a partial order.

---

### F4 — `deadline_risk`

#### (1) Today

**File**: `packages/ai/src/prompts/deadline-risk.ts`.
**Input**: `{ locale, cardTitle, dueDate, today, checklistTotal, checklistDone, daysSinceUpdate }`.
**System prompt** (verbatim):
> You assess whether one work-board card is at risk of missing its deadline, from its due date,
> checklist progress, and how long it has sat untouched. Be specific and numeric in the explanation
> (days left, percent done) — never vague hand-waving. suggestedAction is one short, concrete next
> step, not a lecture. {localeInstruction} Call emit_deadline_risk exactly once.

**Output**: `{ riskLevel: low|medium|high, explanation ≤600, suggestedAction ≤300 }`.

**Where it goes**: **nowhere**. No `apps/web` file references `deadline_risk` outside
`feature-forms.ts:148`. The only way to run it is `/ai` → Yordamchi → fill in six fields including
"Bugun (YYYY-MM-DD)" and "Oxirgi yangilanishdan necha kun oʻtdi" **by hand**.

Meanwhile the board already computes a deterministic risk badge server-side —
`apps/api/src/modules/work/repo.ts:41` `computeRisk()` → `none | at_risk | overdue`, rendered with
`RISK_BADGE_TONE`/`RISK_LABEL_KEY` (`work/lib/format.ts`). The AI feature and the badge have
different vocabularies (`low/medium/high` vs `none/at_risk/overdue`) and never meet.

**Mock vs. real**: the mock's threshold rule is *better than the model* — auditable, free, instant,
and consistent. A model adds nothing to the classification; it can only add the explanation.

#### (2) What people actually want

Not a second risk classifier. What a member wants, seeing the red "Muddati oʻtgan" badge on a card,
is to click it and be told **why this specific card is stuck and what to do next**: *"3 kun oldin
muddati tugadi, roʻyxatning 1/4 qismi bajarilgan, 10 kundan beri hech kim tegmagan. Nodira bilan
bugun gaplashing yoki muddatni 19-sentabrga koʻchiring."* — with the "koʻchiring" as a button.
A head wants the same thing across the board: *which five cards are actually going to slip*.

#### (3) v1.1 prompt specification — rename to "explain this risk badge"

Keep the feature id `deadline_risk` (traces and the flags row are already keyed by it) but change the
contract: the **level is computed deterministically by the server** and passed *in*; the model only
explains and recommends. This removes the one thing the model is worse at and keeps the thing it is
better at.

**Role**
> You explain, in one short paragraph, why a specific work item is at risk of missing its deadline,
> and you propose exactly one next step. The risk level has already been decided; do not change it,
> do not second-guess it.

**Inputs**

```ts
{
  locale,
  card: {
    id, title,
    riskLevel: 'none'|'at_risk'|'overdue',      // ← computed by computeRisk(), passed in
    dueDate: string|null, today: string,
    checklistTotal: number, checklistDone: number,
    daysSinceUpdate: number,
    assigneeName: string|null,                  // ← NEW
    commentCount: number,                       // ← NEW
    blockedByTitles: string[],                  // ← NEW
    similarSlippedCount: number                 // ← NEW: how many of this assignee's last 10 cards slipped
  }
}
```

**Instructions**
1. Open with the single most decisive fact (days overdue, or the stall, or the blocker) — never a
   restatement of all inputs.
2. Give exact numbers. Never a percentage you did not compute from `checklistDone/checklistTotal`.
3. `suggestedAction`: one of the five actions the UI can actually perform, chosen by `actionKind`,
   plus its human phrasing. Never propose something the product cannot do.
4. If `blockedByTitles` is non-empty, the blocker is the reason; say so.
5. Never blame a person. Describe the card's state, not the assignee's character.

**Constraints**: shared language + anti-fabrication. `riskLevel` in the output MUST equal the input's.
Never mention `similarSlippedCount` as a judgement about the person — use it only to raise urgency.

**Output JSON schema** (`emit_deadline_risk`)

```jsonc
{
  "type":"object","additionalProperties":false,
  "required":["riskLevel","headline","explanation","actionKind","actionLabel","actionPayload"],
  "properties":{
    "riskLevel":{"type":"string","enum":["none","at_risk","overdue"]},
    "headline":{"type":"string","minLength":1,"maxLength":90},
    "explanation":{"type":"string","minLength":1,"maxLength":500},
    "actionKind":{"type":"string","enum":["move_due_date","ping_assignee","split_into_subtasks","reassign","mark_blocked","none"]},
    "actionLabel":{"type":"string","minLength":1,"maxLength":80},
    "actionPayload":{
      "type":"object","additionalProperties":false,
      "required":["suggestedDueDate"],
      "properties":{"suggestedDueDate":{"type":["string","null"],"pattern":"^\\d{4}-\\d{2}-\\d{2}$"}}}
  }
}
```

**Few-shot**

```
in : riskLevel "overdue", title "Choraklik hisobot", dueDate 2026-09-01, today 2026-09-08,
     checklist 1/4, daysSinceUpdate 10, assigneeName "Nodira Karimova", blockedByTitles []
out: headline "7 kun kechikdi va 10 kundan beri harakat yoʻq",
     explanation "Muddat 1-sentabrda tugagan. Roʻyxatning 4 tadan 1 tasi bajarilgan, oxirgi oʻzgarish 10 kun oldin. Bu holatda muddatni koʻchirmasdan yopish qiyin.",
     actionKind "move_due_date", actionLabel "Muddatni 15-sentabrga koʻchirish",
     actionPayload {suggestedDueDate "2026-09-15"}

in : riskLevel "at_risk", blockedByTitles ["Vazirlik javobini kutish"]
out: headline "Boshqa vazifa tomonidan bloklangan",
     actionKind "mark_blocked", actionLabel "Bloklangan deb belgilash", actionPayload {suggestedDueDate null}

in : riskLevel "none", checklist 4/4, daysSinceUpdate 1
out: actionKind "none", actionLabel "Hozircha chora kerak emas"
```

**Golden-set cases**

| id | asserts |
|---|---|
| `risk.echo-level` | output `riskLevel === input riskLevel` for all three levels |
| `risk.overdue.numbers` | explanation contains the real day count and the real `1/4` |
| `risk.blocked.actionKind` | `blockedByTitles` non-empty → `actionKind === 'mark_blocked'` |
| `risk.none.no-action` | `riskLevel: 'none'` → `actionKind === 'none'` |
| `risk.move-date.future` | `suggestedDueDate > today` whenever `actionKind === 'move_due_date'` |
| `risk.no-blame` | explanation does not contain the assignee's name in a judgemental construction (blocklist check) |
| `risk.uz-latn.orthography` | correct `oʻ`/`gʻ` |

#### (4) UI expectations

- **Affordance**: the risk `Badge` on the card detail header and on the board card becomes a
  **button** with a sparkle glyph; pressing it opens a popover. This is the single highest-value
  placement in the product — it puts AI exactly where the user is already worried.
- **Preview**: headline bold, explanation as one paragraph, and the recommended action as a real
  primary `Button` wired to the existing mutation (`patchCard` with `dueAt`, `toggleWatcher`, the
  subtask sparkle, `MemberPicker`). This is the one AI surface where "Accept" should *be* the action,
  not a copy step.
- **Accept/Edit/Discard**: Accept = perform `actionKind`, with `toastWithUndo` (DESIGN.md: undo over
  confirm). Edit = open the underlying field (date picker, member picker) pre-filled with
  `actionPayload`. Discard = close.
- **Empty**: cards with `risk: 'none'` show no button at all.
- **Error**: fall back to the deterministic badge tooltip, which always works. The AI is additive here.
- **Head view**: a board-level "Qaysi vazifalar kechikadi?" that runs this over the top N at-risk
  cards in **one** call (batched input, array output) rather than N calls — see §4, new feature N-2.

---

### F5 — `weekly_summary`

#### (1) Today

**File**: `packages/ai/src/prompts/weekly-summary.ts`.
**Input**: `{ locale, scope: 'person'|'department', subjectName, periodLabel, doneCards[], overdueCards[], newCards[] }`
where each list is `{id, title}[]`.
**System prompt** (verbatim, person branch):
> You write a short, warm, specific weekly digest narrative for one person named "{subjectName}"
> covering {periodLabel}, from three lists of cards (done, overdue, new — each item has an id and a
> title). Mention concrete card titles, never invent a card that is not in one of the three lists.
> highlightIds must only ever contain ids copied verbatim from the input lists — never an id you made
> up. If all three lists are empty, say plainly that nothing happened this period; never fabricate
> activity. {localeInstruction} Call emit_weekly_summary exactly once.

**Output**: `{ narrative ≤1500, highlightIds: string[] ≤30 }`.

**Where it goes**: only `/personal` → periods header (`sprints-view.tsx:274-313`). `scope` is
hard-coded `'person'`, `subjectName` is the literal `personal.ai.weeklySummary.subjectSelf`, and the
three "card" lists are actually **personal to-dos** (`overdueCards` = open tasks of ended periods).
Accept creates a **note** (`createNote`). `highlightIds` is parsed off the response and **never used**.

`scope: 'department'` is never called from anywhere in `apps/web`.

**Before/after**: a sparkle labelled "Haftalik xulosa" in the periods header → one paragraph → Accept
saves a note. A head gets nothing. The Telegram Friday department digest
(`apps/api/src/modules/notifications/jobs.ts:127`) builds its own count string and does not call AI.

**Mock vs. real**: the mock produces `"{name}, {period}: 3 card(s) finished, 1 overdue, 2 new."` —
which is, honestly, most of the information the real model has to work with.

#### (2) What people actually want

The CTO named it: **a head's Monday briefing**. Not counts. Something like:

> Oʻtgan hafta boʻlim 14 ta vazifani yopdi (oldingi haftaga nisbatan +3). Ikkita xavf bor: EGDI paketi
> 5 kun kechikdi va 9 kundan beri harakat yoʻq; sayt yangilanishi Anvarda qoldi, uning ustida hozir
> 9 ta ochiq vazifa bor — boʻlimdagi eng koʻp yuk. Nodira 6 ta vazifani muddatida yopdi. Shu hafta
> uchta muddat tugaydi: …

Concretely a head needs: what closed, what slipped and why, **who is overloaded**, what is due this
week, and one or two links per claim. A member needs a lighter version of the same about themselves.

#### (3) v1.1 prompt specification — split into two shapes of one feature

**Role**
> You write the Monday briefing for the head of a ministry department in Uzbekistan, from last week's
> work data. You are factual and short. You name risks plainly and you name who carries too much. You
> never praise or criticise a person's character — only the state of the work.

**Inputs** (a new read in `apps/api/src/modules/ai/service.ts`, or better a small
`buildWeeklyBriefingInput()` in the analytics module reusing its existing aggregates):

```ts
{
  locale,
  scope: 'person'|'department',
  subjectName: string,
  period: { start: 'YYYY-MM-DD', end: 'YYYY-MM-DD' },
  counts: { done: number, doneLastPeriod: number, created: number, overdue: number },   // ← NEW trend
  done:     { id, title, assigneeName, closedOn }[],                 // ≤ 60
  overdue:  { id, title, assigneeName, dueDate, daysOverdue, daysSinceUpdate }[],  // ≤ 40 ← NEW fields
  dueThisWeek: { id, title, assigneeName, dueDate }[],               // ≤ 40 ← NEW
  loadPerPerson: { name, openCount, overdueCount }[],                // ← NEW, from analytics loadPerPerson
  eventsAhead: { id, title, startsAt, rsvpYes, rsvpTotal }[]         // ← NEW
}
```

**Instructions**
1. Structure the answer into exactly four short blocks and return them as separate fields — never one
   wall of prose: `headline`, `wins`, `risks`, `lookingAhead`.
2. `headline`: one sentence with the closed count **and the trend versus `doneLastPeriod`**.
3. `risks`: at most three, ranked by `daysOverdue` then `daysSinceUpdate`. Each cites a `cardId`.
4. `overloaded`: name at most two people from `loadPerPerson` whose `openCount` is ≥ 1.5× the median.
   Phrase it as workload, never as performance.
5. `lookingAhead`: the deadlines and events in the next seven days, at most four.
6. Every factual claim carries at least one id in the block's `citedIds`. A block with nothing to cite
   must be omitted (empty array + empty text), not padded.
7. If every list is empty, set `headline` to a plain "no activity" sentence and leave all other fields empty.

**Constraints**: shared language + anti-fabrication + citation. Never compute a percentage that is not
derivable from `counts`. Never mention a person absent from `loadPerPerson`/`assigneeName`.
`scope: 'person'` omits `overloaded` entirely.

**Output JSON schema** (`emit_weekly_summary`)

```jsonc
{
  "type":"object","additionalProperties":false,
  "required":["headline","wins","risks","overloaded","lookingAhead"],
  "properties":{
    "headline":{"type":"string","minLength":1,"maxLength":220},
    "wins":  {"type":"object","additionalProperties":false,"required":["text","citedIds"],
              "properties":{"text":{"type":"string","maxLength":400},
                            "citedIds":{"type":"array","maxItems":6,"items":{"type":"string"}}}},
    "risks": {"type":"array","maxItems":3,"items":{
              "type":"object","additionalProperties":false,"required":["cardId","text","severity"],
              "properties":{"cardId":{"type":"string"},
                            "text":{"type":"string","minLength":1,"maxLength":300},
                            "severity":{"type":"string","enum":["high","medium"]}}}},
    "overloaded":{"type":"array","maxItems":2,"items":{
              "type":"object","additionalProperties":false,"required":["name","openCount","text"],
              "properties":{"name":{"type":"string"},"openCount":{"type":"integer"},
                            "text":{"type":"string","maxLength":200}}}},
    "lookingAhead":{"type":"object","additionalProperties":false,"required":["text","citedIds"],
              "properties":{"text":{"type":"string","maxLength":400},
                            "citedIds":{"type":"array","maxItems":6,"items":{"type":"string"}}}}
  }
}
```

Server-side post-validation: every `citedIds` entry and every `risks[].cardId` must be in the input id
set; every `overloaded[].name` must be in `loadPerPerson`; strip anything else and log a
`schema_invalid_after_retry`-adjacent metric.

**Few-shot**

```
in : scope "department", subjectName "Raqamli xizmatlar boshqarmasi",
     counts {done 14, doneLastPeriod 11, created 9, overdue 3},
     overdue [{c9,"EGDI paketi","Nodira",2026-09-05,5,9}],
     loadPerPerson [{"Anvar",9,2},{"Nodira",4,1},{"Dilnoza",3,0}],
     dueThisWeek [{c21,"Sayt matni","Anvar",2026-09-16}]
out: headline "Oʻtgan hafta 14 ta vazifa yopildi — oldingi haftaga nisbatan uchtaga koʻp.",
     wins {text "Nodira choraklik hisobotni muddatida topshirdi.", citedIds [c3,c7]},
     risks [{cardId c9, severity "high",
             text "EGDI paketi 5 kun kechikdi va 9 kundan beri oʻzgarmagan."}],
     overloaded [{name "Anvar", openCount 9,
                  text "Anvarda 9 ta ochiq vazifa bor — boʻlim oʻrtachasidan ikki baravar koʻp."}],
     lookingAhead {text "Shu hafta bitta muddat tugaydi: sayt matni, 16-sentabr.", citedIds [c21]}
```

**Golden-set cases**

| id | asserts |
|---|---|
| `weekly.dept.cites-only-given` | every id in every `citedIds` and `risks[].cardId` ∈ input ids |
| `weekly.dept.trend` | headline contains the correct delta when `done > doneLastPeriod` |
| `weekly.dept.overloaded-grounded` | `overloaded[].name ∈ loadPerPerson`, `openCount` matches exactly |
| `weekly.dept.risk-order` | risks sorted by `daysOverdue` desc |
| `weekly.dept.empty` | all lists empty → `risks === []`, `overloaded === []`, headline says nothing happened |
| `weekly.person.no-overloaded` | `scope: 'person'` → `overloaded === []` |
| `weekly.ru.locale` | Russian output for `locale: 'ru'` |
| `weekly.uz-latn.orthography` | correct `oʻ`/`gʻ` |

#### (4) UI expectations

- **Affordance (new, head)**: a card at the top of `/` (Bosh sahifa) for the head only —
  *"Dushanba brifingi"* with a sparkle, auto-offered on Monday, runnable any day. This is the missing
  head surface and the highest-value new placement after F4.
- **Affordance (member)**: keep the periods-header sparkle on `/personal`, relabel to
  *"Haftalik shaxsiy xulosa"*.
- **Preview**: four labelled blocks, not a paragraph. Each risk row is a link to the card
  (`/work/card?id=…`) with a `Badge` for severity. Each `overloaded` row links to
  `/work/mine?assignee=…`. This is where the citation guard rail finally becomes visible.
- **Accept**: head → "Boʻlimga yuborish" posts it as an inbox notification to the department (and,
  if their Telegram digest preference is on, replaces the count string in
  `notifications/jobs.ts:146`). Member → keep "save as a note".
- **Edit**: per-block textareas, not one blob (today `weeklyDraft` is a single `Textarea`,
  `sprints-view.tsx:404`).
- **Empty**: if `counts.done === 0 && overdue === 0 && created === 0`, do not call the model at all —
  render the empty state locally and save the money. (Same rule for F10.)
- **Cost line**: `≈ {n} soʻm`. A weekly briefing at 1536 tokens is ~30 soʻm; showing that is what
  makes a 2 000 000 UZS monthly budget legible.

---

### F6 — `draft_event`

#### (1) Today

**File**: `packages/ai/src/prompts/draft-event.ts`.
**Input**: `{ locale, idea ≤500, category? }` (category enum: team_building, sports, volunteering,
social, training, family, other).
**System prompt** (verbatim):
> You turn one short event idea (category: {category}) into a complete draft: a title, a friendly one-
> or two-paragraph description, an organiser checklist (venue/invites/headcount/etc, 4-8 items), 2-5
> poll options for scheduling it (dates or times, not yes/no), and a short carpool coordination plan.
> This is always a draft the organiser reviews and edits before anything is sent — be concrete and
> specific to the idea given, never generic filler. {localeInstruction} Call emit_event_draft exactly once.

**Output**: `{ title, description ≤2000, checklist[] ≤20, pollOptions[] ≤10, carpoolPlan ≤600 }`.

**Where it goes**: `/events?new=1` → `AiDraftAssistant` (`event-form-dialog.tsx:140-245`). The preview
renders all five fields. `apply()` (line 171) calls `onApply({ title, description })` — **the
checklist, poll options and carpool plan are shown and then thrown away.** There is a copy line
`events.form.aiDraftFollowUp` acknowledging this, which is worse than fixing it. Also: `onEdit` is
bound to the same `apply` function as `onAccept` (lines 209-210), so "Tahrirlash" and
"Qabul qilish" do exactly the same thing.

**Mock vs. real**: mock returns four English checklist items, three English poll options and an
English carpool paragraph regardless of locale. In an Uzbek demo this reads as broken.

#### (2) What people actually want

Type *"Chorvoqda kuz sayli"* and get a **complete, creatable event**: title, a description someone
would actually send, a real date/time proposal grounded in the calendar (next Saturday, not "This
Friday"), a location string, a duration, a poll with three concrete dated options, an organiser
checklist that becomes the event's checklist, and a carpool plan that becomes the carpool seats
config — all editable, then one "Tadbirni yaratish" that creates the whole thing.

#### (3) v1.1 prompt specification

**Role**
> You draft a department event for a ministry in Tashkent. You produce something the organiser can
> send with one edit, not a template. You know the local rhythm: the working week is Monday–Friday,
> team outings are usually Saturday, Chorvoq/Charvak and Bostanliq are the standard weekend
> destinations, and transport is arranged by whoever has a car.

**Inputs**

```ts
{
  locale,
  idea: string,
  category: 'team_building'|'sports'|'volunteering'|'social'|'training'|'family'|'other'|null,
  today: string,                       // 'YYYY-MM-DD' Asia/Tashkent  ← NEW
  departmentSize: number,              // ← NEW, so headcount advice is real
  recentEventTitles: string[]          // ≤ 10, so it doesn't propose last month's picnic again ← NEW
}
```

**Instructions**
1. `title` ≤ 60 characters, no marketing tone.
2. `description`: 2–4 sentences. What it is, where, what to bring. No exclamation marks, no emoji.
3. `dateOptions`: 2–4 **real dates** computed from `today`, each with a start time and a duration in
   minutes. For `team_building`/`social`/`family`, prefer Saturdays; for `training`, working days.
4. `location`: a concrete place name if the idea names one, otherwise `null` — never a placeholder.
5. `checklist`: 4–8 organiser steps, verb-first, specific to this event.
6. `carpool`: `{ needed: boolean, note }` — `needed` true only when the location is outside Tashkent.
7. `estimatedAttendees`: a number ≤ `departmentSize`.
8. Never repeat a title from `recentEventTitles`.

**Constraints**: shared language + anti-fabrication. Never invent a price, a bus, or a permission you
were not told about. Never name a person.

**Output JSON schema** (`emit_event_draft`)

```jsonc
{
  "type":"object","additionalProperties":false,
  "required":["title","description","location","dateOptions","checklist","carpool","estimatedAttendees"],
  "properties":{
    "title":{"type":"string","minLength":1,"maxLength":120},
    "description":{"type":"string","minLength":1,"maxLength":1200},
    "location":{"type":["string","null"],"maxLength":200},
    "dateOptions":{"type":"array","minItems":2,"maxItems":4,"items":{
      "type":"object","additionalProperties":false,
      "required":["date","startTime","durationMin","label"],
      "properties":{"date":{"type":"string","pattern":"^\\d{4}-\\d{2}-\\d{2}$"},
                    "startTime":{"type":"string","pattern":"^\\d{2}:\\d{2}$"},
                    "durationMin":{"type":"integer","minimum":30,"maximum":1440},
                    "label":{"type":"string","maxLength":80}}}},
    "checklist":{"type":"array","minItems":4,"maxItems":8,"items":{"type":"string","maxLength":200}},
    "carpool":{"type":"object","additionalProperties":false,"required":["needed","note"],
      "properties":{"needed":{"type":"boolean"},"note":{"type":"string","maxLength":400}}},
    "estimatedAttendees":{"type":"integer","minimum":1,"maximum":500}
  }
}
```

**Few-shot**

```
in : idea "Chorvoqda kuz sayli", category "team_building", today 2026-09-12 (Sat), departmentSize 18
out: title "Chorvoqda kuzgi sayr",
     description "Boʻlim jamoasi bilan Chorvoq suv omborida bir kunlik dam olish. Ertalab yigʻilib chiqamiz, tushlik tabiatda. Oʻzingiz bilan issiq kiyim va sport oyoq kiyimini oling.",
     location "Chorvoq suv ombori",
     dateOptions [
       {date 2026-09-19, startTime "09:00", durationMin 480, label "19-sentabr, shanba"},
       {date 2026-09-26, startTime "09:00", durationMin 480, label "26-sentabr, shanba"},
       {date 2026-10-03, startTime "09:00", durationMin 480, label "3-oktabr, shanba"}],
     checklist ["Chorvoqda joy band qilish","Xodimlar sonini aniqlash","Ovqat va suv rejasini tuzish",
                "Transportni tashkil qilish","Taklifnomani yuborish","Ob-havo prognozini tekshirish"],
     carpool {needed true, note "Chorvoq shahardan tashqarida — mashinasi borlardan necha joy boʻshligini soʻrang va qolganlarni yaqin yashovchi haydovchilarga biriktiring."},
     estimatedAttendees 14
```

**Golden-set cases**

| id | asserts |
|---|---|
| `event.uz-latn.chorvoq` | `dateOptions` all Saturdays, all `> today`, `carpool.needed === true` |
| `event.uz-latn.training` | `category: 'training'` → `dateOptions` on Mon–Fri |
| `event.any.real-dates` | every `date` parses and is in the future |
| `event.any.no-repeat` | title differs from every `recentEventTitles` entry |
| `event.any.attendees-bounded` | `estimatedAttendees <= departmentSize` |
| `event.ru.locale` | Russian strings for `locale: 'ru'` |
| `event.uz-latn.orthography` | correct `oʻ`/`gʻ`, no `o'` |
| `event.any.no-emoji` | no emoji codepoint in description |

#### (4) UI expectations

- **Affordance**: keep the dashed-border AI block on the Basics step (`event-form-dialog.tsx:174`),
  but also offer it at the top of an empty `/events` list ("Gʻoya yozing — AI tadbir loyihasini tuzadi").
- **Preview**: the five blocks as **editable form fields already in event shape** — the date options
  render as selectable radio chips that populate the event's poll; the checklist as checkbox rows;
  carpool as a toggle + note.
- **Accept**: creates/fills the **whole** event — title, description, location, duration, the poll
  with the chosen date options, the checklist, and the carpool config. Fix `apply()`
  (`event-form-dialog.tsx:171`) to stop dropping three of five fields.
- **Edit** must not be the same handler as Accept (fix lines 209-210). Edit = keep the panel open and
  make fields editable; Accept = apply.
- **Empty**: sparkle disabled with an empty idea (already correct).
- **Error**: `events.form.aiDraftFailed` + Retry (already correct).
- **Remove** the `events.form.aiDraftFollowUp` copy that apologises for dropping fields.

---

### F7 — `summarize_thread`

#### (1) Today

**File**: `packages/ai/src/prompts/summarize-thread.ts`.
**Input**: `{ locale, cardTitle, comments: {id, author, text}[1..500] }`.
**System prompt** (verbatim):
> You summarise a long card comment thread: what was decided, what is still open, and who committed
> to what. Keep it to a few sentences. citedCommentIds must only ever contain ids copied verbatim from
> the comments you were given — pick the ones that most directly support your summary (typically the
> decisive or most recent ones), never an id you made up. {localeInstruction} Call emit_thread_summary
> exactly once.

**Output**: `{ summary ≤1500, citedCommentIds: string[1..50] }`.

**Where it goes**:
- `/work/card` comments (`card-detail.tsx:898-950`). Accept **posts the summary as a new comment**
  (`addComment.mutateAsync({ text: summary.text })`) — an AI-written comment enters the thread
  attributed to the human who pressed the button, with no marker that it was generated. That is a
  governance problem in a ministry audit trail.
- `/events` thread (`comments-panel.tsx:25-92`). Accept inserts into the compose box (better). But:
  **no flag check and no budget check** here — unlike every other call site, `ThreadSummary` never
  reads `useAiSettingsQuery()`, so the button renders even when the head has the feature off. The
  server still refuses, so the user gets an error instead of a hidden button. Also `onEdit` and
  `onAccept` are the same handler (lines 76-82).

The prompt already asks for the right three things (decisions, open questions, commitments) but the
output is a single `summary` string, so none of them can be rendered distinctly.

**Mock vs. real**: the mock concatenates the last three comments truncated to 80 chars — obviously fake.

#### (2) What people actually want

Open a 30-comment card and get three lists, not a paragraph: **what was decided**, **what is still
open**, **who promised what by when** — each line clickable to the comment it came from. Plus, for a
head skimming, one line of "bu yerda sizdan nima kutilmoqda".

#### (3) v1.1 prompt specification

**Role**
> You read a work discussion in a ministry department and extract its outcome. You separate what was
> decided from what is still open from what someone committed to. You quote nothing; you attribute
> everything to a comment id.

**Inputs**

```ts
{
  locale,
  subject: { kind: 'card'|'event', id: string, title: string },   // ← NEW: events are first-class
  viewerName: string,                                             // ← NEW, for "what's expected of you"
  comments: { id, author, text, createdAt }[]                     // ← createdAt NEW
}
```

**Instructions**
1. `decisions`: statements the thread settled. Each cites 1–2 comment ids. If nothing was decided,
   return an empty array — never manufacture a decision.
2. `openQuestions`: things asked and not answered, or explicitly deferred. Each cites the comment
   that raised it.
3. `commitments`: `{ who, what, byWhen|null, commentId }` — `who` must be an `author` string from the
   input, exactly. `byWhen` only if a date or day was actually stated; otherwise `null`.
4. `forViewer`: one sentence naming what `viewerName` is expected to do next, or `""` if nothing.
5. Order every array by the `createdAt` of its citing comment.
6. Never summarise tone or mood. Never editorialise.

**Constraints**: shared language + anti-fabrication + citation. Every `commentId` MUST be from the
input. `who` MUST be an exact `author` value. Never translate a name.

**Output JSON schema** (`emit_thread_summary`)

```jsonc
{
  "type":"object","additionalProperties":false,
  "required":["decisions","openQuestions","commitments","forViewer"],
  "properties":{
    "decisions":{"type":"array","maxItems":8,"items":{
      "type":"object","additionalProperties":false,"required":["text","commentIds"],
      "properties":{"text":{"type":"string","minLength":1,"maxLength":300},
                    "commentIds":{"type":"array","minItems":1,"maxItems":3,"items":{"type":"string"}}}}},
    "openQuestions":{"type":"array","maxItems":8,"items":{
      "type":"object","additionalProperties":false,"required":["text","commentId"],
      "properties":{"text":{"type":"string","minLength":1,"maxLength":300},
                    "commentId":{"type":"string"}}}},
    "commitments":{"type":"array","maxItems":10,"items":{
      "type":"object","additionalProperties":false,"required":["who","what","byWhen","commentId"],
      "properties":{"who":{"type":"string","maxLength":200},
                    "what":{"type":"string","minLength":1,"maxLength":250},
                    "byWhen":{"type":["string","null"],"pattern":"^\\d{4}-\\d{2}-\\d{2}$"},
                    "commentId":{"type":"string"}}}},
    "forViewer":{"type":"string","maxLength":250}
  }
}
```

**Few-shot**

```
comments:
  k1 Anvar   "Sentabr raqamlari boʻyicha kelishdik — 14 ta xizmat."
  k2 Nodira  "Yakuniy PDF-ni ertaga yuboraman."
  k3 Dilnoza "Vazirlik shaklini kim toʻldiradi?"
viewerName "Dilnoza Karimova"
out:
  decisions [{text "Sentabr uchun 14 ta xizmat raqami tasdiqlandi.", commentIds [k1]}]
  openQuestions [{text "Vazirlik shaklini kim toʻldirishi hal qilinmagan.", commentId k3}]
  commitments [{who "Nodira", what "Yakuniy PDF-ni yuborish", byWhen null, commentId k2}]
  forViewer "Vazirlik shakli boʻyicha savolingizga hali javob berilmagan."
```

**Golden-set cases**

| id | asserts |
|---|---|
| `thread.cites-only-given` | every `commentIds`/`commentId` ∈ input ids |
| `thread.who-exact` | every `commitments[].who` ∈ input authors, exact string |
| `thread.no-decision` | a thread of only questions → `decisions === []` |
| `thread.bywhen-null` | no date stated → `byWhen === null` (the key anti-hallucination case) |
| `thread.viewer` | `forViewer` non-empty when the viewer asked an unanswered question |
| `thread.order` | arrays ordered by citing comment `createdAt` |
| `thread.uz-latn.orthography` | correct `oʻ`/`gʻ` |

#### (4) UI expectations

- **Affordance**: keep the `SparkleButton` in the comments `Field` action slot; show it only when
  `comments.length >= 3` (card detail has no threshold today; the events panel uses `>= 2`).
  **Add the missing flag/budget gate to `comments-panel.tsx`** — it is the one call site without one.
- **Preview**: three labelled sections with links. `decisions` with a check glyph, `openQuestions`
  with a question glyph in `attention` tone, `commitments` as `who → what (byWhen)` rows.
  `forViewer` as a highlighted one-liner at the top.
- **Accept**: **stop auto-posting a comment on the card** (`card-detail.tsx:940`). Accept should
  insert into the compose box (as the events panel already does), so a human owns what they post. If
  posting a summary directly is wanted, it must be a distinct, visibly-labelled "AI xulosasi" comment
  kind with its own rendering and audit action — that is a schema change, file it as scope.
- **Edit / Discard**: make Edit actually different from Accept in `comments-panel.tsx:76-82`.
- **Empty**: fewer than 3 comments → no button.
- **Error**: keep; add "budget tugagan" as a distinct message.

---

### F8 — `nl_analytics`

#### (1) Today

**File**: `packages/ai/src/prompts/nl-analytics.ts`.
**Input**: `{ locale, query ≤400, knownUnits[], knownLabels[], knownProjects[] }`.
**System prompt** (verbatim):
> You translate one natural-language analytics question into this exact small filter grammar: tokens
> "assignee:@name", "giver:@name", "status:active|done|archived", "due:<=word" / "due:>=word" /
> "due:word" (word is today/a weekday name/YYYY-MM-DD), 'project:"Name"', "label:name", 'unit:"Name"',
> plus free text for anything else. Only use unit/project/label names from the lists given
> (knownUnits/knownLabels/knownProjects) — never invent one. Pick the chart type that best answers the
> question (bar for comparisons/counts, line for a trend over time, pie for a share/breakdown, table
> for a raw list, burnup for project progress over time). filterText may be empty if the question does
> not map to any filter. {localeInstruction} (filterText itself stays in the grammar's own syntax,
> untranslated.) Call emit_analytics_query exactly once.

**Output**: `{ filterText ≤500, chartType: bar|line|pie|table|burnup, explanation ≤400 }`.

**Where it goes**: `/analytics` (`ask-analytics.tsx`). Accept calls
`onApplyFilter(filterText)` → `setValue({ ...value, filter })` (`analytics-screen.tsx:165`).
**`chartType` is never used** — the analytics screen renders a fixed grid of nine sections and has no
chart-selection concept. `knownLabels` and `knownProjects` are never passed (line 38 passes only
`knownUnits`), and the member list is never passed, so `assignee:@…` — the most common question shape
("Nodirada nechta ochiq vazifa bor?") — cannot be produced.

The grammar itself (`packages/contracts/src/filter-grammar.ts`) is solid and is the right target:
unknown tokens degrade to free text rather than being dropped, and the same parser runs on client and
server. Using it as the AI's output language is a genuinely good architectural decision.

**Before/after**: a question, three shimmer lines, one line of prose
(`analytics.ask.resultWithFilter` = "Filtr: {filter}") plus the explanation, then Accept silently
changes the filter bar. **The user never sees a number.** The CTO's phrasing — "answer with numbers" —
is exactly the gap.

**Mock vs. real**: mock is two regexes (`overdue`/`done`) plus a unit substring. Real GLM handles
Uzbek/Russian phrasing far better, but the answer is still only a filter string.

#### (2) What people actually want

Ask *"Bu oy Data boʻlimida nechta vazifa muddatini oʻtkazib yubordi?"* and get **"7 ta"**, the
comparison to last month, the filter that produced it (editable), and a chart. And ask
*"Kim eng koʻp kechiktiryapti?"* and get a ranked list of names and counts.

#### (3) v1.1 prompt specification — map, then answer

Two-stage, one extra call only when the first stage succeeds:

**Stage A — `nl_analytics` (map)**

Role
> You translate one analytics question about a ministry department's work board into a formal query.
> You answer only with the query; you never guess numbers.

Inputs

```ts
{
  locale, query,
  today: string,                                      // ← NEW
  knownUnits: string[], knownLabels: string[], knownProjects: string[],
  knownMembers: { name, handle }[],                   // ← NEW (fixes assignee:)
  availableMetrics: ['throughput','on_time_rate','open_vs_overdue','load_per_person',
                     'load_per_unit','project_progress','events_participation','poll_turnout'],  // ← NEW
  dateRange: { since, until }                         // the screen's current range ← NEW
}
```

Instructions
1. Produce `filterText` in the grammar, using **only** names from the known lists and handles from
   `knownMembers`. Resolve Uzbek/Russian relative periods (`bu oy`, `oʻtgan hafta`, `в этом месяце`)
   into `due:>=YYYY-MM-DD due:<=YYYY-MM-DD` against `today`.
2. Choose a `metric` from `availableMetrics` — the number that actually answers the question — or
   `null` if the question is a plain list.
3. Choose `groupBy` ∈ `person|unit|project|label|status|none` and `chartType`.
4. `unmappedTerms`: any part of the question you could not express. Never silently drop it.
5. `confidence` overall.

Output JSON schema (`emit_analytics_query`)

```jsonc
{
  "type":"object","additionalProperties":false,
  "required":["filterText","metric","groupBy","chartType","unmappedTerms","confidence","restatement"],
  "properties":{
    "filterText":{"type":"string","maxLength":500},
    "metric":{"type":["string","null"],"enum":["throughput","on_time_rate","open_vs_overdue",
              "load_per_person","load_per_unit","project_progress","events_participation","poll_turnout",null]},
    "groupBy":{"type":"string","enum":["person","unit","project","label","status","none"]},
    "chartType":{"type":"string","enum":["bar","line","pie","table","burnup"]},
    "unmappedTerms":{"type":"array","maxItems":5,"items":{"type":"string","maxLength":80}},
    "confidence":{"type":"string","enum":["high","medium","low"]},
    "restatement":{"type":"string","minLength":1,"maxLength":200}
  }
}
```

`restatement` is the "did I understand you" line, in the user's locale — this replaces today's
`explanation`, which mostly restates the filter syntax back at a non-technical user.

**Stage B — answer (no model call)**
The client runs the filter and the metric through the **existing** analytics query
(`apps/web/src/features/analytics`), and renders the number itself. No second AI call, no chance of a
hallucinated figure. Only if the head explicitly asks for prose does a second call narrate the
computed numbers (reuse F5's shape, with the numbers as input).

**Few-shot**

```
today 2026-09-12, knownUnits ["Data boʻlimi","Kadrlar boʻlimi"], knownMembers [{"Nodira Karimova","nodira"}]
in : "Bu oy Data boʻlimining muddati oʻtgan kartochkalari"
out: filterText 'unit:"Data boʻlimi" status:active due:<2026-09-12 due:>=2026-09-01',
     metric "open_vs_overdue", groupBy "none", chartType "bar", unmappedTerms [],
     confidence "high", restatement "Data boʻlimida shu oy muddati oʻtgan ochiq vazifalar soni"

in : "Кто больше всех просрочил?"
out: filterText 'status:active due:<2026-09-12', metric "load_per_person", groupBy "person",
     chartType "bar", confidence "high", restatement "Кто имеет больше всего просроченных задач"

in : "Nodira qanchalik samarali ishlayapti?"
out: filterText "assignee:@nodira", metric "on_time_rate", groupBy "none", chartType "bar",
     unmappedTerms ["samarali"], confidence "low",
     restatement "Nodiraning vazifalarni muddatida bajarish ulushi"
```

**Golden-set cases**

| id | asserts |
|---|---|
| `analytics.uz-latn.overdue-unit` | `filterText` parses via `parseFilterQuery` into a `unit` clause with an exact known unit |
| `analytics.uz-latn.this-month` | `bu oy` → two `due:` clauses bounding the current month |
| `analytics.ru.who-most` | `metric === 'load_per_person'`, `groupBy === 'person'` |
| `analytics.any.no-invented-unit` | every `unit`/`project`/`label` clause value ∈ the corresponding known list |
| `analytics.any.assignee-handle` | assignee clause uses a handle from `knownMembers` |
| `analytics.any.unmapped` | a vague adjective ("samarali") lands in `unmappedTerms`, confidence ≤ medium |
| `analytics.any.parses` | `parseFilterQuery(filterText).clauses` contains **zero** `text` clauses for a well-mapped question |

#### (4) UI expectations

- **Affordance**: keep `AskAnalytics` above the filter bar, but make it the screen's primary input on
  first visit — a wide field with three example questions as chips (DESIGN.md empty state rule).
- **Preview**: `restatement` first, then **the answer as a number**, then the chart, then the filter
  text in a monospace chip with an "edit" affordance. Low confidence → an `attention` chip listing
  `unmappedTerms` ("'samarali' tushunilmadi").
- **Accept**: pins the question + filter + chart to the dashboard (the pin mechanism already exists:
  `CreatePinInput` with `filterQuery`, `analytics/types.ts:148`). That is the real "accept" here —
  today Accept just mutates the filter bar and clears the question.
- **Edit**: edit the filter text directly; re-run locally (no AI call).
- **Empty**: no question → no panel (correct today).
- **Error**: on `confidence: 'low'` with an empty `filterText`, do not apply anything; show
  "Savolni boshqacha yozing" plus the three example chips.

---

### F9 — `translate`

#### (1) Today

**File**: `packages/ai/src/prompts/translate.ts`.
**Input**: `{ locale /* TARGET */, sourceLocale?, text ≤4000 }`.
**System prompt** (verbatim):
> Translate the given text into {targetName} from {sourceName} | (detect the source language yourself).
> Preserve meaning, tone, and any names, numbers, or formatting exactly — never summarise or add
> commentary, only translate. If the text is already in the target language, still return it (lightly
> polished if needed) and report the detected source locale as the target locale itself. Call
> emit_translation exactly once.

Note this is the one prompt that does **not** call `localeInstruction()` — correct, since the locale
field means something different here. That semantic overload of `locale` is the root of §0.1.

**Output**: `{ translatedText ≤8000, detectedSourceLocale: Locale|null }`.

**Where it goes**:
- `/work/card` description (`card-detail.tsx:242`): `{ text: source, locale }` → **target = viewer's
  own locale**. For a uz-Latn user reading an Uzbek card this is a no-op "polish". Accept **overwrites
  the saved description** (`acceptTranslate` → `saveDescription`), destroying the original with no undo.
- `/pages` editor (`page-editor.tsx:194`): `{ text, locale }` → same bug, on the selected range.
  (The range-scoped design is otherwise good.)
- `/personal` notes (`notes-view.tsx:93`): `{ locale: targetLocale, sourceLocale: locale, text }` —
  **correct**, via `TRANSLATE_TARGET` (uz→ru, ru→uz, en→uz). Preview only, never overwrites the note.

**Mock vs. real**: offline returns the input **unchanged**. Combined with the viewer-locale bug, the
offline demo behaviour is "press sparkle, nothing happens" — which is exactly what a CTO would
describe as "it mostly translates to Uzbek".

#### (2) What people actually want

Pick the target language explicitly (uz-Latn ↔ uz-Cyrl ↔ ru ↔ en are all real needs in this ministry:
Cyrillic for older staff, Russian for inter-ministry correspondence, English for donor reporting),
keep the department's terminology from `TERMS.md` (vazifa / topshiriq / muddat / boʻlim / tadbir must
not become synonyms), and **never** lose the original.

#### (3) v1.1 prompt specification

**Role**
> You translate internal work text for a ministry department in Uzbekistan. You are a terminology-
> faithful translator, not an editor. You keep the register formal and administrative.

**Inputs**

```ts
{
  targetLocale: 'uz-Latn'|'uz-Cyrl'|'ru'|'en',   // ← RENAMED from `locale`, removes the overload
  sourceLocale: Locale|null,
  text: string,
  glossary: { source: string, target: string }[],  // ← NEW, from packages/i18n/terms.json for this pair
  preserve: string[]                               // ← NEW: names, card ids, @mentions, URLs, numbers
}
```

**Instructions**
1. Translate `text` into `targetLocale`. Do not summarise, expand, explain, or fix the author's facts.
2. Apply `glossary` exactly: every `source` term becomes its `target` term, every time.
3. Leave every string in `preserve` byte-identical: personal names, `@mentions`, URLs, numbers, dates,
   document codes (`EGDI`, `PF-60`).
4. Preserve line breaks, list markers and indentation exactly.
5. For `uz-Latn`, use `oʻ`/`gʻ` (U+02BB). For `uz-Cyrl`, use `ў`/`ғ`/`қ`/`ҳ`.
   For a `uz-Latn ↔ uz-Cyrl` pair this is transliteration, not translation — do not rephrase anything.
6. If `text` is already in `targetLocale`, set `alreadyInTarget: true` and return it **unchanged**.
   Do not "polish".
7. Report any term you were unsure about in `uncertainTerms`.

**Constraints**: never add a greeting, a sign-off, or commentary. Never change a number or a date format.

**Output JSON schema** (`emit_translation`)

```jsonc
{
  "type":"object","additionalProperties":false,
  "required":["translatedText","detectedSourceLocale","alreadyInTarget","uncertainTerms"],
  "properties":{
    "translatedText":{"type":"string","minLength":1,"maxLength":8000},
    "detectedSourceLocale":{"type":["string","null"],"enum":["uz-Latn","uz-Cyrl","ru","en",null]},
    "alreadyInTarget":{"type":"boolean"},
    "uncertainTerms":{"type":"array","maxItems":8,"items":{"type":"string","maxLength":80}}
  }
}
```

Client post-processing: run `translatedText` through `packages/i18n/src/normalize-uz.ts` for
`uz-Latn`, and through `transliterate.ts` as a **cross-check** for the `uz-Latn ↔ uz-Cyrl` pair — if
the model's answer and the deterministic transliteration differ by more than a small ratio, prefer
the deterministic one. For that pair, consider skipping the model entirely (see §4, D-2).

**Few-shot**

```
in : target "ru", source "uz-Latn", glossary [{vazifa→задача},{muddat→срок},{boʻlim→отдел}],
     preserve ["Nodira","EGDI"], text "Nodira, EGDI vazifasining muddati juma kuni tugaydi."
out: translatedText "Нодира, срок задачи EGDI истекает в пятницу.", alreadyInTarget false

in : target "uz-Cyrl", source "uz-Latn", text "Yigʻilish ertaga soat 10:00 da boshlanadi."
out: translatedText "Йиғилиш эртага соат 10:00 да бошланади.", alreadyInTarget false

in : target "uz-Latn", source null, text "Yigʻilish ertaga boshlanadi."
out: translatedText "Yigʻilish ertaga boshlanadi.", detectedSourceLocale "uz-Latn",
     alreadyInTarget true, uncertainTerms []
```

**Golden-set cases**

| id | asserts |
|---|---|
| `translate.uz-latn→ru.terminology` | `vazifa → задача`, `muddat → срок` present |
| `translate.uz-latn→uz-cyrl` | output matches `transliterate()` within tolerance |
| `translate.any.preserve-names` | every `preserve` string appears verbatim in the output |
| `translate.any.already-in-target` | same-locale input → `alreadyInTarget === true` and byte-identical text |
| `translate.any.preserve-newlines` | line count in = line count out |
| `translate.uz-latn.orthography` | no ASCII `'` in a uz-Latn result |
| `translate.any.no-commentary` | output does not contain "перевод"/"translation"/"tarjima" as a meta-remark |

#### (4) UI expectations

- **Affordance**: the sparkle becomes a **split control** — icon plus a target-language chip
  (`RU` / `ЎЗ` / `EN`), remembered per user in `localStorage`. This single change fixes the CTO's
  headline complaint. Where a one-click default is wanted, use `notes-view.tsx`'s `TRANSLATE_TARGET`
  map as the default and still show which language it is going to.
- **Preview**: **side-by-side** original / translation on ≥ 1024px, stacked below that. Never a
  single pane that implies replacement. `uncertainTerms` render as `attention` chips under the pane.
- **Accept**:
  - Card description (`card-detail.tsx:263`): must **not** silently overwrite. Either append as a
    second-language block, or replace with `toastWithUndo` and an audit entry. Overwriting a saved
    field with generated text and no undo violates DESIGN.md's "undo over confirm".
  - Page editor: replacing the selected range is correct — keep it, add undo (Tiptap history covers it).
  - Notes: preview-only is correct.
- **Edit**: an editable textarea (page editor already does this well, `page-editor.tsx:337`).
- **Empty**: no selection → the existing `pages.editor.translate.selectFirst` toast. Card detail
  should disable the sparkle on an empty description (it already checks `descDraft.trim()`).
- **`alreadyInTarget`**: do not show a preview at all — show a muted line
  *"Matn allaqachon {til}da"* and no Accept. Do not bill a "polish".

---

### F10 — `what_did_i_miss`

#### (1) Today

**File**: `packages/ai/src/prompts/what-did-i-miss.ts`.
**Input**: `{ locale, sinceLabel, newCards[], commentsOnMyCards[], upcomingEvents[] }`, each `{id,title}`.
**System prompt** (verbatim):
> You write a short "while you were away" catch-up for one person, since {sinceLabel}, from three
> lists (new cards, comments on their cards, upcoming events — each item has an id and a title).
> Prioritise what most needs their attention first. Never invent an item that is not in one of the
> three lists; if all three are empty, say plainly that nothing happened. highlightIds must only ever
> contain ids copied verbatim from the input. {localeInstruction} Call emit_missed_digest exactly once.

**Output**: `{ narrative ≤1500, highlightIds[] ≤30 }`.

**Where it goes**: **nowhere**. `/ai` Assistant form only, where the user types
`sinceLabel` ("oʻtgan juma") and three `id | title` lists by hand.

This is the feature with the clearest real demand ("what changed since Friday" was in the CTO's own
list) and zero implementation surface. The `/inbox` screen — which already has exactly these three
data sets — never calls it.

#### (2) What people actually want

Monday morning, open `/inbox`: *"Juma kunidan beri: sizga 2 ta yangi topshiriq berildi (biri bugun
muddati tugaydi), 4 ta izoh sizning vazifalaringizga yozildi, Nodira EGDI paketi boʻyicha javob
kutmoqda, va payshanba kuni sayl bor — hali javob bermagansiz."* Every clause a link. Read it in
twenty seconds, then act.

#### (3) v1.1 prompt specification — merge with F5, keep one feature id

Merge `what_did_i_miss` into a single **catch-up** feature and drop the separate id (see §4, D-1):
a person's catch-up and a person's weekly recap are the same query at different time windows. Until
the merge lands, this is the v1.1 spec for `what_did_i_miss`:

**Role**
> You write the catch-up a person reads when they open the product after being away. You are ruthless
> about ordering: what needs action today comes first, what is merely informational comes last.

**Inputs**

```ts
{
  locale, viewerName,
  since: string,                                       // ISO ← replaces the free-text sinceLabel
  now: string,                                         // ISO ← NEW
  assignedToMe:   { id, title, giverName, dueDate, priority }[],   // ← NEW fields
  commentsOnMine: { id, cardId, cardTitle, author, excerpt, mentionsMe }[],  // ← NEW
  mentionsOfMe:   { id, cardId, cardTitle, author, excerpt }[],    // ← NEW
  statusChanges:  { id, title, from, to, byName }[],               // ← NEW
  upcomingEvents: { id, title, startsAt, myRsvp: 'yes'|'no'|'maybe'|null }[],
  overdueMine:    { id, title, dueDate, daysOverdue }[]            // ← NEW
}
```

**Instructions**
1. Produce `items`, ordered: overdue mine → new assignment due within 2 days → direct mentions →
   unanswered comments on my cards → events with no RSVP → everything else.
2. Each item: one sentence naming the concrete thing, the person involved (only if given), and the
   deadline (only if given), plus its `kind` and its `refId`.
3. At most 8 items. If more exist, set `moreCount`.
4. `headline`: one sentence with the totals.
5. If everything is empty, `headline` says so plainly and `items` is empty.
6. `needsActionCount`: how many of `items` require the viewer to do something today.

**Constraints**: shared language + anti-fabrication + citation.

**Output JSON schema** (`emit_missed_digest`)

```jsonc
{
  "type":"object","additionalProperties":false,
  "required":["headline","items","moreCount","needsActionCount"],
  "properties":{
    "headline":{"type":"string","minLength":1,"maxLength":200},
    "items":{"type":"array","maxItems":8,"items":{
      "type":"object","additionalProperties":false,
      "required":["kind","refId","text","needsAction"],
      "properties":{
        "kind":{"type":"string","enum":["overdue","assigned","mention","comment","status","event"]},
        "refId":{"type":"string"},
        "text":{"type":"string","minLength":1,"maxLength":220},
        "needsAction":{"type":"boolean"}}}},
    "moreCount":{"type":"integer","minimum":0},
    "needsActionCount":{"type":"integer","minimum":0}
  }
}
```

**Few-shot**

```
since 2026-09-05, now 2026-09-08, viewerName "Anvar Aliyev"
overdueMine [{c1,"Sayt matni",2026-09-05,3}]
assignedToMe [{c2,"EGDI jadvali","Nodira",2026-09-09,"high"}]
mentionsOfMe [{k7,c4,"Byudjet","Dilnoza","Anvar, raqamlarni tasdiqlaysizmi?"}]
upcomingEvents [{e1,"Kuzgi sayr",2026-09-19T09:00,null}]
out:
 headline "Juma kunidan beri: 1 ta kechikkan vazifa, 1 ta yangi topshiriq, 1 ta murojaat."
 items [
  {kind "overdue", refId c1, text "Sayt matni 3 kun kechikdi.", needsAction true},
  {kind "assigned", refId c2, text "Nodira sizga EGDI jadvalini topshirdi — muddat ertaga.", needsAction true},
  {kind "mention", refId c4, text "Dilnoza byudjet raqamlarini tasdiqlashingizni soʻradi.", needsAction true},
  {kind "event", refId e1, text "Kuzgi sayr 19-sentabrda — javob bermagansiz.", needsAction false}]
 moreCount 0, needsActionCount 3
```

**Golden-set cases**

| id | asserts |
|---|---|
| `missed.order` | overdue precedes assigned precedes mention precedes event |
| `missed.cites-only-given` | every `refId` ∈ input ids |
| `missed.empty` | all lists empty → `items === []`, `needsActionCount === 0` |
| `missed.cap` | 20 inputs → `items.length === 8`, `moreCount === 12` |
| `missed.no-invented-person` | no name outside the input appears |
| `missed.uz-latn.orthography` | correct `oʻ`/`gʻ` |

#### (4) UI expectations

- **Affordance**: a card at the top of `/inbox`, shown automatically when the last visit was more than
  ~18 hours ago (store `lastSeenAt` locally), plus a manual "Nimani oʻtkazib yubordim?" button and a
  `Ctrl+K` command. Also surface it on `/` for the first visit of the day.
- **Preview**: a list of rows, each with a `kind` glyph, the sentence, and a link to `refId`. Rows
  with `needsAction` get an `attention` left border. `moreCount` renders as
  "…va yana {n} ta" linking to the full inbox.
- **Accept/Edit/Discard**: this one has no "apply" semantics — Accept should be **"Oʻqidim"**
  (dismiss + mark the window as seen), Discard = "Keyinroq". Do not force the three-button
  `AiPreviewPanel` shape onto a read-only digest; give `AiPreviewPanel` an `actions="dismiss"` variant
  rather than mislabelling Accept.
- **Empty**: nothing new → do not call the model at all; render the normal inbox empty state.
- **Error**: silent — fall back to the ordinary inbox list. A catch-up that errors should not block
  the inbox.

---

## 4. Drop, merge, add

### Drop / merge

| id | Action | Reason |
|---|---|---|
| D-1 | **Merge `what_did_i_miss` into `weekly_summary`** as one `catch_up` feature with a `window: 'since_last_visit' \| 'week'` and a `scope: 'person' \| 'department'` | They take the same data and produce the same shape. Three scopes (my catch-up, my week, the department's week) share one prompt, one schema, one golden set, one eval budget. Keep both feature ids alive at the API for one release so existing traces stay meaningful. |
| D-2 | **Do not use the model for `uz-Latn ↔ uz-Cyrl`** | `packages/i18n/src/transliterate.ts` already does this deterministically, for free, instantly, and with no orthography risk. Route that pair locally; keep the model for ru/en pairs. Saves a meaningful share of translate spend. |
| D-3 | **Drop the `/ai` → *Yordamchi* tab in its current form** (`apps/web/src/features/ai/assistant-panel.tsx`, `feature-forms.ts`) | Ten hand-typed forms that print raw JSON and copy it to the clipboard. It is the screen the CTO would have opened first, and it is the worst one in the product. Replace with a read-only "what each helper does, where it lives, what it cost this month" panel that links into the real surfaces. This also retires `remapPlanSprintTasks` and the `idTitleList` field kind, which exist only to make ids typeable by hand. |
| D-4 | **Demote `deadline_risk` from a classifier to an explainer** | `computeRisk()` in `apps/api/src/modules/work/repo.ts:41` already decides. Two sources of truth for "is this card at risk" is a defect, not a feature. |
| D-5 | **Merge the two `plan_sprint` callers behind one `scope`** | `project-page-screen.tsx` currently lies to the feature (`sprintKind: 'day'`, `goal: project.title`) to reuse it. Make the scope explicit instead. |

Net: ten feature ids → **seven** (`quick_add`, `subtasks`, `plan`, `risk_explain`, `catch_up`,
`draft_event`, `thread_digest`, `ask_analytics`, `translate` — nine ids, seven distinct prompts once
`catch_up` absorbs both summaries and `risk_explain` absorbs the badge).

### Add

Ranked by value per unit of work.

| id | Feature | Where | Why it is worth it |
|---|---|---|---|
| N-1 | **"Draft a reply"** on a comment thread and on an inbox mention | `/work/card` comment box, `/inbox` | The single most-used AI action in every comparable product. The department already writes in four languages; drafting a polite administrative reply in the right register is genuinely hard for a junior xodim. Inputs: the thread, the viewer's role, a tone hint (`neutral`/`formal`). Output: `{ draft, tone }`. Preview → **compose box**, never auto-post. |
| N-2 | **"Kim kechiktiryapti?" — board risk digest for the head** | `/work` board header, head only | Runs the F4 explainer over the top N at-risk cards in **one batched call** and returns a ranked list with one reason each. This is the head's daily version of F4 and costs one call instead of N. |
| N-3 | **"Kimga topshiray?" — suggest who to assign** | the assignee field on `/work/card` and in the quick-add preview | Inputs: card title/labels/project, and per-member `{openCount, overdueCount, recentLabels, avgCycleDays}` from the analytics aggregates that already exist (`loadPerPerson`). Output: top 3 `{userId, reason, loadWarning}`. High value, and it makes the load data the department already collects actionable. **Guard rail**: the reason must be workload/experience, never a performance judgement, and the head always chooses. |
| N-4 | **"Juma kunidan beri nima oʻzgardi?"** on a project | `/projects/view` header | The project equivalent of F10, over a project's cards. Cheap: it reuses the `catch_up` prompt with a project scope. |
| N-5 | **Duplicate / related card detection** (TECH-SPEC §8, never built) | on card create, and in quick-add preview | "Bunga oʻxshash vazifa allaqachon bor" with a link. Needs embeddings or a title-similarity prefilter; scope it as a prefilter + one confirmation call, not a full semantic search. |
| N-6 | **Smart reminder timing** (TECH-SPEC §8, never built) | notification preferences | Low value relative to cost; keep it in the backlog, not in v1.1. |

Explicitly **not** recommended: a chat assistant, a "write my card description for me" generator, and
anything that posts to a thread or Telegram without a human pressing send.

---

## 5. Cross-cutting fixes, ranked

These are the changes that make the whole set stop feeling random. Each is small and independently shippable.

| # | Fix | Files |
|---|---|---|
| 1 | **Translate target locale**: add an explicit target picker; stop passing `useLocale()` as the target | `work/components/card-detail.tsx:247`, `pages/page-editor.tsx:194`; rename `locale`→`targetLocale` in `packages/ai/src/prompts/translate.ts` |
| 2 | **Pass `today` (Asia/Tashkent) to `quick_add_parse`** | `packages/ai/src/prompts/quick-add-parse.ts` (schema + prompt), `work/components/quick-add-bar.tsx:110`, `personal/lib/use-quick-add-ai.ts:27` |
| 3 | **Stop discarding model output on Accept** | `quick-add-bar.tsx:125` (`labels`), `event-form-dialog.tsx:171` (checklist/poll/carpool), `project-page-screen.tsx:184` (the plan) |
| 4 | **Set `temperature: 0`** for extraction features; `0.3` for `draft_event` | `packages/ai/src/gateway.ts` + per-feature `FeatureSpec.temperature` |
| 5 | **Fix the truncated-tool-call retry** (G-1): treat a `finish_reason: 'length'` with unparseable tool arguments as an empty answer and double `max_tokens` | `packages/ai/src/gateway.ts:112` |
| 6 | **Enforce the citation guard rail server-side** in `runFeature`: intersect every returned id array with the input id set before returning | `packages/ai/src/features.ts` (a per-spec `validateOutput(input, output)` hook) |
| 7 | **Write `blocked_flag` / `blocked_budget` traces** instead of throwing before the insert (G-5) | `apps/api/src/modules/ai/service.ts:126,130` |
| 8 | **Add `ai-evals` to the `release` (and ideally `integration`) profile** (G-7) | `agentic/gates.json` |
| 9 | **Cost line in soʻm**, not tokens, everywhere | `apps/web/src/features/personal/lib/ai-helpers.ts:aiCostLine`, `ai.result.costLine` in all four locale files |
| 10 | **Uzbek orthography post-processing**: run every model string through `packages/i18n/src/normalize-uz.ts` before render, and add an eval that fails on ASCII `'` in a `uz-Latn` output | `packages/ai/src/features.ts`, `packages/ai/evals/cases.ts` |
| 11 | **Fix Edit === Accept** in the two events components | `events/components/event-form-dialog.tsx:209-210`, `events/components/comments-panel.tsx:76-82` |
| 12 | **Add the missing flag/budget gate** to the event thread summary | `events/components/comments-panel.tsx:37` |
| 13 | **Stop auto-posting an AI comment** on card accept | `work/components/card-detail.tsx:940` |
| 14 | **Show feature descriptions on `/ai`** — `featureDescriptionKey()` is already translated in four locales and never called | `apps/web/src/features/ai/ai-settings-screen.tsx:240`, `types.ts:47` |
| 15 | **Per-feature spend on the flags row** (this month, in soʻm) so a head can turn off what is expensive rather than everything | `apps/api/src/modules/ai/repo.ts` (a `group by feature` sum), `ai-settings-screen.tsx` |
| 16 | **Restrict `GET /ai/usage`** to self for members, all for head (G-8) | `apps/api/src/modules/ai/index.ts:104`, `repo.ts:listTraces` |
| 17 | **Wire the department weekly digest to `weekly_summary`** and remove the hard-coded `Haftalik xulosa / Weekly summary:` literal | `apps/api/src/modules/notifications/jobs.ts:127-150` |
| 18 | **Add AI actions to Ctrl+K** — today only `ai.open` exists | each feature's `manifest.tsx` `commands` array |
| 19 | **Localise the offline simulators** — `plan-sprint.ts`'s `scheduleNote`, `draft-event.ts`'s checklist/poll/carpool and `subtask-breakdown.ts`'s fallback are hard-coded English and will render inside an Uzbek UI | `packages/ai/src/prompts/*.ts` `simulate()` |

---

## 6. Golden set and evaluation plan

Today: `packages/ai/evals/cases.ts` has **15 cases** across 10 features, of which 7 have a `check()`.
`packages/ai/evals/run.ts` is a good harness (promptfoo-shaped, runs against the real endpoint when
`AI_API_KEY` is set). It is never executed by any gate (G-7).

Target for v1.1: **~70 cases**, per the tables above, with these rules.

1. **Every case runs twice** — once against the offline simulator (asserts schema validity and the
   mechanical guard rails: ids ⊆ input, names ⊆ input, orthography) and once against real GLM when a
   key is present (adds the semantic assertions).
2. **Three assertion classes**, all mechanical, none requiring a human:
   - *faithfulness*: every id/name/date in the output appears in the input;
   - *language*: correct locale, correct `oʻ`/`gʻ`, glossary terms from `terms.json` present;
   - *behaviour*: the feature-specific check (a weekday resolves to the right date, capacity overflow
     is flagged, `insufficientInput` fires on a vague title).
3. **Determinism case per extraction feature**: run 3× at `temperature: 0`, assert byte-identical output.
   This is the direct test for "feels random".
4. **Cost budget assertion**: the whole suite must stay under a fixed UZS ceiling per run; `run.ts`
   already reports `meta.totalTokens` per case — sum it and fail over the ceiling.
5. Add `ai-evals` to the `release` profile in `agentic/gates.json`, and run it nightly against the
   real endpoint so drift in GLM is caught before a release, not during one.

---

## 7. Appendix — every file this audit read

**`packages/ai`** — `src/config.ts`, `src/types.ts`, `src/feature-spec.ts`, `src/features.ts`,
`src/schemas.ts`, `src/index.ts`, `src/locale-prompt.ts`, `src/gateway.ts`, `src/glm-provider.ts`,
`src/mock-provider.ts`, `src/budget.ts`, `src/trim.ts`, all ten `src/prompts/*.ts`,
`evals/cases.ts`, `evals/run.ts`, `package.json`.

**`apps/api`** — `src/modules/ai/{index,service,repo,schemas,dto,errors}.ts`,
`src/modules/work/repo.ts` (`computeRisk`), `src/modules/notifications/jobs.ts`.

**`apps/web`** — `src/features/ai/{ai-settings-screen,assistant-panel,feature-forms,api,use-ai,types,manifest}.ts(x)`,
`src/features/work/components/{quick-add-bar,card-detail}.tsx`,
`src/features/personal/{sprints-view,tasks-view,today-view,notes-view,task-row}.tsx`,
`src/features/personal/lib/{ai-helpers,use-quick-add-ai}.ts`,
`src/features/projects/components/project-page-screen.tsx`,
`src/features/analytics/{ask-analytics,analytics-screen}.tsx`,
`src/features/events/components/{event-form-dialog,comments-panel}.tsx`,
`src/features/pages/page-editor.tsx`.

**`packages/ui`** — `src/primitives/{ai-preview-panel,sparkle-button}.tsx`.

**`packages/contracts`** — `src/filter-grammar.ts`.

**`packages/db`** — `migrations/0800_ai.sql`, `src/schema/ai.ts`, `src/seed/modules/ai.ts`.

**`packages/i18n`** — `TERMS.md`, `terms.json`, `messages/modules/ai/uz-Latn.json`.

**Other** — `docs/03-plan/TECH-SPEC.md` §8, `docs/03-plan/integrations/glm-api-instruction.md`,
`agentic/gates.json`, and the screenshot
`agentic/ledger/ui-blitz/2026-09-07T11-25-00-05-00/final/ai__1440__light__uz-Latn.png`.
