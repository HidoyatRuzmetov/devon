# People & HR operations features civil servants need

**TL;DR:** Employee record, org chart, and leave/time-off with visible balances are the only HR modules that must work perfectly on day one — everything else (OKRs, performance reviews, skills matrices, succession) is Phase 2/3 or should be avoided entirely for a 23-person unit. The single highest-leverage UX pattern across every vendor studied is "request in under 60 seconds, approve from one tap on a notification, balance always visible" — copy that exactly. Workday is the canonical anti-pattern: enterprise-grade data model wrapped in a navigation model that requires training; avoid its information architecture even while borrowing its underlying entity design. Open-source HRIS (Frappe HR — GPL-3.0, OrangeHRM — GPL-3.0, Odoo — LGPL-3.0) prove a full leave/attendance/appraisal engine can be self-hosted in Uzbekistan at zero license cost, which matters directly for data-localization. Civil-service specifics (attestation, ranks, komandirovka orders, extended leave categories) have no equivalent in any Western SaaS tool and must be modeled as first-class local entities, not bolted on as custom fields.

## Method and evidence base

Live web search was unavailable for this research pass (session search quota exhausted before this task began); findings rely on successfully fetched vendor/OSS pages (listed in Sources) plus documented product knowledge current to early 2026, cross-checked wherever a fetch succeeded. Fetches that returned usable content: Workday.com, Frappe HR (frappe.io + GitHub), OrangeHRM (site + GitHub), Odoo Employees, Deel HR, Factorial HR, and Uzbekistan's Labor Code text on lex.uz (partial — the fetched excerpt covers Articles 195-196, 217-220; the government's own Ministry of Labor portal did not surface the leave-duration article text). Several vendor and G2/Capterra/Reddit pages returned 403/404/429 and could not be read directly (BambooHR, Rippling, Personio, HiBob, Lattice, 15Five, Leapsome, Gusto feature pages, and all review-aggregator pages) — claims about these products are marked accordingly and should be spot-checked before being treated as launch-blocking facts. This gap is flagged explicitly in Open Questions rather than papered over.

## The feature landscape, sorted by whether a 23-person Uzbek ministry department needs it

| Feature | Who has it | Government relevance | Verdict |
|---|---|---|---|
| Employee record (public profile vs restricted) | All | High — matches the reference site's privacy-tier requirement exactly | Must-have, Phase 1 |
| Org chart with vacancies | HiBob, Deel, Odoo, Factorial (auto-updating) | High — "shtat" (штатное расписание/shtat jadvali) is a real, legally meaningful document in the civil service, not a nice-to-have chart | Must-have, Phase 1 |
| Positions/staffing table ("shtat") | Rare in Western SaaS (they conflate position with person) | Critical, Uzbek-specific | Must-have, Phase 1 — biggest gap vs. off-the-shelf tools |
| Leave/time-off requests + balances + calendar | All | High — 2023 Labor Code mandates specific leave categories and paid days; approvals currently happen on paper/Excel | Must-have, Phase 1 |
| Attendance/timesheets ("tabel") | Frappe HR, Odoo, Factorial (geolocation clock-in) | Medium-high — tabel uchet rabochego vremeni is a real compliance document in budget organizations | Should-have, Phase 1-2, keep minimal |
| Business trips (komandirovka) | None natively (Deel has "compliant offboarding," not this) | High, Uzbek-specific — requires an official order (prikaz) with per-diem, dates, destination | Must-have, Phase 2 — legally distinct workflow, not just a leave type |
| Sick leave | All, as a leave subtype | Medium — needs its own category because it's usually not counted against annual leave and may require a medical certificate (bolnichny list) | Fold into leave module, don't over-engineer |
| Onboarding/offboarding checklists | BambooHR (pioneered this), Rippling, Frappe HR, Deel | Medium — useful once headcount and turnover justify it | Should-have, Phase 2 |
| 1:1 meeting notes | Lattice, 15Five, Leapsome | Low for 23 people with an already-thin management layer | Nice-to-have, Phase 3, optional |
| OKRs/goals | Lattice, 15Five, Leapsome, Workday | Medium — the reference site's "Department priorities — this quarter" progress bars are effectively OKRs already | Adapt lightly — reuse the existing quarterly-objectives UI, don't build a separate OKR module |
| Performance reviews / attestation | Lattice, 15Five (peer/360), Workday; Uzbek civil service has statutory "attestatsiya" | High but legally distinct from Western "performance review" — attestation is a periodic state-mandated re-certification with a commission, not a manager-written review | Must model separately, Phase 2-3 |
| Skills matrix/certifications | Odoo (basic), HiBob, Personio | Medium — useful for staffing analytics projects to the right specialist | Nice-to-have, Phase 3 |
| Training/learning plans | Frappe HR, Leapsome, Personio | Low-medium — civil servants have mandatory qualification-upgrade courses (malaka oshirish) on a cycle, worth tracking as dates not as an LMS | Track as dates/reminders only, avoid building an LMS |
| Succession planning | Workday, HiBob (enterprise tier) | Low for 23 people | Avoid entirely for now |
| Capacity/workload views | Rippling, custom BI in most tools | Medium — director wants to see who's overloaded across 14 active projects | Should-have, Phase 3, derive from existing project-assignment data rather than a separate module |
| Birthdays/anniversaries | BambooHR (famous "high five" feature), HiBob | Low bureaucratic value, high goodwill value, near-zero build cost | Adopt — cheap, humane, matches the Activities module's tone |
| Kudos/recognition | Bonusly, HiBob, Lattice | Medium — cheap culture win, but easily ignored/gamed | Adopt in lightweight form only (see below) |
| Surveys/pulse | Leapsome, 15Five, Personio, HiBob | Low-medium; anonymity is hard to guarantee credibly at 23 people | Adapt carefully — quarterly only, explicit anonymity mechanics, or avoid |
| Exit/offboarding record | All | Medium — needed for institutional memory when someone leaves a policy portfolio | Should-have, Phase 2 |

## Deep dive: employee record and privacy tiers

The reference prototype already states the requirement precisely: "Dates of birth and personal contact details should be visible only to authorized HR and managers." This is exactly BambooHR's and Personio's field-level visibility model — every field on the employee record carries a visibility tag (public / internal / restricted), not a page-level permission. BambooHR's "employee record" concept separates a public directory card (name, title, department, work email/phone, photo) from an "employee file" (home address, national ID, salary, emergency contact, medical info) visible only to the employee, their manager, and HR admins. Odoo's Employees app follows the same pattern with a "HR Settings" tab hidden from non-HR roles.

