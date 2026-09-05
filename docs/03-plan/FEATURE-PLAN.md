# Devon (WorkPortal) — feature plan, version 2

Version 2, 2026-09-05. Supersedes v1: scope narrowed to what the department actually needs (tracking
and team), the document/correspondence ambitions removed, onboarding and team building deepened, and
the AI layer defined as a set of intelligent features rather than a chatbot. Working name **Devon**
(the state office of old; a collected body of work). Evidence: `docs/01-research/` (cited as [file]),
the technical design in `TECH-SPEC.md`, the design system in `DESIGN.md`.

---

## The plan in four paragraphs

**What it is.** Devon is where a government department's week happens: the work it tracks, the people
who do it, the requests they make, the things they do together, and the way a newcomer becomes one of
them. It takes the four things worth taking from the tools people already know and refuses the rest:
Trello's cards with checklists, covers and safe opt-in automations; Jira's real hierarchy and saveable
filters without its configuration schemes; Notion's templates, multiple views over one dataset and
onboarding pages without its blank-page anxiety; Miro's sticky notes, dot voting and timer for a retro
without a whiteboard product [all-in-one-suites-lark-bitrix; product-team-management-and-culture-features].
Underneath sits one object every civil servant already understands, the *topshiriq* (who asked, who
does, by when, what was reported), so that a task, a project, a leave request, an event RSVP and an
onboarding item are all the same shape with different clothes. Depth is hidden in three tiers: what
you see by default, what is one click away, and what lives in the command palette and templates.
Uzbek Latin is the default, Russian is complete, Telegram is the phone, and personal data never leaves
the country.

**Phase 1, the first ninety days, is the whole department's daily life, working.** Home answers three
questions for each role without a click: due from me, needs my decision, happening around me; the
director's Home is a one-page weekly brief drafted from the Friday pulses. People has three name
fields, positions from the staffing table with vacancies shown as dashed boxes, public/internal/
restricted tiers with every restricted read logged, and a deputy switch for leave season. Work has
quick-add that reads "Nodira: EGDI dalillar paketi, juma", list, board and timeline over the same
items, a filter line that is a shareable URL, the Friday pulse (one status, one sentence), and the
*Ijro nazorati* queue that fills itself when a deadline slips. Requests does leave in three taps against
the admin-editable holiday calendar, trips with an order number, and one-tap approval from the inbox or
a Telegram button. Events has RSVP with capacity and waitlist, a date poll, a budget and a checklist,
and feedback afterwards. Onboarding gives a newcomer a plan from a role template with items for them,
their manager, HR, a buddy and IT, a reading list of "how we work" pages, and 30/60/90 check-ins. The
first AI features ship inside these flows: quick-add parsing, translate on demand, a drafted Friday
sentence, "what did I miss" after leave, a project briefing for newcomers, and duplicate warnings.

**Phases 2 and 3 deepen without widening.** Phase 2 adds the Telegram Mini App, the retro canvas with
anonymous dot voting, automations capped at five triggers, recurring tasks and a templates gallery,
capacity as a derived person-by-week view, 1:1 notes, kudos attached to finished work, birthdays,
calendar sync, and AI level 2: semantic search, answers with citations, meeting notes that become
accept-per-item tasks, retro summaries, onboarding plans drafted per role. The unit of spread across
ministries is not the interface but the boring service underneath: a new department gets a tenant,
colours, holiday calendar and demo data from one form, and a sysadmin can install the whole thing from
the README in an afternoon [govtech-and-public-sector-patterns]. Phase 3 connects to the state where the
ministry wants it (OneID login, optional E-Imzo for official approvals), lets a bounded agent execute
multi-step requests with a preview and an undo window, and turns pulse history into delivery
confidence trends, never into individual scores.

