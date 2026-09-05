# Uzbekistan context: institutions, systems, law, language, culture

**TL;DR**
Uzbekistan already has a functioning e-government stack the product must plug into, not duplicate: OneID (id.egov.uz) for identity/SSO, E-Imzo for legally binding signatures, my.gov.uz as the citizen/business services front door, and ijro.gov.uz as the "execution discipline" (ijro intizomi) engine that already models exactly the topshiriq→deadline→escalation loop this platform wants to build for one department. Personal data of Uzbek citizens and employees must sit on servers physically located in Uzbekistan (Law on Personal Data, localization rule reinforced 2019–2021), which forecloses default use of foreign public cloud for anything with real names, phone numbers, or photos and points toward local hosting (UZINFOCOM/gov data centers) or an on-prem VM. The information environment is trilingual by necessity (Uzbek Latin as the constitutional/administrative default, Russian as the de facto working language of most 30+ civil servants, English for international reporting like EGDI), and Telegram is not "a channel," it is the channel — internal chats, instructions, and even some public services run through Telegram bots, so notifications strategy should assume Telegram before email. Civil-service culture is hierarchical and document/instruction-driven (topshiriq, ijro intizomi, tabel, komandirovka are lived realities, not translation exercises), which argues for a product built around "instructions with deadlines and visible ownership," matching the reference prototype's Friday-update/auto-escalation idea almost exactly.

---

## 1. Ministry of Digital Technologies and the national digital ecosystem

The **Ministry of Digital Technologies of the Republic of Uzbekistan** (Raqamli texnologiyalar vazirligi) is the successor to the former State Committee for Development of Information Technologies and Communications and the Ministry for Development of Information Technologies and Communications; it consolidates IT/telecom policy, e-government program management, and (at various points) cybersecurity oversight under one ministry. It is the natural "sibling" ministry to the department this product is built for — the department (Information & Analytical Activities) most plausibly sits organizationally close to or under this ministry's orbit, since EGDI/global-index tracking and "digital transformation" analytics are core Ministry of Digital Technologies concerns.

Two agencies matter operationally more than the ministry itself for a builder:

- **UZINFOCOM** (uzinfocom.uz) — described on its own site as the "unified integrator" for government IT infrastructure, responsible for "creation and support of state information systems" and "processing, managing, and storing data." It built and runs the unified government portal (gov.uz), launched January 1, 2023 under a "single window" principle, and reports 1,400+ specialists. For this project, UZINFOCOM (or an equivalent state integrator) is the realistic path to any future OneID/E-Imzo/my.gov.uz integration, and likely the reference point for "is this data allowed to leave the country." [uzinfocom.uz/en]
- **IT Park Uzbekistan** (it-park.uz) — the special legal/tax regime for IT companies ("residents"), positioned as "START local & GO global." IT Park residency (0% profit tax, customs/social-payment relief) is why most Uzbek software vendors are structured as IT Park residents; if this platform is ever spun out commercially or sold to other ministries as a product, IT Park residency is the standard local wrapper. Exact current resident count and benefit schedule should be pulled fresh from it-park.uz before quoting numbers — the site's public pages did not yield hard figures on this pass. [it-park.uz/en]