For our context, the right granularity is three tiers matching what the reference site's roadmap already names: **public** (directory card — name, position, unit, work contact, education), **internal** (visible to unit members and up — birthday, start date, skills), **restricted** (HR/director only — passport/PINFL, home address, salary, medical/disability status, family composition for benefits). PINFL (personal identification number) and passport data fall under Uzbekistan's 2019 Law "On Personal Data" (О персональных данных, amended 2021) requiring localization of citizen personal data storage — this is a hosting-location decision, not just a database schema decision, and confirms the brief's on-premise/gov-cloud assumption.

## Deep dive: org chart, vacancies, and the staffing table ("shtat")

Every commercial HRIS org chart (HiBob, Deel, Odoo, Factorial) draws a live tree from the manager field on each employee record and auto-updates when someone moves. None of the commercially documented tools treat an **unfilled position** as a first-class node with its own budget line, grade, and open/closed status — they model organizations as a graph of people, because in a US/EU SMB, "position" and "person" are usually the same thing administratively (HR just deletes the node when someone leaves).

This is wrong for a government department. In Uzbek public administration, the "shtatnoe raspisanie" / "shtat jadvali" (staffing table) is a legally approved document — a fixed list of positions, grades, and salary points that exists independently of who occupies them, approved by the ministry/director and changed only through a formal order. A department can have an approved but *vacant* Head of Sub-department position for months; that vacancy is itself an operationally important fact (who's acting, when is the competition, what's the budget impact) — the reference site's org chart (director → 4 sub-departments with head + headcount) hints at this but treats a headcount number, not named position slots.

**Design implication:** model `Position` (title, grade/rank, unit, approved-headcount-slot-number, status: filled/vacant/frozen) as a separate entity from `Employee`, with a nullable one-to-one or one-to-many (job-share) link. The org chart renders positions, not people — a vacant box appears with a dashed border and an "Acting: [name]" or "Vacant since [date]" label, matching the "dotted lines" pattern some HRIS vendors (Deel, HiBob) use for secondary/dotted reporting relationships (e.g., a project lead reporting operationally to a program owner while administratively belonging to their home sub-department — directly relevant to our cross-department project assignments).

## Deep dive: leave/time-off — the pattern to copy exactly

This is the strongest, most convergent evidence across every vendor: every mature HRIS (BambooHR, Rippling, Personio, HiBob, Deel, Factorial, Frappe HR, Odoo) implements the same three-screen loop:

1. **Request** — employee taps "Request time off," picks dates on a calendar that already shows their remaining balance and teammates' approved absences overlaid (so they self-select around conflicts before submitting), picks a leave type from a short dropdown (annual/sick/unpaid/other), optionally adds a note, submits. Two to four taps total, no separate "reason" essay field required for standard annual leave.
2. **Approve** — the manager receives a push/email/chat notification with Approve/Deny buttons inline — no login required to action it in Rippling and Deel; BambooHR and Personio still require opening the app but keep it to a single card view showing the requester's balance-after-request so the manager isn't approving blind.
3. **Reflect** — the balance updates immediately, a shared team calendar shows the absence, and (in Frappe HR, Odoo) an optional payroll/attendance sync fires.

The one design detail worth calling out because it is easy to miss: showing the *remaining balance at the moment of picking dates*, not after submission — this is what makes it feel like self-service instead of a form. Multiple vendors (BambooHR, Personio) surface accrual math ("You'll have 12.5 days left after this request") directly under the date picker.

For our department, this maps directly onto the brief's target: **"request leave in 3 clicks with balance shown, manager approves from notification."** That target is not aspirational — it is the median UX of every 2025-era HRIS studied, not a stretch goal. The failure mode to avoid is the government-paper-form pattern: multi-field forms with "basis," "type of leave (per which article)," printed and signed. We should let the underlying data model carry the legal metadata (which Labor Code leave category, article reference for audit) while the UI shows only the two or three fields a human actually decides: dates, type, note.

**Uzbekistan-specific leave categories to model** (from the fetched Labor Code excerpt, Articles 217–220, and standard Uzbek HR practice — see Open Questions on the exact day-count, which the fetch could not fully confirm): base annual leave (a statutory minimum measured in calendar days, with categories of employees entitled to an *extended* annual leave — Article 218 — and additional days for continuous service in one organization — Article 220); sick leave (paid via social insurance against a medical certificate, not deducted from annual leave); unpaid leave at the employee's request; and study leave for those in state-sponsored further education. Do not hardcode a single "21 days" constant in the schema — leave entitlement varies by category/hazard class/tenure and changes when the law changes, so it belongs in a configurable `LeavePolicy` table keyed by category and effective date range.

## Deep dive: business trips (komandirovka) — a distinct workflow, not a leave type

None of the Western SaaS products model this because it doesn't exist in their markets in this form. In Uzbek (and broader CIS) public-sector practice, a business trip requires a formal order (prikaz o komandirovke) specifying: destination, purpose, dates, per-diem/daily allowance rate, transport/accommodation cost basis, and the issuing official's signature — it is simultaneously an HR record, a finance record (advance payment and expense reconciliation on return), and a legal record (the employee is covered by labor protections while traveling and the trip counts as working time under Article 196). Frappe HR's "Expense Claims / Travel and Expense accounting" module is the closest commercial analog but still frames it as reimbursement, not as an order requiring pre-approval before travel.

**Design implication:** `BusinessTrip` should be its own entity (not a `LeaveRequest` subtype) with a lifecycle: Requested → Order issued (with generated order number) → In progress → Return/report filed → Expense reconciled. This is exactly the kind of "connected workflow" the reference site's Phase 2 roadmap gestures at ("document links + approval history") — komandirovka is the single most concrete instance of that pattern in daily departmental life (international coordination trips, EGDI-related travel, inter-ministry visits are explicitly part of Strategy & Rankings' mandate).

## Deep dive: attestation vs. "performance review" — do not conflate them

Western performance-management tools (Lattice, 15Five, Leapsome) implement manager-written or 360° reviews on a self-set cadence (quarterly/annual), tied to compensation or promotion conversations, entirely internal to the company. Uzbekistan's civil service has a statutory **attestatsiya** — periodic re-certification of a civil servant's fitness for their rank/position, conducted by a formal attestation commission, with a defined cycle and formal outcomes (confirmed / rank change / demotion / dismissal grounds). This is a compliance process with legal consequences, not a coaching conversation. Building it as if it were a Lattice-style peer-feedback cycle would misrepresent its stakes to users and could create legal exposure if the tool's output were treated as the official record when the official record must be a signed protocol.

**Recommendation:** track attestation as a compliance-calendar entity (next attestation due date per employee, commission composition, outcome, linked order number) completely separate from any lightweight internal check-in feature we might add later. Do not build 360° peer review, calibration, or 9-box grids — these are Workday/Lattice enterprise features irrelevant at 23 people and actively resented even in the companies that have them (see Anti-patterns below).

## Onboarding/offboarding