**What we refuse, the taste rules, the risks.** No office suite, no document registry, no chat app,
no custom-workflow engine, no per-person KPIs or leaderboards, no attendance tracking, no product tour,
no fifteen view types, no Scrum vocabulary, no dashboard without a named decision-maker, no chatbot
that answers without citations, and nothing that sends restricted data to Telegram or an external
model. Taste: calm by default, dense on demand; one primary action per screen; plain Uzbek at a
ninth-grade reading level; the ministry's official navy reserved for one small official touchpoint
while Devon keeps its own paper-and-forest identity; motion in three durations that explains and never
performs; undo instead of confirm; autosave with an honest "Saqlandi"; numbers only where someone will
act on them [design-systems-craft-and-motion; tech-animation-and-visual-craft;
uzbekistan-gov-visual-identity-research]. Risks taken knowingly: building our own work engine rather
than forking one; Telegram as the phone client with pointers only; Keycloak from day one; a ninety-day
phase that depends on the agentic loop and its gates; and dogfooding in one department for four to
eight weeks before any minister sees it.

---

## How depth stays hidden (the anti-overwhelm method)

| Tier | What lives there | Examples |
|---|---|---|
| Default (what a first-time user sees) | five areas in the sidebar, one primary action per screen, 3–5 fields per form, plain labels | Home, People, Work, Requests, Events; "New task", "Request leave", "RSVP" |
| One click away | secondary views, filters, details, history, settings for the current object | board/timeline toggle, saved views, version history, checklist, watchers |
| Power layer | command palette, keyboard shortcuts, filter grammar, templates gallery, automations, admin | `Ctrl+K` for everything, `assignee:@me due:<=friday`, opt-in Butler-style rules capped at five triggers |

Templates are the primary way depth is delivered without configuration: a project template, an
onboarding template, an event checklist, a retro board, a weekly report. Product tours are refused;
teaching empty states and contextual hints replace them [zero-training-ux-and-onboarding addendum].

---

## Object model (small on purpose; full schema in TECH-SPEC §3)

| Object | One line |
|---|---|
| Tenant | a department or ministry: theme, locale, holidays, quiet hours |
| Unit, Position, Person | the org chart, the staffing table with vacancies, people with three names and three privacy tiers |
| Delegation | acting-for, time-boxed, logged twice |
| Topshiriq / Task | assigner → assignee → due → report → closure; subtasks; checklists; labels; watchers |
| Project | bundle of tasks with a weekly pulse and computed health; objectives at unit level |
| Board / View | the same tasks as list, board, timeline, calendar; saved filter strings |
| Request | leave, trip, remote, other; concurrence then approval; balance snapshot |
| Event, Poll, Canvas | team life: RSVP with waitlist, date polls, retro boards with votes and a timer |
| Page | lightweight blocks for onboarding, briefs, retro notes; assignable checklist items; versions |
| OnboardingPlan / Item | a newcomer's 30/60/90 with items owned by newcomer, manager, HR, buddy, IT |
| Notification | reason-tagged, pointer-only, digested, quiet-hours aware |
| Kudos | attached to a finished task or an event, never a feed of its own |
| AuditEvent, RestrictedRead, AITrace | the record of who did, saw, or generated what |

---

## Feature inventory by phase (maps to backlog epics)