**Resolved (2026-09-05):** current Minister and full leadership/structure/subordinate-agency list are now confirmed directly from gov.uz — see [Gap-fill addendum §2](#gap-fill-addendum-2026-09-05) for the Minister's name, deputy ministers, department list, and all 25 named subordinate organizations.

## 2. "Digital Uzbekistan 2030"

Publicly known as the national digital-transformation strategy approved by presidential decree in 2020 (commonly cited as Decree PF-6079, October 5, 2020), with headline goals reported over the years including: raising the ICT sector's share of GDP several-fold by 2030, moving a large majority of public services fully online/interactive (vs. merely informational), materially improving Uzbekistan's UN E-Government Development Index (EGDI) ranking, expanding broadband and mobile broadband coverage nationwide, and building a domestic IT workforce/export sector (linked to IT Park's growth targets). **I could not re-verify the decree number, exact percentage targets, or the current mid-course progress report live this session** — the lex.uz document IDs I tried returned 404, and WebSearch was unavailable for the remainder of the task. Treat every number in this paragraph as "widely reported prior to this session, not re-confirmed" and pull the current strategy text from lex.uz or minjust.uz before using specific figures in any deliverable or pitch to leadership.

## 3. EGDI ranking — why it matters to this specific department

The Strategy & Rankings sub-department's core mandate (per the reference prototype) is EGDI and global-index tracking, so getting this right matters more here than anywhere else in the report. What is solid: the UN E-Government Survey is published every two years (2018, 2020, 2022, 2024, next in 2026) and scores every country on EGDI = average of OSI (Online Service Index), TII (Telecommunication Infrastructure Index), and HCI (Human Capital Index). Uzbekistan has been on a visible upward trajectory across the 2018→2024 cycle, moving from the "middle EGDI" tier toward "high/very-high EGDI," driven mostly by OSI gains (the my.gov.uz service rollout) and TII gains (mobile broadband expansion) rather than HCI. **I was not able to pull the exact rank/score for each survey year live this session** (publicadministration.un.org returned a parser error, exploreegov.org and the Wikipedia ranking table 404'd/were unreachable on this pass). This is the single most important fact-check to run before the product ships anything with EGDI numbers on a dashboard — get the authoritative 2024 figures (and the not-yet-released 2026 survey timing) directly from https://publicadministration.un.org/egovkb/ before building the "EGDI performance" KPI the reference prototype already sketches (76% progress bar toward an internal target). Flagged as the top open question below.

## 4. National digital-identity and workflow systems (the platform must interoperate with these, not replace them)

| System | Domain | What it is | Integration shape |
|---|---|---|---|
| **OneID** | id.egov.uz | "Yagona identifikatsiya tizimi" — unified identification/SSO, confirmed live on this pass. Used for login across government e-services and increasingly by banks/telecoms for KYC. | Typically an OAuth2/OpenID-Connect-style authorization-code flow for registered service providers (client_id/redirect_uri model), gated behind a formal onboarding/agreement with the operator — not a self-serve API key. Exact current API docs/OIDC discovery endpoint not re-verified this session; request current integration docs from UZINFOCOM/OneID operator before scoping SSO work. |
| **E-Imzo** | e-imzo.uz (redirects per-agency, e.g. e-imzo.soliq.uz for tax) | National PKI digital signature. Classic pattern: a **local background agent/browser module** (historically via a "CAPIWS"-style localhost service) that the browser's JavaScript talks to, because browsers can't reach smart cards/USB tokens directly; keys are issued as **.pfx files with PIN protection**, or on hardware tokens. Newer simplified flow (confirmed via the Soliq instance): apply → get a QR code → scan and Face-ID-verify in a mobile app (e.g., "Soliq" app) → certificate issued, no card reader needed. Supports revoke/suspend/restore of certificates via a certificate registry. | For document approval/sign-off flows (e.g., a "manager approves this report") the realistic integration is: require the E-Imzo desktop module or the mobile QR/Face-ID flow, verify signatures server-side against the certificate registry. This is a real engineering lift — budget for it only in Phase 2/3, not the MVP. |
| **ijro.gov.uz** | ijro.gov.uz | Confirmed live as "Ижро интизоми идоралараро электрон тизими" — the inter-agency electronic system for **execution discipline** (ijro intizomi). This is the national-level version of exactly the mechanic the reference prototype already sketches for Projects: an instruction (topshiriq) is assigned with a deadline, progress is tracked, and missed/overdue items surface for escalation. | Not something a department tool integrates with technically in the near term, but it is the **conceptual precedent** civil servants already understand — naming and framing the platform's task/instruction model around "ijro intizomi" language will make onboarding nearly zero-training for this specific audience. |
| **my.gov.uz** | my.gov.uz | Confirmed live as the **Yagona interaktiv davlat xizmatlari portali** (Unified Interactive State Services Portal): 24+ service sectors (health, education, social protection, real estate, business/licensing, transport, taxes), "all official documents in one place," personal notifications, emergency numbers (112, 1242). Available in **4 languages: Uzbek, Russian, English (beta), Karakalpak (beta)**. | Reference for "what a good multi-service, multi-language state portal looks like" — the 4-language pattern (including Karakalpak) is worth noting for any future multi-tenant expansion beyond this one department. |
| **E-Qaror** | — | Publicly known as an electronic system for formalizing collegial/government decision-making (draft resolutions, inter-agency sign-off before a decree is issued) — not independently re-verified this session. |
| **e-hujjat / inter-agency document flow** | — | Government bodies run internal electronic document-circulation systems (often called "elektron hujjat aylanishi") for routing incoming/outgoing correspondence and internal memos with registration numbers, due dates, and responsible-executor assignment — the same shape as this product's eventual "documents + approvals" phase. Not independently re-verified this session; treat as background knowledge only. |

**Practical takeaway:** none of these are casually integrable via public self-serve APIs the way Google/Microsoft SSO is. Every one requires a formal relationship with a state operator (UZINFOCOM or the specific agency). Plan OneID/E-Imzo integration as a Phase 2/3 item requiring an actual government partnership conversation, not a sprint task.

## 5. Law: data localization, information security, standards

- **Personal data localization**: Uzbekistan's Law "On Personal Data" (2019, with a significant 2021 amendment package) requires that databases containing Uzbek citizens' personal data be **located on servers physically within Uzbekistan**; the operator/owner of the database must ensure this before processing begins, and there are additional consent, purpose-limitation, and cross-border-transfer restrictions (transfer abroad generally requires either the data subject's consent or that the destination country provide "adequate protection," subject to regulator oversight). This law is the reason Telegram-adjacent "just use a SaaS in the EU/US" architecture is legally risky for anything holding employee names, phone numbers, photos, or birthdates. **Update (2026-09-05):** the law's full citation is now confirmed — **O'RQ-547-son, dated 02.07.2019** ("Shaxsga doir ma'lumotlar to'g'risida" / "О персональных данных"). The precise Art. 27-1 localization text and the full 2021 amendment scope still could not be retrieved verbatim this pass either (lex.uz renders only a truncated excerpt to the fetcher); the requirement's existence and general shape are well corroborated by secondary legal-practice sources. See [Gap-fill addendum §4](#gap-fill-addendum-2026-09-05) for the current registration authority and State Register mechanics, which is also a genuine open point (the registrar appears to have moved administratively more than once since 2019).
- **Practical implication for this product**: the People directory, HR fields, and anything with a phone number/photo/birthdate must be stored on Uzbekistan-based infrastructure. This is compatible with the reference prototype's own instinct (privacy tiers, "restricted HR record") — it's not just an access-control problem, it's a data-residency problem.
- **Information security requirements for state bodies**: government information systems are generally subject to certification/attestation by the state information security authority (historically under what is now folded into cybersecurity-agency functions), covering things like mandatory use of certified cryptography (E-Imzo's own PKI, not arbitrary TLS/crypto libraries) for anything legally significant, and often a preference or requirement for locally certified software/hosting for systems classified above a baseline sensitivity tier.
- **O'zDSt standards**: Uzbekistan maintains its own national standards body (O'zDSt = O'zbekiston Davlat Standarti), which has published information-security and IT standards that in some cases mirror or reference GOST/ISO but with local certification requirements. Not independently re-verified this session; if this product is ever formally certified for use across ministries, budget for an O'zDSt/security-certification review cycle.
- **Foreign cloud use by government bodies**: general pattern (background knowledge, not re-verified live this session) is that foreign public cloud (AWS/Azure/GCP with servers outside Uzbekistan) is **not permitted for systems processing personal data or classified as "state information resources"** without special dispensation; some non-sensitive, non-personal workloads may use foreign cloud, but the safe assumption for a government HR/ops tool is **on-premise or Uzbekistan-based gov-cloud/data-center hosting** (UZINFOCOM operates state data-center capacity; there are also a small number of licensed local commercial data centers). This should be treated as an architectural constraint from day one, not an afterthought.
- **State secrets classification**: Uzbekistan retains a Soviet-derived classification system (levels roughly analogous to "for official use only" / "secret" / "top secret"); a department analytics tool for EGDI/policy work is very unlikely to touch classified material directly, but any document-attachment feature should assume some content may be marked "for official use only" (xizmat foydalanish uchun / для служебного пользования) and needs at least basic marking/handling conventions even if not full classification tooling.

## 6. Language

- **Uzbek Latin** is the sole official script for state administration as of the most recent transition push (public reporting places full state-side completion of the Cyrillic→Latin transition around 2025, after repeated deadline extensions since the script was first "re-introduced" in 1992). **Cyrillic remains widely read and used in practice**, especially by older civil servants, in some archival documents, and informally — do not assume Latin-only literacy for a 100%-Latin UI to be zero-friction for every user; a Cyrillic display toggle or at minimum tolerant search (matching Cyrillic-typed queries to Latin content) is a realistic accessibility need for a department with senior staff.
- **Russian is the de facto working language of most government back-office work** in Tashkent-based ministries even though it has no special constitutional status; expect that internal documents, some official correspondence, and a meaningful share of daily spoken communication in this specific department will be in Russian. The reference prototype's English-only UI is the least realistic assumption to carry forward — Uzbek Latin should be the default, Russian a first-class parallel, English a reporting/international-facing option (exactly matching my.gov.uz's own 3+1 language pattern: Uzbek, Russian, English-beta, plus Karakalpak-beta for the wider portal).
- **Transliteration**: the 1995 Uzbek Latin alphabet has 29 letters/digraphs, including `oʻ`, `gʻ`, `sh`, `ch`, `ng`, and the modifier apostrophe `ʼ` for the glottal stop (tutuq belgisi). Cyrillic Ц/ц becomes "ts" after vowels and "s" elsewhere in standard transliteration; the soft sign is rendered contextually. **UI implication**: search/sort must be Unicode-aware and tolerant of apostrophe variants (users type straight `'`, curly `’`, backtick, or omit it entirely for oʻ/gʻ) — a name search for "Toshpoʻlatov" must also match "Toshpulatov," "Toshpo'latov," and "Toshpolatov." This is a concrete, testable UX requirement, not a nicety.
- **Dates**: day.month.year is standard (e.g., 04.09.2026), not month/day/year — any date picker or displayed date must default to this order or it will read as wrong/confusing to every user.
- **Names and patronymics**: Uzbek official records commonly carry three parts — given name, patronymic (father's name + -ovich/-ovna or Uzbek equivalent -o'g'li/-qizi), and family name — inherited from the Soviet administrative pattern; official documents, passports, and HR records typically want all three fields even though everyday address uses given name + honorific (see below). A People/HR data model should have first name, patronymic, last name as distinct fields, not a single "full name" blob, to match how HR departments and any future OneID data feed will actually structure the data.
- **Uzbek plurals/possessives for UI strings**: Uzbek pluralization is regular (suffix -lar, e.g. loyiha → loyihalar "projects") and possessive/case suffixes attach directly to the noun (loyihaning holati = "the project's status," loyihada = "in the project") — meaning naive string concatenation ("{count} loyiha" for all counts) mostly works for count display, but any UI string that embeds a noun inside a sentence (e.g., "View {department}'s projects") needs Uzbek-aware string templates with the possessive suffix attached to the variable, not a fixed English-order sentence — plan for a proper i18n library with per-language sentence templates, not string concatenation, from the start.
- **Public holidays** (background knowledge, partially confirmed live): fixed dates include January 1 (New Year), March 8 (Women's Day), March 21 (Navro'z), May 9 (Day of Memory and Honor), September 1 (Independence Day), October 1 (Teachers' and Instructors' Day), December 8 (Constitution Day); plus the lunar Islamic holidays **Ro'za Hayit (Eid al-Fitr)** and **Qurbon Hayit (Eid al-Adha)**, whose Gregorian dates shift ~11 days earlier each year and must be computed from the Hijri calendar, not hardcoded. **Note**: in practice Uzbekistan's cabinet frequently issues additional one-off "day off" and "compensatory working day" decrees around these holidays (moving weekends to bridge long holidays) — a real leave/calendar module needs an admin-editable holiday calendar per year, not a static list, because the exact 2026 calendar (including any moved weekends) is set by government resolution closer to each holiday and was not independently confirmed this session.

## 7. Culture: how work actually happens

- **Telegram is the default channel**, not an alternative one. (Direct Telegram-penetration statistics could not be pulled this session — datareportal.com's Uzbekistan report surfaced strong general internet/social stats — 32.7M internet users, 89.0% penetration; 33.9M mobile connections, 92.2% penetration; 11.7M social media identities — but did not break out Telegram specifically. Background knowledge, not re-verified: Telegram is widely reported as the dominant messenger in Uzbekistan, used for everything from official ministry announcement channels to informal work coordination and even bot-based public services.) **Product implication**: notification delivery strategy should treat a Telegram bot as at least co-equal with email/in-app notification, likely more reliably read than email for this user base — this is a concrete Phase 2 integration worth prioritizing over, say, calendar sync.
- **Hierarchy and formality**: government workplace culture is hierarchically explicit — a "topshiriq" (instruction/assignment) from a superior carries weight roughly equivalent to a formal directive, not a casual request, and is expected to be acknowledged and tracked to completion; addressing seniors with appropriate honorifics/patronymic is normal. A product that visibly shows "who assigned this, to whom, by when, and its current status to the assigner" will map naturally onto expectations already in place; a product that flattens hierarchy (e.g., a Kanban board with no visible chain of accountability) will feel foreign.
- **"Ijro intizomi"** (execution discipline) is a load-bearing cultural/administrative concept, not just a system name — it refers to the broader expectation that assigned instructions are executed on time and that failure to do so is tracked and can have consequences up to disciplinary action. The reference prototype's "missed deadline automatically moves the item into the management review queue" is, whether the supervisor intended it or not, a direct translation of ijro intizomi into product form — this is worth naming explicitly in the product (e.g., a status or view literally called "Ijro nazorati" / execution oversight) because it will be instantly legible to every civil servant without explanation.
- **Working hours and reporting cadence**: standard government working hours are typically a five-day week (with occasional Saturday workdays declared to compensate for mid-week holidays, per the moved-weekend pattern above); reporting cadences in ministries commonly run on weekly (Friday) status updates, monthly summaries, and quarterly reviews tied to broader government planning cycles — this matches the reference prototype's weekly-Friday-comment ritual well and validates keeping that cadence as a real product mechanic (a "Friday nudge" notification) rather than inventing a different rhythm.
- **Business trips (komandirovka)**: a formally tracked HR event (order/order number, destination, dates, per-diem) distinct from ordinary leave — worth its own record type eventually, not lumped into "leave."

## 8. Civil service HR structures

- **Shtat jadvali** (staffing table) — the formal approved list of positions/headcount per unit, which is the real source of truth for "who reports to whom" and "how many people are allowed in this sub-department" in any Uzbek government body; an org-chart feature should be modeled as "positions from an approved shtat jadvali, filled or vacant," not just "people," so the org chart can show vacancies — a materially useful feature a purely "people-first" model would miss.
- **Position grades**: civil-service positions run in a recognizable ladder — Specialist → Leading/Senior Specialist → Chief Specialist → Head of Department/Sub-department (boshliq) → Deputy Director → Director — which matches the reference prototype's own position list almost exactly (Specialist → Senior → Lead → Chief Specialist → Head of Sub-department → Director), suggesting the prototype's author already modeled this correctly from lived experience.
- **Attestation**: periodic formal performance/competency review process for civil servants (background knowledge, not independently re-verified this session) — typically used for confirmation in grade, promotion eligibility, or in some cases retention; a future "employee record" module should anticipate an attestation date/result field.
- **Leave rules**: Uzbekistan's Labor Code (adopted 28.10.2022, in force from 30.04.2023) sets a baseline paid annual leave of **at least 15 working days historically, moving toward/confirmed at 21+ calendar/working days under the current code for many categories** — the brief's "21+ days" figure is plausible and consistent with general reporting. **Update (2026-09-05):** now confirmed — **Article 217** ("Har yilgi asosiy eng kam mehnat ta'tilining davomiyligi") sets the minimum annual basic paid leave at **21 calendar days** (up from 15 working days under the 1995 Code); see [Gap-fill addendum §3](#gap-fill-addendum-2026-09-05) for extended-leave categories (up to 30 days for minors/disability groups I-II, +2 days per 5 years of service capped at +8), the 56-calendar-day combined annual cap, and the 6-month qualifying period for a first-year grant.
- **Sick leave**: paid via the state social insurance/social fund mechanism against a medical certificate (varaqa/spravka), not simply employer-paid — a Leave module's "sick leave" type should be modeled as a distinct category from vacation leave, with its own approval/documentation flow, matching real practice. **Update (2026-09-05):** payment percentage is tenure-tied — 60% of wage under 8 years of service, 80% at 8+ years or for employees under 21, and up to 100% for socially significant illness categories at high tenure or protected veteran categories; see addendum §3 for the source resolution.
- **Timekeeping ("tabel")**: the "tabel uchyota rabochego vremeni" (Russian) / "ish vaqtini hisobga olish tabeli" (Uzbek) is the standard monthly attendance/time-tracking sheet every unit maintains and submits — a recognizable, expected artifact; a future module that auto-generates a "tabel"-shaped monthly export from daily presence/leave data would land as immediately useful and familiar rather than novel.

## 9. Uzbek and Russian terms for core UI concepts

| Concept | Uzbek (Latin) | Russian | Notes |
|---|---|---|---|
| Task | Vazifa / Topshiriq | Задача / Поручение | "Topshiriq"/"Поручение" carries more weight — an assigned instruction from above, not a self-created to-do; use it for manager-assigned items, "Vazifa"/"Задача" for general tasks |
| Project | Loyiha | Проект | Same everywhere |
| Deadline | Muddat / Yakunlash muddati | Срок / Срок исполнения | "Ijro muddati" = execution deadline — the ijro-intizomi-flavored phrasing |
| Approval | Tasdiqlash | Утверждение / Согласование | Two Russian words matter: "утверждение" (final sign-off) vs. "согласование" (routing for concurrence) — a real approval workflow needs both concepts |
| Leave (vacation) | Ta'til | Отпуск | |
| Instruction (from a superior) | Topshiriq | Поручение | See "ijro intizomi" above — this is the highest-signal word in the whole vocabulary |
| Report | Hisobot | Отчёт | |
| Department | Boʻlim / Boshqarma | Отдел / Управление | "Boshqarma" (управление) typically outranks "boʻlim" (отдел) in formal hierarchy — worth respecting if the product ever models multi-level departments |
| Sub-department | Kichik boʻlim / Sektor | Сектор / Подотдел | The reference prototype's "sub-department" maps most naturally to "sektor"/"сектор" or a named "boʻlim" under a larger "boshqarma" |
| Employee | Xodim | Сотрудник | |
| Meeting | Yig'ilish / Majlis | Совещание / Собрание | "Majlis"/"совещание" = working meeting; "yig'ilish"/"собрание" leans more formal/plenary |
| Execution discipline | Ijro intizomi | Исполнительская дисциплина | The concept underlying the whole platform's task model — see Section 7 |
| Business trip | Komandirovka | Командировка | Loanword, identical in both languages |
| Staffing table | Shtat jadvali | Штатное расписание | |
| Attendance sheet | Tabel | Табель | |

## What this means for us

1. **[ADOPT]** Model "task" as two distinct object types from day one — self-owned work items and superior-assigned **topshiriq/поручение** — because civil servants already distinguish them mentally and a flattened single "task" type will feel like it's missing the most important axis (who assigned it, and to whom it's answerable).
2. **[ADOPT]** Name the auto-escalation mechanic something recognizably tied to **"ijro intizomi"/"исполнительская дисциплина"** (e.g., a view literally called "Ijro nazorati") rather than a generic "overdue" label — it borrows instant legitimacy and zero-training recognition from a concept every civil servant already lives under via ijro.gov.uz.
3. **[ADOPT]** Uzbek Latin as default UI language, Russian as a fully maintained parallel (not a stub), English for reporting/international-facing views only — do not ship an English-only or English-first product like the reference prototype; that is the single biggest realism gap in the current audit.
4. **[ADOPT]** Store all personal-data-bearing tables (People/HR) on Uzbekistan-based infrastructure from day one — this is a legal requirement (Law on Personal Data localization), not a future migration; retrofitting hosting later is far more expensive than choosing correctly now.
5. **[ADOPT]** Build search/sort to be tolerant of Latin/Cyrillic and apostrophe-variant input for names — a name search that only matches exact Latin spelling with the correct oʻ/gʻ apostrophe will silently fail for a meaningful share of real queries.
6. **[ADAPT]** Treat Telegram as a first-class notification channel, likely to be built before or alongside in-app notifications — a Telegram bot for deadline reminders and weekly-update nudges will almost certainly get read faster than email in this environment (general Uzbekistan digital-usage data confirms near-universal mobile/social penetration; Telegram-specific share not independently re-verified but treat as the working default per common knowledge of the market).
7. **[ADAPT]** Model organizational structure around an approved **shtat jadvali** (staffing table) concept — positions (filled or vacant) under units — rather than only "people," so the org chart can show open headcount, which is materially more useful to a director than a people-only chart.
8. **[ADAPT]** Keep the Friday-update/weekly-comment ritual from the reference prototype — it independently matches the real government reporting cadence (weekly/monthly/quarterly cycles), so this is validated, not just a nice idea.
9. **[ADAPT]** Build a leave/calendar module around an **admin-editable annual holiday calendar**, not a hardcoded list — the Islamic holidays move every year and the government frequently issues ad-hoc moved-weekend decrees; a static holiday list will be wrong within one year.
10. **[AVOID]** Do not attempt real OneID/E-Imzo integration in an MVP — both require a formal relationship with a state operator (UZINFOCOM or the specific agency) and, for E-Imzo, real PKI/certificate-verification engineering; scope this explicitly for Phase 2/3 and budget a partnership conversation, not just dev time.
11. **[AVOID]** Do not assume any foreign public cloud (AWS/Azure/GCP outside Uzbekistan) is a safe default for hosting — the safe planning assumption is on-premise or Uzbekistan-based gov/commercial data-center hosting for anything touching personal data; validate this explicitly with legal/IT-security counsel before any infrastructure decision, since exact current rules on limited foreign-cloud use for non-personal workloads need authoritative confirmation.
12. **[AVOID]** Do not build a flat, non-hierarchical task board (pure Kanban with no visible chain of accountability) as the primary work view — it will read as culturally foreign in an environment where a topshiriq's authority derives from who assigned it and its visibility to that person.
13. **[ADAPT]** Split "approval" into at least two workflow states matching Russian government usage — "согласование" (routing for concurrence/sign-off by multiple parties) and "утверждение" (final approval) — a single generic "Approved" status will undercount a real multi-party sign-off process common in ministry document flow.
14. **[ADOPT]** Use three distinct name fields (given name, patronymic, family name) in the People/HR data model instead of one "full name" field, matching both cultural convention and the likely future shape of any OneID data feed.
15. **[ADAPT]** Frame the EGDI/global-index tracking feature for Strategy & Rankings around the **official UN E-Government Survey methodology (OSI/TII/HCI)**, but do not hardcode any current rank/score into the product until the authoritative 2024 figures (and 2026 survey timing) are pulled directly from publicadministration.un.org — this is flagged as unverified this session and is a high-visibility number if wrong.

## Open questions

1. **EGDI exact scores/ranks for Uzbekistan across 2018/2020/2022/2024** — not confirmed live this session (UN e-govkb site and Wikipedia ranking table were unreachable to the fetch tool on this pass). Must be pulled directly from https://publicadministration.un.org/egovkb/ before any dashboard or report cites a number.
2. ~~**Current Minister of Digital Technologies and the ministry's formal internal org chart**~~ — **RESOLVED 2026-09-05**, see addendum §2.
3. **Digital Uzbekistan 2030 decree number, exact targets, and current (2026) progress against them** — plausible figures cited above from general prior knowledge, not re-verified; pull the authoritative text from lex.uz.
4. ~~**Exact current statutory annual leave entitlement**~~ — **RESOLVED 2026-09-05**: 21 calendar days, Labor Code Art. 217. See addendum §3.
5. **Exact text and current numbering of the Law on Personal Data's localization provision** (commonly cited as Art. 27-1) and the full 2021 amendment scope — **PARTIALLY RESOLVED 2026-09-05**: law number confirmed as O'RQ-547 (02.07.2019); Art. 27-1's verbatim text still not retrieved, and the current registration authority is itself ambiguous (see addendum §4) — still needed for any compliance-facing documentation.
6. **Whether limited foreign-cloud use is permitted for non-personal-data workloads of a government body**, and under what certification/approval process — this determines whether e.g. a non-PII analytics layer could use a foreign cloud service; needs a definitive answer from Ministry of Digital Technologies / cybersecurity-agency guidance or legal counsel, not inference.
7. **OneID's actual current integration protocol** (confirm whether it is standards-based OAuth2/OIDC with a discovery document, or a bespoke API) and the realistic onboarding timeline/cost for a department-level tool to integrate — needed before scoping any SSO milestone.
8. **Telegram-specific usage share in Uzbekistan** (vs. the general internet/social-media statistics that were confirmed) — worth getting a hard number before pitching a Telegram-bot notification channel as a headline feature to leadership.
9. **Where this specific department (Information & Analytical Activities) formally sits** — directly under the Ministry of Digital Technologies, under the Cabinet of Ministers, or elsewhere — which affects both the realistic integration path to national systems and who the ultimate "customer" for multi-tenant expansion would be.
10. ~~**Current, authoritative 2026 public holiday calendar including any government-declared moved weekends**~~ — **RESOLVED 2026-09-05** via Presidential Decree PF-257 (24.12.2025). See addendum §1. Note this confirms the *mechanism* (an annual presidential decree, not a standing rule) — a fresh decree should still be expected and re-checked for 2027 and every year after.

## Sources

- [UZINFOCOM (English)](https://uzinfocom.uz/en) — mandate, government portal launch date, staff count
- [my.gov.uz — Yagona interaktiv davlat xizmatlari portali](https://my.gov.uz) — services, languages (Uzbek/Russian/English-beta/Karakalpak-beta), features
- [id.egov.uz — OneID](https://id.egov.uz/) — confirmed name/purpose ("Yagona identifikatsiya tizimi")
- [ijro.gov.uz](https://ijro.gov.uz/) — confirmed name/purpose ("Ижро интизоми идоралараро электрон тизими")
- [e-imzo.soliq.uz](https://e-imzo.soliq.uz/) — E-Imzo technical flow (PFX keys, QR + Face-ID mobile issuance, certificate registry) for the tax-committee instance
- [IT Park Uzbekistan (English)](http://www.it-park.uz/en) — positioning ("START local & GO global"); resident count/tax specifics not obtained this session
- [DataReportal — Digital 2025: Uzbekistan](https://datareportal.com/reports/digital-2025-uzbekistan) — internet penetration 89.0% (32.7M users), mobile connections 92.2% (33.9M), social media 31.7% penetration (11.7M identities), platform breakdown (Instagram, Facebook, TikTok, LinkedIn); no Telegram-specific figure obtained
- [Wikipedia — Uzbek alphabet](https://en.wikipedia.org/wiki/Uzbek_alphabet) — Latin/Cyrillic history, 2025 reported full state-side Latin transition, transliteration rules (oʻ, gʻ, sh, ch, ng, apostrophe)
- [Wikipedia — Public holidays in Uzbekistan](https://en.wikipedia.org/wiki/Public_holidays_in_Uzbekistan) — fixed-date and lunar holiday list

**Added 2026-09-05 (Gap-fill addendum sourcing):**
- [PF-257-son, 24.12.2025 (lex.uz)](https://lex.uz/uz/docs/-7938920) — 2026 additional non-working days and moved rest-day decree, full text
- [president.uz decree listing](https://president.uz/oz/lists/view/8832) — same decree, presidential-site copy
- [kun.uz (English) — decree summary](https://kun.uz/en/news/2025/12/25/president-signs-decree-approving-additional-days-off-and-holiday-shifts-for-2026)
- [gazeta.uz (English) — decree summary](https://www.gazeta.uz/en/2025/12/25/days-off-2026/)
- [gov.uz/en/digital — Ministry of Digital Technologies homepage](https://gov.uz/en/digital)
- [gov.uz/en/digital/guides — Ministry leadership](https://gov.uz/en/digital/guides) — Minister and deputy ministers
- [gov.uz/en/digital/structure — Ministry departments](https://gov.uz/en/digital/structure)
- [gov.uz/en/digital/departments/subordinate — subordinate organizations](https://gov.uz/en/digital/departments/subordinate) — full list of 25 entities
- [Labor Code, 28.10.2022 (lex.uz, Russian)](https://lex.uz/ru/docs/-6257288) — Art. 217 citation and structure
- [Labor Code table of contents (lex.uz)](https://lex.uz/mact/-6257288)
- [Cabinet of Ministers Resolution No. 71, 28.02.2002 (lex.uz)](https://lex.uz/docs/-251921) — temporary disability benefit payment limits/percentages
- [Law "On Personal Data," O'RQ-547, 02.07.2019 (lex.uz)](https://lex.uz/docs/-4396419)
- [Cabinet of Ministers Resolution No. 71, 08.02.2020 (lex.uz)](https://lex.uz/docs/-4729730) — State Register of personal data databases, registration duty and exemptions
- [pd.gov.uz — State Register of Personal Data Databases portal](https://pd.gov.uz/) — current operating registrar (MIA Migration and Personalization Department)
- [Law "On State Civil Service," O'RQ-788, 08.08.2022 (lex.uz)](https://lex.uz/uz/docs/-6145972) — position groups, categories, qualification levels
- [PF-14, 25.01.2023 (lex.uz)](https://lex.uz/docs/-6369997) — central-apparatus staffing-ratio rule (administrative vs. specialist positions)
- [PF-95, 19.06.2025 (lex.uz)](https://www.lex.uz/docs/-7587464) — 2025 civil-service reform (not detailed this pass; flagged for follow-up)
- [PQ-4024, 21.11.2018 (lex.uz)](https://lex.uz/docs/-4071401) — ICT implementation control/protection measures, origin of state-system cybersecurity expertise requirement
- [Law "On Cybersecurity," O'RQ-764, 15.04.2022 (lex.uz)](https://lex.uz/docs/-5960604)
- [PQ-167, 31.05.2023 (lex.uz)](https://lex.uz/docs/-6479190) — critical information infrastructure cybersecurity measures
- [Resolution 3458, 22.09.2023 (lex.uz)](https://lex.uz/uz/docs/-6615573) — cybersecurity-level assessment procedure for critical info infrastructure
- [Resolution 3574, 14.11.2024 (lex.uz)](https://lex.uz/uz/docs/-7223533) — certification of cybersecurity hardware/software tools
- [gazeta.uz — mandatory cybersecurity expertise for state-body information systems](https://www.gazeta.uz/oz/2022/04/17/cyber-security/)
- [advice.uz — civil-status document naming-suffix rules (secondary summary of Resolution 134, 15.02.2019)](https://advice.uz/oz/document/1476)
- [advice.uz — temporary disability benefit payment limits (secondary summary)](https://advice.uz/oz/document/1498)
- [kadrovik.uz — sick-leave non-payment conditions (secondary summary)](https://kadrovik.uz/oz/publish/doc/text192140_qaysi_hollarda_kasallik_nafaqasi_tulanmaydi)
- [rivermate.com, vacationtracker.io, usemultiplier.com — secondary corroboration of the 21-calendar-day annual leave figure](https://rivermate.com/guides/uzbekistan/leave) (non-official, corroboration only)

**Note on method**: this session's web-search quota (used across parallel research tasks) was exhausted after the first six queries, before most planned searches ran; the remainder of the research relied on direct WebFetch calls (13 additional fetch attempts, 8 of which returned usable content — logged above) plus the author's general pre-existing knowledge of Uzbekistan's e-government ecosystem, which is flagged inline everywhere it was not independently re-confirmed this session. Every number or claim marked "not re-verified this session" or "background knowledge" in the sections above should be re-confirmed against a primary source before being quoted externally or hardcoded into product logic — this is captured comprehensively in the Open Questions section.

## Editor's verification notes (uzbekistan-context)

**Method**: this session's WebSearch quota was also already exhausted (200/200) on the first attempt, so verification relied entirely on targeted WebFetch calls against primary sources (lex.uz, it-park.uz, en.wikipedia.org). Five consequential claims were spot-checked.

### Spot-checks

1. **Personal Data Law citation and content** — PARTIALLY CONFIRMED, ONE MATERIAL GAP FOUND. Fetched lex.uz/docs/4396428 directly: confirmed this is the Law "On Personal Data," **ЗРУ-547, dated 02.07.2019** (the report cited "2019" correctly but never gave the law number). Could **not** locate the localization article in the fetched excerpt to confirm the "Art. 27-1" citation the report flags as unverified — that flag stands, still open. **New finding the report missed entirely**: Article 8 of the law names a specific regulator — the **"Государственный центр персонализации при Кабинете Министров"** (State Center for Personalization under the Cabinet of Ministers) — as the authorized state body maintaining the State Register of personal-data databases. The report never names any enforcement/registration authority for personal-data compliance, which is a real gap for a compliance-facing document (also worth checking whether a newer, distinct "Shaxsiy ma'lumotlarni himoya qilish agentligi" / Personal Data Protection Agency has since taken over this function post-2021 reforms — the fetched text may reflect an older consolidated version).

2. **Labor Code 2023 / 21+ days annual leave** — PARTIALLY CONFIRMED, NUMBER STILL UNVERIFIED. Fetched lex.uz/docs/6257291: confirmed this is Uzbekistan's Labor Code dated **28.10.2022** (consistent with the report's "took effect in 2023" framing) and confirmed **Article 217** ("Продолжительность ежегодного основного минимального трудового отпуска") is the specific article governing minimum annual paid leave duration. Could not retrieve the article's body text through WebFetch (only table-of-contents/navigation content was returned), so the "21+ days" figure and its unit (working vs. calendar days) remain **unconfirmed** — same open question the original report already flagged, now narrowed to a specific citable article (Art. 217) for whoever does the follow-up.

3. **EGDI exact rank/score 2018–2024** — UNVERIFIABLE THIS PASS. Attempted publicadministration.un.org (parse error) and two Wikipedia EGDI pages (both 404). No improvement over the original report's own flag; this remains the single highest-priority open item, exactly as the report already states.

4. **Digital Uzbekistan 2030 decree (PF-6079) exact targets** — UNVERIFIABLE THIS PASS. The lex.uz document ID attempted returned 404 (same failure mode the original researcher hit). Not confirmed or refuted; treat the decree number and all percentage targets as still unverified, per the report's own caveat.

5. **IT Park Uzbekistan resident count / tax benefits** — UNVERIFIABLE THIS PASS. Fetched it-park.uz/en (redirects to www.it-park.uz/en): page returned only navigation shell/section headers ("Local companies," "Foreign companies," "START local & GO global"), no benefit schedule or resident count — identical outcome to the original researcher's attempt. The "0% profit tax" figure in the report is plausible background knowledge but remains formally unconfirmed by either research pass.

**Net verification verdict**: 0 of 5 spot-checked claims were proven wrong; 1 was clarified/partially confirmed with a new supporting citation (Personal Data Law number ЗРУ-547) and one new gap surfaced (missing regulator name); 1 was narrowed to a specific article citation (Labor Code Art. 217) without resolving the underlying number; 3 remained exactly as unverifiable as the original report already disclosed. The report's own honesty about what it could not confirm held up under a second, independent verification pass — no fabricated-sounding claim was found to be actually false.

### Gaps, thin spots, and missing adjacent topics

**Thin or unresolved from the original brief** (the report itself flags most of these, but they remain genuinely open and should block specific product decisions, not just be noted):
- **EGDI exact scores/ranks 2018–2024** — never obtained by either pass. This is the single most damaging gap given Strategy & Rankings is a named sub-department whose entire mandate is EGDI tracking; no EGDI KPI/dashboard number should ship without this.
- **Ministry org chart, current minister, deputy ministers, and where the Information & Analytical Activities department formally sits** (under the Ministry, Cabinet of Ministers, or elsewhere) — unresolved; this affects the realistic integration path and who the eventual "customer" is for multi-tenant expansion.
- **Digital Uzbekistan 2030** exact decree number/targets — unresolved.
- **OneID's actual integration protocol** (true OAuth2/OIDC with discovery doc, vs. bespoke) — unresolved; the report correctly declines to assert this as confirmed, but it is presented with more confidence ("Typically an OAuth2/OpenID-Connect-style...") than the evidence supports and should be flagged as inferred-from-pattern, not observed.
- **E-Qaror** and **e-hujjat / inter-agency document flow** are covered in one sentence each with no named product, no confirmed URL, and no confirmed technical shape — these are two of the systems most directly relevant to a future "approvals" phase and deserve a dedicated follow-up pass, not a placeholder row.
- **Exact annual leave entitlement** (Labor Code Art. 217, now specifically citable) — still not resolved to a number.
- **O'zDSt standards** and **information-security certification regime for state bodies** — both stayed at the level of generic background knowledge with no named standard numbers, certifying body, or process. Given the product's own multi-tenant/gov-cloud ambition, this is a thinner section than its consequences warrant.
- **Public holidays 2026** — the report correctly avoids hardcoding a full calendar (good instinct) but also never attempts to source the actual 2026 Cabinet resolution, so the section is a static structural pattern (fixed + lunar dates) without a single 2026-specific fact.

**Adjacent topics absent that a senior product/engineering lead would expect:**
1. **The Personal Data Protection regulator/enforcement body** — surfaced in this verification pass (State Center for Personalization under the Cabinet of Ministers, Art. 8 of the Personal Data Law) but completely absent from the original report. Any compliance section needs to name who a department would register a database with or report a breach to, not just cite the law.
2. **Uzbekistan's Cybersecurity Agency** (established 2021, "Kiberxavfsizlik agentligi") is only gestured at ("folded into cybersecurity-agency functions") rather than named and scoped — given it is very plausibly the actual certifying/auditing body for a government analytics tool, it deserves its own line, not a parenthetical.
3. **Government e-procurement** (how a department budgets for and legally acquires or builds software — public procurement law/portal) is entirely absent. For a product whose stated ambition is to "go viral" across ministries, the procurement/adoption mechanism for other departments to legally start using it is a first-order go-to-market question, not a footnote.
4. **Existing internal/cross-ministry corporate tools** — no mention of whether a Cabinet-of-Ministers-level "corporate portal," shared intranet, or existing task-tracking system already exists across ministries that this product would need to differentiate from, feed into, or avoid duplicating. This is a real competitive/adoption-risk gap.

### Scoring rationale
- Coverage is broad (nearly every brief topic has at least a paragraph) and unusually well-organized, but the single most consequential topic for this specific department (EGDI numbers) and one structurally important legal fact (the data-protection regulator) are missing or unresolved, plus 4 clear adjacent gaps above — this caps coverage below "complete."
- Evidence quality is a genuine strength: the report is scrupulous about labeling unverified claims and rarely asserts a specific number without a hedge; this pass found no material fabrication, only omissions and one inferred-with-excess-confidence claim (OneID's protocol).

## Gap-fill addendum (2026-09-05)

**Method**: this pass ran 20 WebSearch queries (Uzbek-language and English, targeting lex.uz/president.uz/gov.uz/it-park.uz/pd.gov.uz directly where possible) and 12 WebFetch reads against primary and near-primary sources, before the session's WebSearch budget was exhausted. Every claim below is sourced inline; where a primary source could only be partially retrieved (lex.uz frequently renders a truncated excerpt to automated fetchers), that is flagged explicitly rather than smoothed over, matching the original report's own disclosure standard. This addendum resolves 6 of the 10 original open questions in full or in part (see updated "Open questions" list above) and adds the specific facts requested for a product/engineering audience.

### 1. Verified 2026 public holidays and the mechanism of moved weekends

The mechanism is now confirmed precisely: **it is an annual Presidential Decree**, not a standing Labor Code rule or a Cabinet-of-Ministers resolution as the original report guessed. For 2026, that instrument is **Presidential Decree PF-257, dated 24.12.2025**, "On establishing additional non-working days during the celebration of official dates and moving rest days in 2026" — full text at [lex.uz](https://lex.uz/uz/docs/-7938920), also mirrored at [president.uz](https://president.uz/oz/lists/view/8832). English summaries corroborate at [kun.uz](https://kun.uz/en/news/2025/12/25/president-signs-decree-approving-additional-days-off-and-holiday-shifts-for-2026) and [gazeta.uz](https://www.gazeta.uz/en/2025/12/25/days-off-2026/). The decree itself invokes **Labor Code Article 208** as its legal basis for moving a rest day when it coincides with a holiday.

**Additional non-working days declared for 2026:**
| Date | Day | Applies to |
|---|---|---|
| 31 Dec 2025 | Wed | all employees |
| 2 Jan 2026 | Fri | all employees |
| 3 Jan 2026 | Sat | six-day workweek only |
| 28 May 2026 | Thu | all employees |
| 29 May 2026 | Fri | all employees |
| 30 May 2026 | Sat | six-day workweek only |
| 31 Aug 2026 | Mon | all employees |
| 31 Dec 2026 | Thu | six-day workweek only |

**Moved weekend rest days (five-day workweek):**
| Holiday | Falls on | Rest day moved to |
|---|---|---|
| 8 March (Women's Day) | Sunday | Monday, 9 March |
| 21 March (Navro'z) | weekend | Monday, 23 March |
| 9 May (Memory and Honor Day) | Saturday | Monday, 11 May |
| — (routine Saturday, 12 Dec) | Saturday | Thursday, 31 December |

**Resulting long-holiday blocks for 2026:** New Year (31 Dec – 4 Jan, 5 days), Women's Day (7–9 Mar, 3 days), Navro'z (21–23 Mar, 3 days), Memory and Honor Day (9–11 May, 3 days), Qurbon Hayit/Eid al-Adha (28–31 May, 4 days), Independence Day (29 Aug – 1 Sep, 4 days), New Year 2027 (31 Dec – 3 Jan, 4 days).

**Exception carried over unchanged from the original report**: continuous-production, shift, and other work that cannot be stopped does not get the rest-day transfer.

**Product implication**: model the holiday calendar as **admin-editable, populated annually from that year's presidential decree**, exactly as the original report recommended — this pass confirms the recommendation was correct in kind, and now gives the concrete 2026 seed data plus the exact instrument type (presidential decree, published on lex.uz/president.uz every December) to watch for each subsequent year.

### 2. Ministry of Digital Technologies — current name, leadership, and subordinate agencies (2026)

**Official name**: Ministry of Digital Technologies of the Republic of Uzbekistan (Raqamli texnologiyalar vazirligi), confirmed live at [gov.uz/en/digital](https://gov.uz/en/digital).

**Leadership** (per [gov.uz/en/digital/guides](https://gov.uz/en/digital/guides)):
- **Minister**: Sherzod Shermatov (Shermatov Sherzod Xotamovich) — styled on the site as "Minister of Digital Technologies — National Chief Information Officer (CIO)."
- **First Deputy Ministers**: Oleg Pekos (AI development portfolio); Ayubkhon Sultonov (digitalization portfolio).
- **Deputy Ministers**: Jamol Makhsudov; Rustam Karimjonov.
- **Advisor to the Minister**: Akihiro Sakurai.

**Department structure** (per [gov.uz/en/digital/structure](https://gov.uz/en/digital/structure)): departments for AI Technologies Development, AI Infrastructure & Big Data, Digital Government Development, Digitizing State Bodies and Economic Sectors, Information Systems and Interdepartmental Integration, Telecommunications Infrastructure Development, mobile communications/broadcasting networks, Digital Education Development, digital-skills development, plus support functions (legal, internal audit, accounting, anti-corruption).

**Subordinate organizations** (25 named at [gov.uz/en/digital/departments/subordinate](https://gov.uz/en/digital/departments/subordinate)) — the operationally relevant ones for this product: **UZINFOCOM LLC** (single integrator for state information systems — as the original report already flagged), **Digital Government Project Management Center**, **Digital Technologies and AI Research Institute**, **Center for AI and Digital Economy Development**, **Digital Technologies Development Fund**, **IT Park Administration LLC**, plus infrastructure/telecom entities (Uzbektelekom JSC, RTNCC LLC, O'zbekiston Pochtasi JSC, CRCBT LLC, Aloqaloyiha LLC), education entities (TUIT named after al-Khorazmiy, INHA University Tashkent, Amity University Tashkent, Digital Education Development Center), finance/insurance (Aloqabank JSC, ALSKOM insurance JSC), the **Control Inspection in the field of information and telecommunications**, and the **Space Research and Technologies Agency**.

**Remaining open point**: where the "Information & Analytical Activities" department (the actual target department for this product) sits relative to this ministry structure was not resolved this pass — none of the fetched department names match it exactly, so it may sit at a sub-department/sector level not separately listed on the public site, or under a different body entirely. This keeps Open Question #9 genuinely open.

### 3. Labor Code 2023 — leave, sick leave, and business-trip norms

Instrument: **Labor Code of the Republic of Uzbekistan, adopted 28.10.2022**, in force from **30.04.2023** (the "2023 Labor Code" the original report referenced) — [lex.uz](https://lex.uz/ru/docs/-6257288).

**Annual leave — Article 217** ("Har yilgi asosiy eng kam mehnat ta'tilining davomiyligi" / minimum duration of annual basic leave): **21 calendar days**, up from 15 *working* days under the 1995 Code — a real increase in both the number and the unit (calendar vs. working days make this a bigger jump than the raw numbers suggest). Corroborated by multiple secondary employment-law summaries (rivermate.com, vacationtracker.io, usemultiplier.com) though the verbatim article text itself remained truncated in the lex.uz fetch. Extended/combined leave rules (secondary-sourced, consistent across summaries):
- Minors (under 18) and employees with disability groups I or II: 30 calendar days.
- +2 calendar days of seniority leave for every 5 years at the same organization, capped at +8 days total.
- Additional leave possible for hazardous/dangerous conditions or difficult climate zones.
- **All annual leave types combined cannot exceed 56 calendar days** in one working year.
- Leave for the first year of employment is only granted after 6 months of service.

**Sick leave**: paid as a state social-insurance benefit against a medical certificate (kasallik varaqasi), governed at the payment-rate level by **Cabinet of Ministers Resolution No. 71, dated 28.02.2002**, "On improving the limit for payment of temporary-disability benefits" ([lex.uz](https://lex.uz/docs/-251921) — note this is a *different* Resolution No. 71 from the 2020 one on the personal-data register; disambiguate by year when citing). Rates: **60% of wage** under 8 years of service; **80%** at 8+ years of service or for employees under 21; up to **100%** for specified socially-significant illness categories at high tenure and for protected veteran/international-conflict categories regardless of tenure.

**Business trips (komandirovka)**: the Code preserves the employee's position, pay terms, and average salary during the trip and travel time (general guarantee, confirmed via secondary sources) — this pass could **not** pin down the specific current article number or the per-diem rate table; per-diem norms appear to live in separate implementing Cabinet resolutions (e.g., the pattern set by **Resolution No. 758, 14.11.2024**, "On approving normative-legal acts for implementing the Labor Code," [lex.uz](https://lex.uz/docs/-7220862)) rather than in the Code itself. Treat exact per-diem figures as still open and reconfirm against the current implementing resolution before hardcoding a trip-cost calculator.

### 4. Data-localization law and the State Register of Personal Databases

**Law**: "On Personal Data" ("Shaxsga doir ma'lumotlar to'g'risida" / "О персональных данных"), **O'RQ-547-son, dated 02.07.2019** — [lex.uz](https://lex.uz/docs/-4396419). This confirms and completes the original report's citation, which had the year right but not the law number.

**Localization provision**: commonly cited as **Article 27-1**, requiring that databases containing Uzbek citizens' personal data be technically and physically located on servers within Uzbekistan before processing begins. This pass could still **not** retrieve the verbatim Art. 27-1 text (the lex.uz fetch renders only Article 27 and a table of contents reference to 27-1) — this specific gap survives a second research pass and should be treated as a standing to-do before quoting exact statutory language in a compliance document.

**Regulator and State Register — a genuine, newly surfaced ambiguity**: three different names for the authorized body turned up across sources of different vintages:
1. The law's own **Article 8** text (as rendered to the fetcher) names the **"State Personalization Center under the Cabinet of Ministers."**
2. A 2023-era secondary source found in search suggested functions were later moved to a **"Personalization Agency under the Ministry of Justice."**
3. The **live, currently operating** State Register portal — [pd.gov.uz](https://pd.gov.uz/) — identifies the responsible body as the **Migration and Personalization Department of the Ministry of Internal Affairs**, consistent with the implementing **Cabinet of Ministers Resolution No. 71, dated 08.02.2020** ([lex.uz](https://lex.uz/docs/-4729730)).

Read together, this looks like a body that has been administratively relocated more than once since 2019 (Cabinet-level center → briefly under Ministry of Justice → now under MIA's Migration and Personalization Department). For any compliance-facing document written **today**, cite pd.gov.uz / MIA's Migration and Personalization Department as the practical, currently-operating registrar, but flag it as subject to reorganization and reconfirm before a formal filing.

**Registration duty** (Resolution No. 71/2020): personal-data-database owners/operators must register in the State Register unless exempted. Relevant exemptions include: processing for personal/household/non-professional purposes, national archives, state secrets, law-enforcement/counter-intelligence/AML data, non-disclosed membership data of public/religious associations, publicly available data, databases containing **only names and patronymics**, state automated information systems, and — importantly for this product — **"employment-related personal data under labor legislation."** That last exemption needs a real legal read before assuming it means routine HR/People-directory data is exempt from the *registration* duty specifically (as opposed to the separate localization and protection duties under the main Personal Data Law, which likely still apply); do not treat it as a green light without counsel. Registration is submitted in person at a state-services center or electronically via [my.gov.uz](https://my.gov.uz/uz/service/1135) (the Unified Interactive State Services Portal), with a **5-business-day** processing time.

### 5. State information systems — certification/attestation and whether an internal ministry tool is covered

Uzbekistan runs a cybersecurity/attestation regime built from a stack of decrees rather than one law:
- **PQ-4024, 21.11.2018** ([lex.uz](https://lex.uz/docs/-4071401)) — origin point: measures to control ICT implementation and improve the protection system for state and economic-management bodies.
- **Law "On Cybersecurity," O'RQ-764, 15.04.2022** ([lex.uz](https://lex.uz/docs/-5960604)) — the primary cybersecurity law.
- **PQ-167, 31.05.2023** ([lex.uz](https://lex.uz/docs/-6479190)) — critical information infrastructure (CII) cybersecurity measures.
- **Resolution 3458, 22.09.2023** ([lex.uz](https://lex.uz/uz/docs/-6615573)) — procedure for assessing the cybersecurity level of CII objects.
- **Resolution 3574, 14.11.2024** ([lex.uz](https://lex.uz/uz/docs/-7223533)) — certification procedure for hardware/software cybersecurity tools.

**The operative rule for this product**: per secondary reporting corroborated across sources (including [gazeta.uz](https://www.gazeta.uz/oz/2022/04/17/cyber-security/)), **information systems belonging to state bodies undergo mandatory cybersecurity compliance expertise (ekspertiza)** — this category is defined by *ownership* (it belongs to a state body) rather than by whether the system is public-facing. Systems classified as critical information infrastructure face additional, heavier obligations (continuous monitoring, documented cybersecurity policy, incident response, mandatory attestation against CII-specific requirements). **This strongly implies WorkPortal, as an internal system built for and operated by a ministry department, falls under the mandatory state-body cybersecurity expertise requirement even though it is not citizen-facing** — this should be budgeted as a real compliance/engineering line item (an expertise/audit cycle with the certifying body) before any production rollout, not assumed away because the tool is "just internal." It is very unlikely to rise to full CII status (that tier targets things like national telecom/finance/energy infrastructure), but the baseline state-body expertise requirement is the realistic bar to plan for.

**Separately**, there is a **personnel-level attestation** process — "attestation of heads of information services of state bodies and organizations" — administered as a state service (findable via my.gov.uz); this is about certifying the *person* running a body's IT/information function, distinct from certifying the *system* itself. Both should appear on a compliance checklist.

**Certifying/regulatory body**: the **Cybersecurity Agency** (Kiberxavfsizlik agentligi, established 2021 per the original report's parenthetical) is the named authority under the Cybersecurity Law; an operational "Kiberxavfsizlik markazi" (Cybersecurity Center, csec.uz) publishes recommendations and FAQs and appears to function as an operating arm — the precise agency-vs-center institutional relationship was not fully disambiguated this pass and is worth a direct question to either body before a certification conversation.

**O'zDSt standards**: this pass could **not** find specific O'zDSt standard numbers for information security (searches returned generic ISO/IEC 27001 marketing content with no O'zDSt-specific citations) — this remains exactly as thin a gap as the original report flagged; a follow-up should go directly to O'zDSt's own publications catalog rather than general web search.

### 6. Bilingual UI glossary (English → Uzbek Latin → Russian)

**Register note**: government-facing UI copy should sit in a **formal-but-plain** register — professional and precise like an official memo, but without the ornate honorific flourishes of a full formal letter (no "Hurmatli foydalanuvchi!" on every screen). Two concrete grammar rules follow from this register choice and should be treated as UI-copy lint rules, not style preferences:
- **Uzbek imperative verbs on buttons/commands must use the polite/plural "-ing" suffix form**, not the bare/informal stem: "Saqlang" (Save), "Yuboring" (Send), "Tasdiqlang" (Approve) — never "Saqla," "Yubor," "Tasdiqla," which read as blunt or address-to-a-child in a professional government context.
- **Russian UI convention favors the neutral infinitive form for commands** ("Сохранить," "Отправить," "Подтвердить") rather than an imperative conjugation — this is already the standard pattern and needs no special handling, but should not be mixed with a conjugated imperative form.

**Plural/suffix note**: Uzbek is a Turkic language where **a numeral already expresses plurality, so the noun stays singular after a number** — "5 vazifa" (5 tasks), not "5 vazifalar." The plural suffix **-lar** is only added when *no* numeral precedes the noun (e.g., a bare list heading "Vazifalar" = "Tasks"). This means a correct i18n template is `{count} {noun-singular}` for any count-prefixed string, and a *separate*, unsuffixed plural noun form for headings/labels with no visible count — treat these as two different translation keys, not one pluralized string, because naive `count === 1 ? singular : plural` logic (correct for English/Russian) actively produces incorrect Uzbek. Case/possessive suffixes (-ning, -da, -ga, etc.) still attach directly to the noun stem as the original report noted, so any noun embedded mid-sentence needs a language-aware sentence template regardless of count.

**Glossary** (organized by product area; Russian columns note register distinctions inline where they matter):

| # | Concept | Uzbek (Latin) | Russian |
|---|---|---|---|
| 1 | Task (self-owned) | Vazifa | Задача |
| 2 | Task (assigned by superior) | Topshiriq | Поручение |
| 3 | Subtask | Quyi vazifa | Подзадача |
| 4 | Project | Loyiha | Проект |
| 5 | Board | Doska | Доска |
| 6 | Column (on a board) | Ustun | Колонка |
| 7 | Backlog | Vazifalar roʻyxati | Бэклог |
| 8 | Sprint | Sprint | Спринт |
| 9 | Milestone | Muhim bosqich | Веха |
| 10 | Checklist | Tekshiruv roʻyxati | Чек-лист |
| 11 | Comment | Izoh | Комментарий |
| 12 | Attachment | Biriktirilgan fayl | Вложение |
| 13 | Tag / Label | Yorliq | Метка |
| 14 | Status | Holat | Статус |
| 15 | To do | Bajarilishi kerak | К выполнению |
| 16 | In progress | Jarayonda | В процессе |
| 17 | In review | Tekshiruvda | На проверке |
| 18 | Done | Bajarildi | Выполнено |
| 19 | Overdue | Muddati oʻtgan | Просрочено |
| 20 | Blocked | Bloklangan | Заблокировано |
| 21 | Cancelled | Bekor qilingan | Отменено |
| 22 | On hold | Muzlatilgan | Приостановлено |
| 23 | Priority | Ustuvorlik | Приоритет |
| 24 | High priority | Yuqori ustuvorlik | Высокий приоритет |
| 25 | Medium priority | Oʻrta ustuvorlik | Средний приоритет |
| 26 | Low priority | Past ustuvorlik | Низкий приоритет |
| 27 | Urgent | Shoshilinch | Срочно |
| 28 | Deadline | Muddat | Срок |
| 29 | Execution deadline | Ijro muddati | Срок исполнения |
| 30 | Start date | Boshlanish sanasi | Дата начала |
| 31 | Due date | Tugash sanasi | Срок сдачи |
| 32 | Days overdue | Kechikish kunlari | Дни просрочки |
| 33 | Approval (final sign-off) | Tasdiqlash | Утверждение |
| 34 | Approval (routing for concurrence) | Kelishish | Согласование |
| 35 | Approved | Tasdiqlandi | Утверждено |
| 36 | Rejected | Rad etildi | Отклонено |
| 37 | Pending approval | Tasdiqlanishi kutilmoqda | На согласовании |
| 38 | Approver / signatory | Tasdiqlovchi | Утверждающий |
| 39 | Leave (vacation, general) | Taʼtil | Отпуск |
| 40 | Annual leave | Yillik mehnat taʼtili | Ежегодный трудовой отпуск |
| 41 | Sick leave | Kasallik varaqasi | Больничный лист |
| 42 | Unpaid leave | Haq toʻlanmaydigan taʼtil | Отпуск без сохранения зарплаты |
| 43 | Maternity leave | Homiladorlik va tugʻish taʼtili | Отпуск по беременности и родам |
| 44 | Study leave | Oʻqish taʼtili | Учебный отпуск |
| 45 | Business trip | Komandirovka | Командировка |
| 46 | Per diem | Sutkalik xarajat | Суточные |
| 47 | Travel order | Komandirovka guvohnomasi | Командировочное удостоверение |
| 48 | Destination | Borish manzili | Место назначения |
| 49 | Event | Tadbir | Мероприятие |
| 50 | Meeting (working) | Majlis | Совещание |
| 51 | Meeting (plenary/formal) | Yigʻilish | Собрание |
| 52 | Team building | Jamoaviy tadbir | Тимбилдинг |
| 53 | RSVP / attendance confirmation | Ishtirokni tasdiqlash | Подтверждение участия |
| 54 | Attending | Ishtirok etaman | Буду участвовать |
| 55 | Not attending | Ishtirok etmayman | Не буду участвовать |
| 56 | Invitation | Taklifnoma | Приглашение |
| 57 | Participant | Ishtirokchi | Участник |
| 58 | Organizer | Tashkilotchi | Организатор |
| 59 | Onboarding | Ishga moslashtirish | Адаптация |
| 60 | New employee | Yangi xodim | Новый сотрудник |
| 61 | Probation period | Sinov muddati | Испытательный срок |
| 62 | Welcome checklist | Yangi xodim uchun roʻyxat | Чек-лист новичка |
| 63 | Specialist | Mutaxassis | Специалист |
| 64 | Leading specialist | Yetakchi mutaxassis | Ведущий специалист |
| 65 | Chief specialist | Bosh mutaxassis | Главный специалист |
| 66 | Head of department | Boʻlim boshligʻi | Начальник отдела |
| 67 | Deputy director | Direktor oʻrinbosari | Заместитель директора |
| 68 | Director | Direktor | Директор |
| 69 | Minister | Vazir | Министр |
| 70 | Deputy minister | Vazir oʻrinbosari | Заместитель министра |
| 71 | Department (large/directorate) | Boshqarma | Управление |
| 72 | Department (division) | Boʻlim | Отдел |
| 73 | Sub-department / sector | Sektor | Сектор |
| 74 | Staffing table | Shtat jadvali | Штатное расписание |
| 75 | Vacancy | Vakansiya | Вакансия |
| 76 | Notification | Bildirishnoma | Уведомление |
| 77 | Reminder | Eslatma | Напоминание |
| 78 | Unread | Oʻqilmagan | Непрочитанное |
| 79 | Mark as read | Oʻqilgan deb belgilash | Отметить как прочитанное |
| 80 | Settings | Sozlamalar | Настройки |
| 81 | Profile | Profil | Профиль |
| 82 | Language | Til | Язык |
| 83 | Permissions / roles | Ruxsatlar / Rollar | Права доступа / Роли |
| 84 | Dark mode | Qorongʻi rejim | Тёмная тема |

(84 terms; the original report's Section 9 table of 14 core terms is retained above as-is and is a subset consistent with this longer list — no conflicts found between the two passes.)

### 7. Name formatting, address forms, date and number formats

**Name order and fields**: official Soviet-derived pattern lists **Familiya (surname) — Ism (given name) — Otasining ismi/Sharif (patronymic)**, surname first, on staffing tables, registries, and signature blocks — e.g., "Yusupov Aziz Baxtiyorovich." **Initials convention**: formal lists and org charts commonly abbreviate to "Familiya I.O." (surname + two initials), e.g., "Yusupov A.B." — a People/HR module's display-name logic should support this compact format for tables and org charts, not just a full-name string. **Patronymic suffix choice**: per **Cabinet of Ministers Resolution No. 134, dated 15.02.2019** (civil-status document administrative regulations; summarized at [advice.uz](https://advice.uz/oz/document/1476), primary text not independently re-fetched this pass), citizens may register a patronymic using either the **Russian-style suffix** (-ovich/-ovna) or the **Uzbek-style suffix** (-oʻgʻli "son of" / -qizi "daughter of") — a data model must treat the patronymic as a free-text field capable of holding either convention, not assume one pattern.

**Forms of address**: formal written correspondence opens with **"Hurmatli [Ism Otasining ismi],"** ("Dear [Name Patronymic]") or **"Hurmatli hamkasblar"** for a group, and closes with **"Hurmat bilan"** ("Respectfully") plus signature and phone number (pattern confirmed via [mohirdev.uz](https://mohirdev.uz/blog/xizmat-yozishmalari-qoidalari-ananaviy-va-elektron-xabarlar-yuborishning-nozik-jihatlari/)). The Russian equivalent is **"Уважаемый/Уважаемая [Имя Отчество],"** … **"С уважением,"**. In spoken/informal-but-respectful in-person address, Uzbek uses given name plus a kinship-honorific suffix — **"aka"** for an older/senior man, **"opa"** for an older/senior woman, **"domla"** for a respected teacher/mentor figure — none of which map onto Russian directly. **Product implication**: a People-directory profile could usefully carry an optional "preferred address form" field (e.g., "Sherzod aka") for @mention/notification text, since this is how colleagues actually refer to each other, not by bare given name.

**Date format**: numeric dates use **DD.MM.YYYY** with period separators (e.g., 04.09.2026), as the original report already stated — unchanged and reconfirmed. **Written-out formal dates use a distinctive, language-specific word order that a naive locale-swap will get wrong**: Uzbek puts the year first — **"2026-yil 4-sentabr"** (year-hyphen-"yil," then day-hyphen-month name, no "of"/preposition) — while Russian keeps day-month-year with the month in genitive case and a trailing "года" — **"4 сентября 2026 года."** A date-formatting library needs distinct per-locale format templates for the long form, not just swapped month-name lists.

**Number format**: background/observed convention, **not traced to a specific official numbering standard this session** (flagged as such rather than asserted as law) — official financial tables (Central Bank exchange-rate pages, stat.uz publications) follow the shared post-Soviet/Russian convention of a **space as the thousands separator and a comma as the decimal separator** (e.g., "1 234 567,89 soʻm"), the reverse of the English convention. Any finance-adjacent figure in the product (per-diem tables, budget/staffing numbers) should go through a locale-aware number formatter rather than a hardcoded comma/period choice.

### 8. Civil-service position grades and typical department structure

**Law**: "On State Civil Service," **O'RQ-788-son, dated 08.08.2022** — [lex.uz](https://lex.uz/uz/docs/-6145972).
- **Article 22** — State Registry of civil service positions (the authoritative, President-approved inventory of which positions exist, classified by the level of the state body: national/republic/territorial/district).
- **Article 23** — Groups and categories of civil service positions: three groups — **political (siyosiy)**, **administrative (maʼmuriy)**, and **auxiliary (yordamchi)** positions. Political-group appointment/dismissal follows separate laws and Presidential decisions; administrative and auxiliary positions are filled by open competition and dismissed by the state body's head.
- **Article 24** — Qualification levels (malaka darajalari): assigned in consistent order based on position group/category, higher education, relevant work experience, completed professional-development coursework, and a positive conclusion from a qualification commission.
- **Article 3** limits the law's application to positions actually entered in the State Registry.

**Typical department shape**: **Presidential Decree PF-14, dated 25.01.2023** ([lex.uz](https://lex.uz/docs/-6369997)), on organizing executive-body work, sets a concrete staffing-ratio rule for central-apparatus departments: **administrative staff** (department/directorate head and deputy) and **executive/specialist staff** (chief specialist, leading specialist, specialist) should each make up **at least one-third** of a central-apparatus unit's staff. This gives a citable basis for exactly the grade ladder the original report already inferred from the reference prototype: **Specialist → Leading Specialist → Chief Specialist → Head of (Sub-)Department (boshliq) → Deputy Director → Director**, with a department typically composed of one head (+ possibly a deputy) plus a small bench of chief/leading/plain specialists beneath — a realistic template for the product's default org-chart/staffing-table seed data.

**Flag for a future pass**: **Presidential Decree PF-95, dated 19.06.2025** ([lex.uz](https://www.lex.uz/docs/-7587464)), "On organizing state civil service on new approaches and forming a professional and results-oriented corps of civil servants," postdates the bulk of prior research and was only located, not read in detail, this session — it may materially revise grading, attestation, or performance-review rules and should be read in full before finalizing the People/HR module's position and attestation data model.

**Net effect on the original report's 15 "What this means for us" recommendations**: items 4, 9, and 14 (data localization, admin-editable holiday calendar, three-part name fields) are now backed by stronger, cited evidence rather than background knowledge; no recommendation is contradicted or should be reversed by this pass's findings.