BambooHR's onboarding checklist (task list assigned across HR/IT/manager with due dates relative to start date, "Welcome" package for the new hire's personal email pre-start) is the widely copied pattern (also in Rippling, Deel, Frappe HR's "Employee Lifecycle Management"). For a 23-person department the value is less about scale and more about **not losing institutional knowledge** — a checklist template per position type (Specialist, Lead, Head) covering: system accounts, building/badge access, assignment to a sub-department mandate briefing, introduction to current project portfolio, and — specific to the domain — access to whichever restricted data sets (EGDI methodology files, FinTech regulatory data) the role touches. Offboarding mirrors this: revoke access, reassign owned projects (the Projects register's "single accountable owner" field must never go orphaned), archive restricted-tier data per retention rules, exit note for succession.

## Anti-patterns and negative evidence

- **Workday's navigation model** is the standing industry example of "powerful data model, unusable surface" — its own marketing (fetched) now leans entirely on "AI agents" and chat-style task completion as a workaround for the fact that finding a task through its business-process/worklet navigation historically required training or a cheat-sheet. The lesson for us is structural: don't let configurability (custom business processes, unlimited condition rules) become the primary interface. Every screen should have one obvious primary action, not a workflow the user must first learn to locate.
- **Feature bloat as a stated complaint pattern** across mid-market HRIS (Personio, Rippling, Factorial) documented in G2/Capterra review aggregation (not independently re-verified this pass due to fetch blocks, flagged in Open Questions) is consistently: modules nobody asked for, admin settings screens with hundreds of toggles, and performance-review cycles that HR mandates but managers experience as extra homework. The pattern repeats enough across products from different vendors that it should be treated as a structural risk of the product category, not a vendor-specific bug — the fix is ruthless scope control per phase, which the reference site's own 3-phase roadmap already models correctly.
- **Recognition/kudos features atrophy** when not paired with a real ritual — the common failure is a "give kudos" button nobody uses after week 3 because it has no natural trigger. Pairing it with something that already has a cadence (the Friday project-comment ritual, or event RSVPs from the Activities module) is more likely to survive than a standalone feature.
- **Anonymous pulse surveys at very small N are not actually anonymous** — at 23 people split across 4 sub-departments (avg team 5.5), a department-level breakdown of survey results can deanonymize individuals by elimination. Any survey feature must either aggregate only at the full-department level or be dropped.
- **Government HRIS rollouts fail on data migration and change management, not features** — this is a well-documented pattern in public-sector IT generally (not separately re-verified this session): the tool matters less than whether the staffing table, historical leave balances, and org history were faithfully migrated, and whether the rollout gave existing paper/Excel-based approval habits an equally fast alternative from day one.

## Data model sketch

```
Unit (sub-department or department)
  id, name, mandate_text, parent_unit_id (nullable), head_position_id (FK -> Position)

Position ("shtat" slot)
  id, unit_id (FK), title, grade/rank, approved_fte (usually 1.0),
  status: filled | vacant | frozen,
  reports_to_position_id (nullable, solid line),
  dotted_line_to_position_id (nullable, secondary/matrix reporting),
  effective_from, effective_to (staffing table changes are dated, versioned)

Employee
  id, full_name, photo, work_email, work_phone,
  position_id (FK -> Position, nullable if between roles),
  start_date, employment_status: active | on_leave | terminated,
  privacy_fields: { public: {...}, internal: {...}, restricted: {...} }
  restricted: pinfl, passport_no, home_address, dob, emergency_contact,
              medical/disability flag, family_composition

LeavePolicy
  id, category (annual_base | annual_extended | sick | unpaid | study | maternity),
  days_per_year, accrual_rule, effective_from, effective_to, legal_reference

LeaveBalance
  employee_id, category, year, accrued_days, used_days, remaining_days

LeaveRequest
  id, employee_id, category, start_date, end_date, note,
  status: draft | pending | approved | denied | cancelled,
  approver_id, approved_at, legal_article_ref

BusinessTrip
  id, employee_id, destination, purpose, start_date, end_date,
  order_number, per_diem_rate, advance_amount,
  status: requested | order_issued | in_progress | report_filed | reconciled

AttendanceRecord (optional, Phase 2)
  employee_id, date, clock_in, clock_out, status: present|absent|remote|leave

Attestation (civil-service compliance)
  employee_id, due_date, commission, outcome, order_number, next_due_date

OnboardingChecklist / OffboardingChecklist
  employee_id, template_id, tasks[{task, owner_role, due_offset_days, done_at}]
```

Key modeling decisions embedded above: Position is decoupled from Employee (staffing table survives vacancies); every leave/trip record carries a legal reference field so the audit trail satisfies civil-service record-keeping without cluttering the request UI; restricted fields are a distinct sub-object on Employee so field-level access control is enforced at the data layer, not just hidden in the UI.

## What this means for us

1. **[ADOPT]** Build the three-tap leave request flow (dates on a balance-aware calendar → type → submit) and one-tap manager approval from a notification, copied near-exactly from BambooHR/Deel/Rippling's converged pattern — it is the single highest-confidence, lowest-risk UX win available and directly answers the brief's "3 clicks with balance shown."
2. **[ADOPT]** Model `Position` as separate from `Employee` with a vacancy state and dashed-border org-chart rendering — no mainstream HRIS studied does this well, and it is a real, named legal document (shtat) in our context; skipping it means the org chart will be wrong the first time someone resigns.
3. **[ADOPT]** Field-level privacy tiers (public/internal/restricted) on the employee record, enforced at the data layer, matching the reference site's own stated requirement and Uzbekistan's Law on Personal Data.
4. **[ADOPT]** Birthdays/anniversaries as a passive, low-effort surface (e.g., a quiet line on the Overview/home screen) — near-zero build cost, consistently cited as goodwill-positive, fits the "humane" tone already established by the Activities module.
5. **[ADAPT]** Reuse the Overview page's existing quarterly-objectives progress bars as the department's OKR mechanism instead of building a separate Goals module — it already exists in the reference site and covers 90% of what Lattice/15Five's OKR features do for a unit this size.
6. **[ADAPT]** Business trips (komandirovka) as their own workflow entity with an order-number lifecycle, not a leave-request subtype — this is a genuinely local requirement with no direct SaaS analog, and treating it as generic "time off" will produce a tool finance and legal cannot actually use.
7. **[ADAPT]** Attendance/tabel: implement the minimum viable version (daily present/remote/leave status, no biometric clock-in) rather than Factorial/Frappe's geolocation-and-QR clock-in — a policy department doing analytical work does not need shift-level time tracking, and heavy attendance monitoring reads as distrust in a 23-person team.
8. **[ADAPT]** Attestation: model it as a compliance-calendar/record feature (due dates, commission, outcome, order reference), kept entirely separate from any lightweight internal check-in feature, because it is a legal certification process, not a coaching ritual — conflating the two risks both under-serving the legal requirement and turning check-ins into something employees fear.
9. **[AVOID]** Full performance-review suites with 360° peer feedback, calibration, or 9-box succession grids (Lattice/15Five/Workday-style) — wrong scale (23 people, thin management layer) and the single most commonly cited source of "extra homework" resentment in the products that have it.
10. **[AVOID]** A dedicated LMS/training-plan module — track mandatory qualification-upgrade (malaka oshirish) cycles as calendar reminders on the employee record instead of building course catalogs, enrollment, and certificates.
11. **[AVOID]** Succession planning as a standalone feature — irrelevant at this scale; if leadership ever needs it, it can be answered from the Position/vacancy data already modeled, not a separate module.
12. **[AVOID]** Anonymous pulse surveys below the whole-department level — with sub-departments averaging 5.5 people, any finer breakdown is functionally identifiable and will erode trust rather than build it; only run department-wide, infrequent surveys, or skip the feature.
13. **[AVOID]** Workday-style deep configurability (custom business-process builder, unlimited condition rules) as a design philosophy — it is the documented cause of the "needs training" problem the brief explicitly wants to avoid; prefer fixed, opinionated flows with minimal admin-configurable surface area.
14. **[AVOID]** Building recognition/kudos as a freestanding feature with its own button and feed — if added at all, attach it to an existing ritual (the Friday project-comment cadence, or event RSVPs) rather than creating a new habit that has no natural trigger and will likely go unused after the first month.
15. **[ADOPT]** Self-host on open-source HRIS-grade primitives (Frappe HR's GPL-3.0 leave/attendance engine or Odoo's LGPL-3.0 HR module are viable references for schema and workflow logic) rather than a foreign commercial SaaS whose data residency cannot be guaranteed inside Uzbekistan — directly required by the personal-data localization law and the brief's on-premise/gov-cloud assumption; these can be studied for data-model patterns even if we build our own UI layer on top.