| Feature | Phase / epic | Why | Zero-training test |
|---|---|---|---|
| Home for each role; director's weekly brief | 1 / EPIC-010 | The only screen most people need | "I know what to do today" in 30 s |
| "My work" and "Waiting on" queues | 1 / EPIC-010 | Personal view first; delegated work ages visibly | Overdue items I assigned appear without a filter |
| Directory with script-tolerant search; privacy tiers; verification | 1 / EPIC-001 | Names in Latin/Cyrillic; legal tiers | "Нодира" finds Nodira |
| Positions and org chart with vacancies; delegation | 1 / EPIC-001 | Directors care about vacancies; leave season | Dashed box = open post |
| Tasks and topshiriq with chain of accountability | 1 / EPIC-002 | Culturally native primitive | Executor sees who asked and by when |
| Quick-add in uz/ru/en | 1 / EPIC-002, AI in 011 | Kills the eight-field form | One line creates a correct item |
| List, board, timeline over one dataset; keyboard drag | 1 / EPIC-002 | Views never lose data; accessible | Switching views keeps everything |
| Filter grammar and saved views; command palette | 1 / EPIC-002 | Jira's power without schemes | `Ctrl+K` reaches every action |
| Comments, mentions, attachments (scanned), labels, checklists, covers | 1 / EPIC-002 | Trello's card depth | Checklist fraction on the card face |
| Friday pulse; computed health; Ijro nazorati queue; objectives | 1 / EPIC-003 | The ritual is the product; no green-until-crisis | Update in 20 s from the row |
| Inbox with reasons; quiet hours; digests; ICS feeds | 1 / EPIC-004 | Trust in why I was pinged | Every notification says why |
| Telegram bot: nudges, approvals, RSVP, deep links | 1 / EPIC-005 | Where the ministry lives | Approve without opening the portal |
| Leave in three taps with balance and holidays; trips; concurrence then approval | 1 / EPIC-006 | Highest-frequency requests | Balance visible before submit |
| Events with RSVP/waitlist, capacity, budget, checklist, feedback, date polls, photos | 1 / EPIC-007 | Team life, humane | RSVP in one tap |
| Pages editor: templates, mentions, assignable checklist items, versions | 1 / EPIC-008 | Notion's onboarding pages, not its universe | `/` and `@` just work |
| Onboarding plans by role; buddy; 30/60/90; reading list; progress | 1 / EPIC-009 | Newcomers become colleagues faster | Newcomer finds who to ask in 30 s |
| AI level 1 (parse, translate, pulse draft, catch-up, briefing, duplicates, tags, digest ranking) | 1 / EPIC-011 | Fewer clicks, no privacy risk | Draft appears; human edits |
| Admin: theme, holidays, roles, audit viewer, tenant provisioning, webhooks | 1 / EPIC-012 | Another department in an afternoon | Colour change without a deploy |
| Hardening: a11y, i18n QA, performance, offline queue, release 1.0 | 1 / EPIC-013 | Production-grade, not MVP | axe 0 serious; Lighthouse ≥ 90 |
| Telegram Mini App | 2 / EPIC-014 | Mobile without an app store | Approve from the phone in one tap |
| Retro/brainstorm canvas with dot voting and timer (Excalidraw) | 2 / EPIC-015 | Miro's useful 10 % | Sticky note, vote, timer, done |
| AI level 2 (semantic search, citations, meeting notes → tasks, retro summary, onboarding drafting, similar projects) | 2 / EPIC-016 | Real intelligence, still no chatbot by default | Every answer shows its source |
| Capacity view, 1:1 notes, kudos on work, birthdays, skills matrix | 2 / EPIC-017 | Team management without surveillance | Overload visible before Friday |
| Calendar sync, web push | 2 / EPIC-018 | Leave shows in Outlook | ICS link works |
| Automations (five triggers), recurring tasks, templates gallery | 2 / EPIC-019 | Butler's safety, no engine sprawl | Fill-in-the-blank sentence rule |
| Multi-ministry operations, restore drills, k3s option | 2 / EPIC-020 | The viral unit is the boring service | Sysadmin installs from README |
| OneID, optional E-Imzo, ijro bridge | 3 / EPIC-021 | State integration when the ministry wants it | Login via OneID |
| Bounded agent with preview and undo; anomaly flags; aggregate workload | 3 / EPIC-022 | Useful agency, human in the loop | Preview → confirm → undo window |
| Delivery confidence trends, dependency alerts | 3 / EPIC-023 | Movement, not just state | Trend visible per project |
| Cyrillic Uzbek locale; EGDI observatory | 3 / EPIC-024 | Inclusion; the unit's mandate | Older staff read comfortably |

---

## The AI layer, in one paragraph and one table