## Open questions

- The exact statutory annual leave day-count for civil servants (the brief states "21+ days"; the fetched Labor Code excerpt only confirmed a general minimum via Article 217 plus extended-leave provisions in Articles 218/220, without the specific number, because the live government portals (mehnat.uz, lex.uz specific article pages) either redirected or returned 404/timeout during this research pass) needs confirmation directly against the current Labor Code text or from the department's own HR/legal officer before being hardcoded into any `LeavePolicy` default.
- Exact attestation cycle length and commission composition rules under the 2022 Law on Civil Service (ZRU-793) were not independently re-verified this pass (the specific lex.uz document ID attempted returned 404) — confirm with the ministry's HR/legal function.
- Whether sick leave requires an uploaded medical certificate (bolnichny list / vaqtinchalik mehnatga layoqatsizlik varaqasi) as an attachment in-app, or remains a paper process reconciled separately with social insurance — affects whether `LeaveRequest` needs a file-attachment field for this category specifically.
- Whether the department wants komandirovka per-diem rates to vary by destination (domestic vs. international travel, which is realistic given Strategy & Rankings' international coordination mandate) — affects whether `BusinessTrip.per_diem_rate` is a flat field or references a rate table.
- User-review-aggregator evidence (G2/Capterra/TrustRadius/Reddit) for BambooHR, Rippling, Personio, HiBob, Lattice, 15Five, Leapsome, and Gusto could not be freshly fetched this session (403/404/429 responses) — the complaint patterns cited under "Anti-patterns" reflect well-documented, widely repeated industry commentary but were not re-verified against live review text in this pass; worth a follow-up fetch pass before treating specific complaint percentages or quotes as citable.
- Whether "capacity/workload views" should be a real-time computed view over existing project assignments (recommended) or a separate manually-maintained module — needs a product-owner call once the Projects module's assignment data model is finalized.
- Multi-tenant implications: when this expands to other ministries, does each tenant get its own `LeavePolicy`/attestation-cycle configuration (near-certain, since civil-service rules can differ by agency type), and how does that affect the schema's policy-versioning design?

## Sources

- Reference site audit (internal): C:/Users/rpwal/Documents/Work/eGov/WorkPortal/docs/00-reference/reference-site-audit.md
- Workday.com homepage — https://www.workday.com
- Frappe HR product page — https://frappe.io/hr
- Frappe HR / HRMS GitHub repository — https://github.com/frappe/hrms
- OrangeHRM features page — https://www.orangehrm.com/features/
- OrangeHRM GitHub repository — https://github.com/orangehrm/orangehrm
- Odoo Employees app page — https://www.odoo.com/app/employees
- Deel HR product page — https://www.deel.com/hr
- Factorial HR features page — https://factorialhr.com/features
- Uzbekistan Labor Code text (partial fetch, Articles 195-196, 217-220) — https://lex.uz/docs/6257291
- Ministry of Employment and Labor Relations of Uzbekistan portal (redirect target, navigation only, no article text retrieved) — https://gov.uz/oz/bv
- Frappe HRMS GitHub license file (confirms GPL-3.0) — https://github.com/frappe/hrms/blob/develop/license.txt
- Odoo official documentation, Licenses page (confirms Community Edition, including Employees/HR, is LGPL-3.0) — https://www.odoo.com/documentation/master/legal/licenses.html
- Odoo Editions comparison page (confirms Employees/HR app is present in Community edition) — https://www.odoo.com/page/editions
- Lattice platform page (Performance, Goals & OKRs, Engagement, Grow, Compensation, Analytics modules; compensation-to-performance integration) — https://lattice.com/platform
- Leapsome homepage (Talent Suite positioning: unified people-data foundation, hiring-to-performance-to-learning loop, EU hosting/GDPR/ISO 27001 compliance framing) — https://www.leapsome.com/
- 15Five homepage (Engage pulse-survey module, Kona AI manager coaching, all-in-one integrated positioning vs. modular point solutions) — https://www.15five.com/
- Gusto company overview, Wikipedia (payroll-first product that added benefits/HR administration around payroll as the core primitive) — https://en.wikipedia.org/wiki/Gusto_(company)
- Telegram Bot API features documentation (inline keyboards, callback buttons, private per-user responses in group chats) — https://core.telegram.org/bots/features
- GDPR Article 9 text, gdpr-info.eu (special categories of personal data, including health data, and the stricter lawful-basis conditions that apply) — https://gdpr-info.eu/art-9-gdpr/
- Microsoft Azure Architecture Center, "Tenancy Models for a Multitenant Solution" (pooled/siloed/vertically- and horizontally-partitioned tenancy models, tenant-identifier scoping, isolation spectrum) — https://learn.microsoft.com/en-us/azure/architecture/guide/multitenant/considerations/tenancy-models
- DLA Piper Data Protection Laws of the World, Uzbekistan chapter (Law "On Personal Data" No. ZRU-547; localization requirement effective 16 April 2021; Special/Biometric/Genetic personal data categories) — https://www.dlapiperdataprotection.com/index.html?t=law&c=UZ
- Frappe HR product page, re-fetched for remote-work and payroll-integration boundary claims (distributed-workforce framing; native ERPNext payroll integration vs. REST API/webhook for external payroll) — https://frappe.io/hr

**Note on sourcing limitations:** Live WebSearch was unavailable for the entirety of this research task (session quota exhausted). Several planned WebFetch targets for BambooHR, Rippling, Personio, HiBob, Lattice, 15Five, Leapsome, Gusto, and all review-aggregator sites (G2, Capterra, TrustRadius) returned HTTP 403/404/429 or DNS/timeout errors and could not be read. Statements about those products draw on documented, widely corroborated product knowledge rather than a page fetched in this session, and are flagged in "Open questions" for a follow-up verification pass.

## Editor's verification notes (hr-people-ops-features)

**Method:** WebSearch was unavailable for this verification pass too (session quota exhausted on the first five queries attempted). Verification relied on WebFetch against GitHub repos, vendor docs, and lex.uz directly.

### Confirmed
- OrangeHRM is GPL-licensed (confirmed v3: "OrangeHRM is free software... under the terms of the GNU General Public License... version 3") — matches the report's general "AGPL/GPL" framing for the open-source cluster.

### Corrections (material)
- **Frappe HR's license is wrong.** The report states three times (TL;DR, Sources framing, and recommendation #15: *"Frappe HR's AGPL-3.0 leave/attendance engine"*) that Frappe HR/HRMS is AGPL-3.0. Fetching `github.com/frappe/hrms` and its `license.txt` directly confirms the license is **GPL-3.0**, not AGPL-3.0. This is a material error for a document whose stated purpose is informing a self-hosting/data-localization decision: AGPL's network-use copyleft trigger (source-disclosure obligation for SaaS-style deployment) does not apply to a plain GPL-3.0 project the way the report implies. Fix: replace "AGPL-3.0" with "GPL-3.0" everywhere Frappe HR's license is cited.
- **Odoo's HR module license is wrong.** The report calls it "Odoo's GPL HR module" (recommendation #15). Odoo's own documentation states Community Edition (which includes the Employees/HR apps) is licensed **LGPL-3.0**, not GPL. LGPL is meaningfully more permissive for linking/extending than GPL — relevant to the same self-hosting decision the report is trying to inform. Fix: correct to "Odoo's LGPL-3.0 HR module."
- Net effect: two of the report's three headline open-source licensing claims were wrong in the same direction (both overstated the copyleft strength — AGPL is stronger than GPL, GPL is stronger than LGPL). Anyone citing this document to justify a self-hosting/licensing strategy would currently over-estimate the compliance obligations of both projects.

### Unverifiable (tools could not confirm either way)
- The exact statutory annual-leave day count under Uzbekistan's Labor Code (Article 217) — lex.uz's article page could not be fetched with usable text in this pass either (table-of-contents only, same failure mode the report already disclosed). The report's own flagging of this as an open question stands; it is not a new gap, but it remains unconfirmed and should not be treated as resolved.
- The 2019 Law "On Personal Data" (amended 2021) localization requirement and its exact citation — the lex.uz document ID could not be located/fetched (404 on the ID guessed) either in this pass or the prior one. However, a secondary source (DLA Piper's Data Protection Laws of the World guide) independently corroborates the substance: it names the law as **No. ZRU-547**, cites a localization requirement introduced 15 January 2021 and effective 16 April 2021 requiring that "personal data of Uzbek citizens processed with the use of information technologies... must be collected, systematized and stored on technical means physically located on the territory of Uzbekistan," and separately confirms a distinct "Special Personal Data" category covering health/mental-health status, political/religious beliefs, and criminal records, plus separate Biometric and Genetic categories. This raises confidence in the report's claim considerably (two independent sources now agree on substance and law number) but is still a secondary citation, not the primary lex.uz article text — confirm the primary text before using this as a compliance citation in a legal/procurement document. See Gap-fill addendum, "Sensitive-category personal data" below.

### Gaps: brief topics that are missing, thin, or hand-waved
1. **Remote-work days** — named explicitly in the brief but the report only surfaces it as one enum value (`remote`) inside `AttendanceRecord`. There is no discussion of a remote-work request/approval workflow, hybrid-schedule policy, or how "remote day" differs operationally from "on leave" — a real gap given the brief called this out as its own feature category.
2. **Vendor-specific UX differentiation for Lattice / 15Five / Leapsome / Gusto** — the brief asked to research each named vendor's "best UX." The report treats Lattice/15Five/Leapsome as one interchangeable "Western performance tool" cluster without describing what each is actually best-known for (Leapsome's OKR+review combo, 15Five's pulse/wellbeing angle, Lattice's comp-linked goals). Gusto is never discussed as a product at all — it appears only in the sourcing-limitations note as an unfetched URL, with no explicit reasoning for why its payroll-native model is or isn't relevant to a civil-service department.
3. **Multi-tenancy in the data model** — the project brief is explicit that the platform must be multi-tenant across ministries/departments. The report acknowledges this only as a single open question at the end ("does each tenant get its own LeavePolicy/attestation-cycle configuration") and the data model sketch has no `tenant_id`/`organization_id` scoping on any entity (Unit, Position, Employee, LeavePolicy). For a document meant to hand off a schema sketch, this is a significant omission given how explicitly multi-tenancy is called out in the project's own framing.
4. **Audit/history trail as a first-class entity** — the report repeatedly argues that legal/audit traceability matters (leave "legal_article_ref," Position "effective_from/effective_to," attestation "order_number") but never models an `AuditLog`/history table. Given how much prose is spent justifying audit-friendliness, the absence of a concrete audit entity in the schema is an inconsistency a reviewer would flag.
5. **Adjacent and absent: Telegram-based approval, payroll/compensation boundary, sensitive-category personal data handling.** The project context explicitly names Telegram as the dominant local messenger, yet the leave-approval flow (arguably this dimension's single most important UX moment) only generically cites "push/email/chat notification... no login required in Rippling and Deel" without connecting it to a Telegram-bot approval pattern, which is the most obviously "zero training" channel for this specific deployment. Separately, the report puts `salary` and `medical/disability flag` under "restricted" employee fields but never discusses (a) whether/how the platform interfaces with or deliberately excludes payroll systems, or (b) that health/disability status is typically a *special category* of personal data under most data-protection regimes and may need protections beyond a generic "restricted" tier (e.g., separate consent, narrower access than salary). Both are natural adjacent questions a senior product/engineering lead would raise and neither is addressed.

### Verdict inputs
- Coverage: strong and unusually well-structured on the majority of named brief items (employee record, org chart/shtat, leave, komandirovka, attestation are all deep-dived with concrete data-model consequences), but 5 identifiable gaps above, including one (multi-tenancy) that bears on the platform's core stated ambition.
- Evidence: the report's own honesty about its sourcing limitations is a strength, but this pass found two confirmed factual errors (Frappe HR license, Odoo HR module license) in claims the report stated as settled fact rather than flagging as uncertain — both point the same direction (overstating copyleft strength), which suggests the underlying "documented product knowledge" the report leaned on should not be trusted uncritically for licensing specifics going forward.

## Gap-fill addendum

**Method for this pass:** WebSearch was unavailable for this pass as well — the session's search budget was already exhausted (200/200) before this task began, confirmed by the tool itself rather than assumed. All new material below comes from WebFetch reads that returned usable content; several targeted fetches (Gusto's own product/blog pages, Rippling's and SHRM's hybrid-work articles, Deel's developer payroll docs, a generic multi-tenant-SaaS blog post) 403'd, 404'd, or DNS-failed and are not cited. This mirrors the report's own disclosed pattern and is flagged here rather than papered over.

### Remote-work days: a request/approval workflow and hybrid-schedule policy, not just an attendance enum

The original report's only mention of remote work is the `remote` value inside `AttendanceRecord.status` — a passive record of where someone worked, with no lifecycle. That is not what "remote-work days" means operationally in a 2025-era hybrid workplace, and it is a real gap given the brief named it as its own category.

The pattern worth copying is distinct from the leave-request pattern, not a copy of it:
- **Leave is scarcity-based** (a finite balance that depletes and must be protected from overuse) — it needs a balance check, an approval gate, and a calendar block.
- **Remote-work days are schedule-based**, not balance-based, in the mainstream hybrid-work model most organizations converged on by 2024-2025: a fixed weekly policy (e.g., "3 days in-office, 2 remote, employee/team chooses which") that rarely needs individual approval at all — it needs *visibility* (who's in the building today) far more than it needs *gatekeeping*. The exception is an ad-hoc, one-off remote day outside the normal pattern (a home repair, a sick child, weather), which does warrant a lightweight, same-day manager notification — but explicitly not the multi-day-advance-notice, balance-checked flow leave requests deserve, because treating every remote day like a leave request recreates exactly the "extra homework" friction the report's own Anti-patterns section warns about elsewhere.

**Design implication:** model two separate, lighter-weight things instead of overloading `AttendanceRecord`:
1. `HybridSchedulePolicy` (per unit or per employee): the *default* pattern — which weekdays are expected in-office vs. remote-eligible, effective-dated like `LeavePolicy` so it can change department-wide without touching individual records.
2. `RemoteDayException`: employee_id, date, reason (optional free text), notify_only boolean (true for the common ad-hoc case = fire-and-forget notification to the manager and team calendar, no approval gate; false only for the rare category requiring sign-off, e.g. remote work from outside the country, which has its own tax/labor-law wrinkles worth flagging to HR rather than silently allowing).

This keeps the "3 clicks" ethos intact: for the common case, marking "remote today" is a single tap that posts to a shared team-presence view, not a form that waits on approval. Reserve actual approval gating for the exception case, not the default pattern.

### Vendor-specific UX differentiation: Lattice, 15Five, Leapsome, Gusto

The original report's Deep dive on attestation collapses Lattice/15Five/Leapsome into one "Western performance-management tools" cluster. That's defensible for the attestation-vs-performance-review argument (all three share the same "internal, manager-driven, self-set cadence" shape relative to civil-service attestation), but it hides real product differences worth naming for anyone using this report to pick a reference UX pattern rather than an attestation contrast:

- **Lattice** — organizes itself around eight modules (Performance, Goals & OKRs, Engagement, Grow, Compensation, Analytics, an AI Agent, and an MCP-based conversational interface for drafting reviews) with the explicit differentiator being **compensation tied directly to performance and goal achievement** — pay-review cycles that pull from the same goals/performance data rather than a separate comp spreadsheet. Its own marketing frames it as a "daily destination for work" rather than a quarterly-only tool, with a customer-cited "3.5x higher check-in completion rate than in Workday" — a data point worth noting precisely because it is Lattice positioning itself *against* Workday's navigation problem, the same anti-pattern this report already flags. [Source: lattice.com/platform]
- **Leapsome** — differentiates on a **unified "Talent Suite" data foundation**: hiring context feeds into performance reviews, and performance data feeds back into learning-path and future-hiring decisions, marketed as a system that "self-improves" via shared people data rather than three disconnected modules. Leapsome also foregrounds **European hosting, GDPR compliance, and ISO 27001 certification** as a selling point — a residency/compliance-first positioning that is directly analogous to the data-localization posture this platform needs, even though Leapsome itself (EU-hosted SaaS) would not satisfy Uzbekistan's localization law. [Source: leapsome.com]
- **15Five** — differentiates on the **pulse-survey/engagement and manager-coaching angle**: its "Engage" module does lifecycle pulse surveys with AI-flagged engagement drivers, and its "Kona" AI assistant plus a manager content library are pitched explicitly as *upskilling managers*, not just tracking their reports. 15Five positions itself as consolidating reviews + engagement + comp insights + manager coaching into one system aimed at replacing fragmented point solutions. [Source: 15five.com]
- **Gusto** — was never actually discussed as a product in the original report despite being named in the brief, appearing only as an unfetched URL in the sourcing-limitations note. Gusto's defining characteristic is the opposite design center from Lattice/15Five/Leapsome: it is **payroll-first**, having rebranded from "ZenPayroll" in 2015 specifically to fold benefits administration (health/dental/vision enrollment, workers' comp, 401(k)) and basic HR (onboarding paperwork, PTO tracking) *around* a payroll core, rather than being an HR/performance tool that payroll was bolted onto later. [Source: Wikipedia, Gusto (company)] This matters for our design center precisely because our platform explicitly should **not** be payroll-first (payroll for Uzbek civil servants runs through the state treasury/budget-organization payroll system, not a department-level tool) — Gusto's architecture is the clearest available illustration of the *wrong* center of gravity for us, useful as a named negative example rather than a pattern to borrow.

**Net read:** none of the four should be copied as designed — Leapsome's data-unification idea and Lattice's comp-linkage idea are the only pieces with any relevance, and only as far-future (Phase 3+) options once/if the platform ever adds a lightweight internal check-in feature (which recommendation #9 already says to avoid for now). Gusto is relevant only as a cautionary contrast on integration boundary (see below), not as a UX model.

### Multi-tenancy: adding tenant scoping to the data model sketch

The brief is explicit that this platform must scale to other ministries/departments, and the original report's data model sketch has zero `tenant_id`/`organization_id` fields anywhere — a real gap for a document meant to hand off a schema.

Microsoft's Azure Architecture Center's tenancy-model guidance (a vendor-neutral framework, not Azure-specific in its reasoning) is directly useful here: it frames tenancy not as a binary but as a spectrum from fully isolated (separate database/infra per tenant) to fully shared (single schema, tenant identifier column on every row), with vertically- and horizontally-partitioned middle options, and it recommends choosing based on expected tenant count, compliance/isolation requirements, and operational capacity to manage many deployments. [Source: learn.microsoft.com/azure/architecture/guide/multitenant]

For a ~23-person department expanding to "other ministries" over a multi-year roadmap, a **pooled (shared-schema) model with a `tenant_id` (call it `organization_id` to match Uzbek government terminology — a ministry or department) foreign key on every top-level entity** is the right starting point, not a database-per-tenant approach: tenant count will likely stay in the tens (agencies), not thousands, so the cost/isolation tradeoff that pushes SaaS vendors toward per-tenant databases doesn't apply, and a shared schema keeps the "goes viral across government" ambition operationally cheap to fulfill (one deployment, many onboarded departments) rather than requiring a new environment stood up per ministry. The one place isolation should be stronger than a bare column is exactly where the original report already flagged sensitivity: `restricted`-tier employee fields and any `AuditLog` (below) should be scoped with row-level security enforced at the query layer, not just an application-level `WHERE organization_id = ?` filter that a future bug could omit.

**Concrete schema fix** — every top-level entity in the original sketch gains `organization_id` (nullable only during a single-tenant bootstrap phase, non-nullable from the first multi-tenant release):

```
Organization (new — a ministry, department, or agency)
  id, name_uz, name_ru, name_en, parent_organization_id (nullable — for a ministry with sub-departments as separate tenants if ever needed), locale_default, created_at

Unit
  id, organization_id (FK, NEW), name, mandate_text, parent_unit_id, head_position_id

Position
  id, organization_id (FK, NEW), unit_id, title, grade/rank, ... (unchanged otherwise)

Employee
  id, organization_id (FK, NEW), full_name, ... (unchanged otherwise)

LeavePolicy
  id, organization_id (FK, NEW), category, days_per_year, ... (unchanged otherwise)
  -- this directly answers the original report's own open question: yes, each
  -- tenant gets its own LeavePolicy rows, because civil-service leave rules
  -- already vary by agency type even within Uzbekistan (e.g. hazard-class
  -- extensions), and a shared LeavePolicy table scoped by organization_id
  -- handles that without a schema change per tenant.
```

Every other entity in the original sketch (`LeaveBalance`, `LeaveRequest`, `BusinessTrip`, `AttendanceRecord`, `Attestation`, `OnboardingChecklist`) inherits its tenant scope transitively through `employee_id → Employee.organization_id` and does not need its own redundant column, keeping the sketch from ballooning — the rule of thumb is: entities with no natural parent (`Unit`, `Position`, `Employee`, `LeavePolicy`) get `organization_id` directly, everything else gets it by join.

### Audit/history as a first-class entity

The original report argues repeatedly for audit traceability (leave `legal_article_ref`, Position `effective_from/effective_to`, attestation `order_number`) but never models the entity that would actually make the system auditable end-to-end: a record of *who changed what, when, and from what prior value*. Field-level effective-dating (what `Position` and `LeavePolicy` already have) tells you what was true at a point in time; it does not tell you who approved the change or reconstruct a full change history for a compliance inquiry ("who approved this leave, and did anyone edit the dates afterward?").

**Concrete schema addition:**

```
AuditLog
  id, organization_id (FK), entity_type (e.g. "LeaveRequest", "Position", "Employee"),
  entity_id, action (create | update | delete | approve | deny),
  actor_employee_id (nullable — system-triggered actions have no human actor),
  changed_fields: [{field, old_value, new_value}] (jsonb or equivalent),
  reason (optional free text — required for deny/override actions),
  occurred_at, ip_or_client_context (optional)
```

This should be populated automatically at the application/ORM layer (a write hook on every mutation to a tenant-scoped entity), not maintained by hand — the value of an audit log collapses the moment any write path can bypass it. Given the report's own emphasis on `legal_article_ref` and order numbers as compliance anchors, `AuditLog` is the entity that makes those anchors actually defensible in an inspection rather than just present in the schema.

### Telegram-bot approval: the actual "zero-training" channel for this deployment

The brief names Telegram as the dominant messenger in Uzbekistan, and the original report's leave-approval section describes "push/email/chat notification... no login required in Rippling and Deel" without connecting that pattern to Telegram specifically — a real gap, because generic "chat notification" undersells how good a fit this is here.

Telegram's Bot API supports **inline keyboards with callback buttons** attached directly to a message — a manager can approve or deny a leave request by tapping a button inside the Telegram message itself, with no app switch and no login, and the bot can then **edit that same message in place** to show the resulting status ("Approved by [name] at [time]") rather than sending a new message — which is a materially better UX primitive than push notifications from BambooHR/Personio (which still require opening the app) and matches or exceeds Rippling/Deel's "no login required" bar while running on the one messenger every civil servant in this deployment already has installed and checks constantly. Telegram also supports **private, per-user responses inside group chats** (visible only to the bot and the addressed user), which is directly useful for a sub-department's shared Telegram group: the manager's approve/deny buttons and any restricted-tier context (leave balance, note) can be shown only to them even inside a group conversation the whole unit is in. [Source: core.telegram.org/bots/features]

**Design implication:** treat the Telegram bot as the *primary* approval surface for this deployment, not a bolt-on notification channel alongside a web app — build `LeaveRequest.approve()`/`deny()` as the canonical action, exposed identically via the web UI and via the Telegram callback handler, so the bot is a first-class client of the same API rather than a notification-only integration. This is very plausibly a bigger single UX lever for this specific government context than the generic three-tap leave request pattern the original report (correctly) already recommends adopting — the two combine into "request from the phone, approve from Telegram in one tap," which is the actual answer to the brief's "civil servant needs zero training" bar.

### Payroll/compensation: an explicit non-integration boundary, not a silent omission

The original report puts `salary` under "restricted" employee fields but never states whether this platform talks to payroll at all. It should say so explicitly, because the omission reads as an oversight rather than a decision. Uzbek budget-organization payroll runs through state treasury/централизованная systems, not a department-level HR tool — so the right boundary is: **this platform is not a payroll system and should not attempt to become one.** Frappe HR's own architecture is a useful negative/positive contrast here: it offers payroll natively **only** when paired with its own ERPNext accounting module, and falls back to REST APIs/webhooks for connecting to any external payroll/accounting system otherwise [Source: frappe.io/hr] — i.e., even a vendor that *does* build payroll treats it as a separable module behind an API boundary, not something fused into the HR data model. Gusto is the sharpest illustration of the opposite, wrong-for-us architecture: a product where payroll is the core primitive that HR/benefits were added around [Source: Wikipedia, Gusto (company)] — exactly backwards from what a civil-service department needs, where payroll already exists elsewhere and this platform's job is to be a clean upstream source of the facts payroll needs (attendance days, approved leave, komandirovka per-diem amounts, position/grade for salary-point lookups), not to compute or disburse pay itself.

**Design implication:** define (even if Phase 3+) a one-way, read-only **export/webhook boundary** — this platform publishes attendance/leave/business-trip facts in a format the treasury payroll system (or its integration layer) can consume; it never receives payroll data back, and it never stores computed salary amounts, only the *inputs* to salary (grade/position, approved days, per-diem rates already in the `BusinessTrip` entity). This keeps `salary` genuinely out of scope rather than half-modeled, and avoids building compliance and reconciliation logic (tax withholding, benefits deduction) this team has no mandate to own.

### Sensitive-category personal data: health/disability needs a tier beyond generic "restricted"

The original report's three-tier model (public/internal/restricted) puts `medical/disability flag` in the same bucket as `salary` and `home_address`. Every data-protection framework checked in this pass treats health/disability data as categorically different from ordinary sensitive data, not just "more restricted":

- **GDPR Article 9** imposes a **blanket default prohibition** on processing health data (grouped with biometric, genetic, and other special categories), lifted only via one of ten narrow legal bases (explicit consent, employment-law obligation, vital interests, etc.) — a materially stronger bar than the "lawful basis" test that covers ordinary personal data like salary or address. [Source: gdpr-info.eu/art-9-gdpr]
- **Uzbekistan's own Law "On Personal Data" (No. ZRU-547)** independently draws the same line: it defines a distinct **"Special Personal Data"** category explicitly covering "physical or mental health," alongside political/religious beliefs and criminal records, and separately carves out **Biometric** and **Genetic** personal data as their own categories with their own processing regimes — meaning the local law already gives us the exact taxonomy to model, not just an EU import. [Source: DLA Piper Data Protection Laws of the World, Uzbekistan]

**Design implication:** split what the original report calls "restricted" into two enforcement levels, not one:
- **restricted** (HR/director only, ordinary sensitive data): PINFL, passport number, home address, DOB, salary, emergency contact, family composition.
- **special-category** (a strictly narrower access list than restricted — HR admin only, not "director" by default, with every read logged to `AuditLog`): medical/disability status, and, if ever collected, biometric or genetic data. Access should require a named, auditable reason (e.g., "processing a disability-accommodation request," "processing sick-leave certificate"), not blanket HR-role access, and the field should support "no data held" as a real state rather than defaulting to a false/negative value that itself discloses information on disclosure of the schema.

This is a small schema change (one more enum value on the privacy-tier field, `special_category` alongside `public/internal/restricted`) but a meaningful policy one: it stops `medical/disability flag` from being one checkbox among many restricted fields and forces a deliberate access-control decision on it, consistent with how both GDPR and Uzbekistan's own law already treat it.

### Updated recommendations (continuing the original numbering)

16. **[ADOPT]** Model remote-work days as a lightweight, notify-only default pattern (`HybridSchedulePolicy` + `RemoteDayException`) separate from the leave-request approval gate — most remote days need visibility, not permission, and treating them like leave recreates exactly the "extra homework" friction pattern this report already warns against.
17. **[ADOPT]** Build the Telegram bot as a first-class client of the same approval API the web app uses (inline-keyboard approve/deny that edits the message in place) rather than a notification-only add-on — this is plausibly the single highest-leverage, lowest-cost UX lever available for this specific deployment, more so than any Western SaaS pattern studied, because it rides the messenger every civil servant already has open.
18. **[ADOPT]** Add `organization_id` to every top-level entity (`Unit`, `Position`, `Employee`, `LeavePolicy`) now, even before a second tenant exists — retrofitting tenant scoping onto a live single-tenant schema is materially more expensive than building it in from the first migration, and a pooled shared-schema model (not database-per-tenant) is the right cost/isolation tradeoff at the expected scale of "a few dozen agencies," not thousands of SaaS customers.
19. **[ADOPT]** Add an `AuditLog` entity populated automatically at the write layer for every mutation on a tenant-scoped entity — the report's own repeated emphasis on legal traceability (article references, order numbers, effective-dating) is only actually defensible in an inspection if paired with a real "who changed what, when" record, which the original schema sketch never included.
20. **[ADOPT]** Split "restricted" into `restricted` and a narrower `special-category` tier for health/disability (and any future biometric/genetic) data, with mandatory audit-logged access and no default HR-wide visibility — both GDPR Article 9 and Uzbekistan's own Law on Personal Data (No. ZRU-547) independently draw this exact line, so it is not an imported EU requirement but a locally-grounded one.
21. **[ADAPT]** Treat payroll as an explicit one-way export/webhook boundary (this platform publishes attendance/leave/trip facts; it never computes or stores pay) rather than leaving the payroll relationship unstated — Frappe HR's own architecture (native payroll only when paired with its own accounting module, API/webhook otherwise) shows even vendors that build payroll keep it behind a boundary; Gusto's payroll-first architecture is the concrete example of the wrong center of gravity for a civil-service department whose payroll already runs through the state treasury.
22. **[AVOID]** Copying Lattice's comp-linked-goals model, Leapsome's unified-talent-data model, or 15Five's pulse/coaching model as designed — all three remain wrong-scale for 23 people per the original report's own reasoning (recommendation #9); the only transferable ideas (data unification, comp-goal linkage) are Phase 3+ options at most, not launch features, and are noted here only so a future reader knows they were considered and explicitly deferred rather than overlooked.

## Gap-fill addendum sources

(Full citations already merged into the main Sources list above; listed here again for traceability of which source backs which addendum claim.)

- Remote-work/hybrid pattern reasoning: synthesized from the original report's own already-cited vendor set (BambooHR, Rippling, Personio, Deel, Frappe HR) plus general 2024-2025 hybrid-work convergence; no new vendor-specific remote-work-policy page could be freshly fetched this pass (Rippling, SHRM, Gusto, and BambooHR hybrid-work URLs all 403/404'd) — flagged as a residual limitation, not resolved with a fresh primary source.
- Lattice — https://lattice.com/platform
- Leapsome — https://www.leapsome.com/
- 15Five — https://www.15five.com/
- Gusto — https://en.wikipedia.org/wiki/Gusto_(company)
- Telegram Bot API features — https://core.telegram.org/bots/features
- Multi-tenancy models — https://learn.microsoft.com/en-us/azure/architecture/guide/multitenant/considerations/tenancy-models
- GDPR Article 9 — https://gdpr-info.eu/art-9-gdpr/
- Uzbekistan Law on Personal Data (No. ZRU-547) and localization requirement — https://www.dlapiperdataprotection.com/index.html?t=law&c=UZ
- Frappe HR payroll-integration boundary (re-fetch) — https://frappe.io/hr
- Frappe HRMS license file (re-confirms GPL-3.0, used for the correction above) — https://github.com/frappe/hrms/blob/develop/license.txt
- Odoo licensing documentation (re-confirms LGPL-3.0, used for the correction above) — https://www.odoo.com/documentation/master/legal/licenses.html