AI in Devon is a set of features that each do one job inside an existing screen, with a human accept
before anything becomes the record, citations whenever an answer is about people or policy, a strict
routing rule that keeps restricted data on an in-country model, and a budget the department head can
see [ai-features-and-assistants addendum]. There is no default chatbot. The gateway is
provider-agnostic (the owner's API is plugged in behind it), every call is traced with its cost, and a
golden test set guards every feature and every model change in CI.

| Level | Features |
|---|---|
| 1 (ships with the product) | quick-add parsing; translate on demand; Friday pulse draft; "what did I miss"; newcomer project briefing; duplicate warning; tag suggestions; smart digest ranking; event date suggestions; stalled-work and deadline-risk badges |
| 2 | semantic search; ask with citations; meeting notes → tasks; retro summary; onboarding plan drafting; similar past projects; related-item linking |
| 3 | bounded multi-step agent with preview and undo; anomaly flags on requests (never auto-reject); department-level workload signals (never per person); cross-unit roll-ups |

---

## Signature interactions

1. **Quick-add that reads like speech** in Uzbek, Russian or English, with a visible confirmation of
   who, what and when before it saves.
2. **The Friday pulse**: a status pill and one sentence, inline; a 15:00 Telegram nudge lists exactly
   what still needs a sentence; the 18:00 digest tells the department how the week went.
3. **Ijro nazorati**: a slipped deadline moves the item into the head's queue with acknowledge, reassign
   and comment in place, and the name carries the authority.
4. **Approve where you are**: inbox row or Telegram inline button; the record shows who decided and
   when; quiet hours respected unless the item is blocking.
5. **Leave in three taps** with the balance and the holiday calendar visible.
6. **Home answers three questions**; the director's Home is a one-pager.
7. **Search that forgives scripts and apostrophes.**
8. **Undo, not "Are you sure?"**, with a progress bar in the toast.
9. **Org chart that tells the truth**: dashed vacancies; click a unit for mandate, people, live projects.
10. **"Men ta'tildaman"**: one action sets a deputy for a date range; every action reads "X (Y nomidan)".
11. **A newcomer's first hour**: a plan already waiting, a buddy named, a reading list of three pages,
    and a "New here? Get a briefing" button on every project.
12. **A retro in fifteen minutes**: sticky notes, anonymous dots, a visible timer, and action items that
    become tasks on the spot.

---

## Non-goals and refusals

- No office suite, document editing or correspondence registry (attachments and lightweight pages only).
- No chat app; Telegram exists. No native mobile app before the Mini App proves itself.
- No custom-field or custom-workflow engine for users; automations capped at five trigger types.
- No per-person KPIs, leaderboards, productivity scores, activity timestamps, 360 reviews, 9-box,
  attendance clock-in, geolocation.
- No product tours or setup wizards; templates and teaching empty states instead.
- No more than five top-level areas; a sixth must replace one. No Scrum vocabulary. No fifteen views.
- No metric on any screen without a named person who acts on it.
- No foreign SaaS for identity, notifications, error tracking, or any AI call carrying personal data.
- No default chatbot; no answer about people or policy without a citation; AI never changes a privacy tier.
- No confirm dialog where undo would do; no bouncy springs, parallax, confetti beyond one coin-sized burst.

---

## Decisions needed from the product owner (also TECH-SPEC §19)

1. Tenant grain (department vs ministry) and default cross-unit visibility.
2. Hosting: ministry on-prem, UZINFOCOM/government cloud, or a commercial Uzbek data centre.
3. Identity: existing AD/LDAP to federate; OneID timeline.
4. AI: which API/provider you have; may non-personal (Internal-tier) text be sent to it; is an on-prem
   GPU host feasible for Restricted-tier features.
5. Telegram: an official department bot is acceptable; who lacks Telegram (SMS fallback).
6. Language default (Uzbek Latin assumed); Cyrillic Uzbek in phase 1 or later.
7. Staffing table import source; who owns restricted HR fields (ministry HR vs department).
8. Certification timing for state information systems.
9. Name "Devon" and any ministry brand constraints; Palette A (paper and forest with ministry trim)
   vs B (navy-led) in `DESIGN.md`.
10. Team after the agents ship it (TypeScript chosen for hiring reality).

## Why this is not generic

Every line above came from a specific piece of evidence and a specific judgement: the topshiriq as
the atom because Uzbek administrative culture already thinks that way; the Friday pulse because the
reference prototype's supervisor already asked for it and the portfolio research says it beats status
reports; five trigger types for automations because every open rule builder studied became a
graveyard; Excalidraw because tldraw's licence would embarrass a ministry; no chatbot because the one
public-sector chatbot studied told citizens to break the law; the ministry navy used sparingly because
an internal tool that dresses as the ministry portal reads as bureaucracy, and Devon has to read as a
place people want to open.
