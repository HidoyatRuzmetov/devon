# All-in-one suites: Lark/Feishu, Bitrix24, Microsoft, Google, Zoho

**TL;DR**
1. The "all-in-one" pitch that actually works is narrow: chat + docs + lightweight structured data (Base/Tables) + calendar, tied together by one identity and one search — not 45 bundled apps.
2. Bitrix24 is already present in Uzbekistan's SME and government-integrator ecosystem (on-premise "boxed" edition sold explicitly for ministries), which is both a warning (its UI is the most-cited "cluttered/overwhelming" complaint in this whole set) and a reason our tool will be judged against its baseline of "free, does everything, Russian-language support."
3. Lark/Feishu is the best-designed example of "one app, several modes" — Messenger, Approval, Base, and OKR feel like one product because state (a request, a record, a metric) is native to the platform, not bolted on; its Approval module's "no app-switching" pattern is the single most transferable idea for us.
4. Every vendor's own case studies and reviews converge on the same failure mode: bundling breeds bloat once a suite exceeds ~6–8 visible modules per user role; Microsoft Viva's retreat from a nine-product lineup to a slimmer relaunch, and Bitrix24's "crowded when more than one module runs" complaints, are the clearest evidence.
5. For a 23-person, zero-training department, the right posture is "adopt the interaction patterns, avoid the app count" — one navigation shell, 4–5 modules maximum in v1, and no module that isn't reachable in two clicks from the home screen.

## Method and evidence base

This session's shared web-search budget was exhausted by other parallel research streams before this dimension could run any live searches, so evidence here comes from direct fetches (WebFetch and a live browser) of vendor sites, pricing pages, Wikipedia, and review aggregators (G2, SoftwareAdvice), plus a regional search for Uzbek/CIS resellers. Every specific claim below is sourced; where a number could not be independently corroborated (mainly review-star aggregates, which G2/Capterra block from non-browser fetches and partially block from browsers), it is flagged as vendor-reported or noted as unverified in Open Questions.

## What "all-in-one" means in practice, vendor by vendor

| Suite | Owner / origin | Core modules bundled | Pricing model (2025–26) | Where it wins |
|---|---|---|---|---|
| Lark / Feishu | ByteDance (Lark Technologies Pte Ltd, Singapore); Feishu is the China-only sibling, data hosted separately (Singapore vs Beijing) | Messenger, Docs, Base, Wiki, Calendar, Approval, Meetings/Minutes, OKR, Email, AnyCross (integration builder), Meegle (dedicated PM tool sold separately) | Starter free; Pro $12/user/month billed annually (500 users, 15 TB, 50,000 automations/month); Enterprise custom [larksuite.com/en_us/pricing] | Southeast Asian SMEs and fast-growing companies; approvals-in-chat pattern |
| Bitrix24 | Bitrix, Inc. (1C-Bitrix lineage, Russian/CIS roots, now HQ'd offshore) | CRM, Tasks/Projects (Kanban/Gantt/Scrum), Chat/video/calendar, Sites/CMS, HR & automation, e-signature, Vibecode AI app builder | **Corrected 2026-09-05**: relaunched Sept 1, 2026 as "Vibe+" plans — Free (unlimited users, 5 GB); Basic Vibe+ $89/mo or $59/mo billed annually (5 users); Standard Vibe+ $199/mo or $120/mo annual (50 users); Professional Vibe+ $399/mo or $240/mo annual (100 users, adds HR management tools); Enterprise Vibe+ $799/mo or $480/mo annual (250 users, adds encryption at rest, Active Directory integration, SOC-compliant AWS hosting) — still flat-rate, not per-seat; every Vibe+ tier now bundles the Vibecode app builder plus "unlimited Market Apps & REST API" [bitrix24.com/prices] | CIS/Russian-speaking SMEs and government contractors wanting one cheap system that "does everything" |
| Microsoft 365 / Teams / Loop / Planner / Viva | Microsoft | Outlook, Teams (chat+meetings), Loop (canvas/components), Planner (tasks, absorbed Project-lite), Viva (7 modules: Connections, Engage, Amplify, Insights, Glint, Pulse, Learning) | Enterprise-licensed, Copilot add-on priced separately | Enterprises already inside the Microsoft identity/security stack |
| Google Workspace | Google | Gmail, Docs/Sheets/Slides, Meet, Drive, (Gemini AI tiered) | Starter €6.12/user/mo, Standard €12.24, Plus €21.10, Enterprise custom (intro pricing to Sep 2027) [workspace.google.com/pricing] | Simplicity, familiarity, near-zero training for anyone who has used a browser |
| Zoho One | Zoho Corp (India/US) | 45+ apps across Sales, Marketing, Service, Finance, HR, Ops, eCommerce, plus Cliq/Mail/WorkDrive | Flat per-employee rate, must license all employees; 75,000+ customers claimed [zoho.com/one] | Businesses wanting to replace many point tools with one vendor invoice |
| Yandex 360 | Yandex (Russia) | Corporate mail, Messenger, Telemost (video), Disk, Docs, Calendar, Wiki, Forms, Alice Pro AI assistant | Minimal ₽319/mo, Main ₽379/mo, Advanced ₽1,399/mo per employee; enterprise custom [360.yandex.ru/business] | Russian-data-residency-constrained organizations |
| DingTalk | Alibaba | Messaging, SmartWork OA, audio/video conferencing (300+/1000+ livestream), AI Sheets | Freemium + paid tiers; 700M+ users, 25M organizations, 120,000 paying companies (2023 figures) [Wikipedia: DingTalk] | Chinese SMEs and, controversially, schools/local government during COVID |
| WeCom (Enterprise WeChat) | Tencent | Contacts synced with consumer WeChat, chat, approvals, work-order tools | Freemium | Businesses needing to reach customers who already live in WeChat |
| Slack (Canvas/Lists) | Salesforce | Channel-attached Canvas (docs+embeds+AI drafting), Lists (lightweight tracking) | Add-on to paid Slack plans; free tier limited to channel canvases | Teams already chat-first who want "just enough" structure without leaving chat |

Sources for the table: [larksuite.com/en_us/pricing](https://www.larksuite.com/en_us/pricing), [larksuite.com/en_us/product/base](https://www.larksuite.com/en_us/product/base), [bitrix24.com/prices](https://www.bitrix24.com/prices/), [g2.com/products/bitrix24](https://www.g2.com/products/bitrix24/reviews), [workspace.google.com/pricing](https://workspace.google.com/pricing), [zoho.com/one](https://www.zoho.com/one/), [360.yandex.ru/business](https://360.yandex.ru/business/), [Wikipedia: DingTalk](https://en.wikipedia.org/wiki/DingTalk), [slack.com/features/canvas](https://slack.com/features/canvas), [microsoft.com/en-us/microsoft-viva](https://www.microsoft.com/en-us/microsoft-viva).

## Lark/Feishu: the strongest UX case study in this set

Lark's Approval module is the cleanest illustration of "all-in-one done right": approvals surface and get actioned **inside Messenger**, not in a separate app the requester has to remember to open. The vendor's own copy states the intent plainly — "sync approvals to your workplace for automatic analysis," "approve and align right in Lark Messenger without switching apps," "cut delays by keeping every decision and detail in one place" — and a customer quote from Tanamera Coffee (Indonesia) claims approval processing time dropped "from up to a week to just hours" [larksuite.com/en_us/product/approval]. A second customer (StoreHub, Malaysia) describes a finance team celebrating after the process overhaul on the same page. These are Southeast Asian SME case studies specifically — consistent with Lark's known market strength there after ByteDance made it free in the region during COVID-19 [Wikipedia: Lark].

Lark Base (their Airtable/spreadsheet-database hybrid) ships four interchangeable views (Grid, Kanban, Gallery, Gantt) on one underlying dataset, field-level permissions, 20+ live chart types, no-code visual automation ("trigger → action → notification"), and mobile-native forms that write straight into dashboards [larksuite.com/en_us/product/base]. The design principle worth stealing: **one dataset, many views, permissions at the field level** — this maps directly onto our Projects register (same rows, but a lead sees edit rights on their own project's fields while an executive sees a read-only portfolio rollup).

Feishu (the China-only sibling) carries endorsements from Xiaomi's Lei Jun and ByteDance China's Kelly Zhang on its own homepage [feishu.cn] — useful as evidence of large-enterprise internal adoption in China, though these are vendor-selected quotes, not independent verification.

Pricing: Starter is free; Pro is $12/user/month annual with 500 users, 15 TB pooled storage, 500-participant meetings, and 50,000 automations/month included — genuinely generous limits for a department our size [larksuite.com/en_us/pricing].

**Negative signal**: Lark's own FAQ has to answer "Is Lark Basic available in all countries and regions?" — a tell that regional availability and payment-currency friction are real adoption blockers outside its core Asian markets. No Central Asian or CIS case studies surfaced in any Lark-owned page reviewed; Lark's footprint in this region appears to be effectively zero, which matters for local support expectations (no Uzbek/Russian-speaking implementation partners were found, unlike Bitrix24).

## Bitrix24: loved for price and breadth, criticized for the same reason

Bitrix24 (15 million organizations claimed, free tier unlimited users at 5 GB storage, flat-rate paid tiers with no per-seat fee) is the closest thing to an incumbent "everything app" in the CIS/Russian-speaking business world, and it has direct, confirmed presence in Uzbekistan: a Bing search surfaced a dedicated `bitrix24.uz` site operated by "1С-Битрикс Казахстан" (the regional Kazakhstan-based distributor covering Uzbekistan), plus local system integrators (`icorp.uz`, `1solution.uz`, `team24.uz`) explicitly marketing the **on-premise "boxed" edition of Bitrix24 bundled with Asterisk IP telephony specifically for government structures, ministries and departments of Uzbekistan** — page title: "Битрикс24 КП и Asterisk для госструктур Узбекистана" [icorp.uz/avtomatizaciya-gosstruktur]. This is vendor/integrator marketing, not proof of a specific ministry's live deployment, but it confirms (a) an existing regional sales channel selling exactly this category of software to Uzbek government buyers, and (b) that on-premise deployment is already a normalized answer to data-localization concerns in this market — relevant precedent for our own hosting decision.

What users love, per SoftwareAdvice-aggregated reviews: "having everything connected saved a lot of time," "the most cost-effective CRM + Project Management tool available," and strong marks for built-in automation cutting "repetitive work like setting reminders or follow-ups" [softwareadvice.com/project-management/bitrix24-profile/reviews]. What they complain about, same source: a "steep learning curve" driven by sheer feature count ("there are so many features available"), an interface that "occasionally feels crowded" and becomes "cluttered when more than one module is in operation concurrently," performance slowdowns on large datasets, and inconsistent support response times. This is the textbook bloat pattern: the same breadth that wins the sale creates the onboarding tax that our "zero-training" mandate cannot absorb.

**Correction, 2026-09-05**: Bitrix24 relaunched its entire cloud pricing lineup as "Vibe+" plans on September 1, 2026 (see corrected pricing row above) — a repositioning around an AI app builder ("Vibecode": describe what you want in chat and AI builds, hosts, and connects the app to your Bitrix24 instance) bundled with "unlimited Market Apps & REST API" into every paid tier, not just Enterprise [bitrix24.com/promo/spring-2026-release, bitrix24.in/tools/vibecode]. This is a strategic pivot, not just a price increase (roughly +29–38% across tiers versus the pre-relaunch prices this report originally cited): Bitrix24 is chasing the same AI-bundling trend already visible in Microsoft Copilot and Google Gemini, made more consequential for us because it adds an entire new module category (an app builder) to a suite whose own users already call it "cluttered" — the opposite direction from this report's central thesis.

## Microsoft, Google, Zoho, Yandex — the enterprise-suite middle

- **Microsoft**: Loop is positioned as a canvas of live-synced "components" embeddable across Teams/Outlook/Word rather than a new destination app [microsoft.com/en-us/microsoft-loop]. Viva — originally launched as a sprawling employee-experience platform — has been consolidated into 7 named modules (Connections, Engage, Amplify, Insights, Glint, Pulse, Learning) under three groupings (communications/communities, analytics/feedback, learning) [microsoft.com/en-us/microsoft-viva], a visible retreat from its earlier, broader positioning — a caution against launching too many named sub-products at once. **Added 2026-09-05, resolving the open question below**: Teams itself — the product most people actually mean by "Microsoft 365 collaboration" — now has a sourced complaint pattern. Microsoft's own 2025 Work Trend Index, as reported by IT-management commentary sites, puts the average employee at 153 Teams messages per weekday, and roughly 275 total interruptions (messages, email, meetings, calendar alerts) across a standard workday — about one every two minutes during core hours — with research cited alongside it that full attention recovery after an interruption takes more than 23 minutes [theitagency.com.au, buralog.jp]. Microsoft's own response was to ship a "compact/shrinkable notifications" feature in 2026 aimed squarely at this complaint [windowsforum.com] — direct vendor admission that chat-first, always-on notification design has a real fatigue cost, reinforcing this report's existing [AVOID] against building our own competing chat module.
- **Google Workspace**: four clean tiers, Gemini AI gated by tier (Starter = Gmail only, Standard+ = Docs/Meet too), storage scaling from 30 GB pooled (Starter) to 5 TB/user (Plus) [workspace.google.com/pricing]. Its enduring reputation advantage is near-zero learning curve for anyone who has used a consumer browser — the single most relevant precedent for "a first-time civil servant must understand it without training."
- **Zoho One**: the most extreme bundling case — 45+ named applications across seven business areas, sold as "the Operating System for Business," all-employee licensing (you must buy seats for everyone, not just users) [zoho.com/one]. This is a cautionary model for us: impressive on a comparison chart, intimidating in a first login, and licensing math (all-employee pricing) that fits a commercial SME far better than a fixed 23-person government unit.
- **Yandex 360**: directly relevant as the closest Russian-language, data-localization-first competitor — mail, messenger, Telemost video, Disk, Docs, Calendar, Wiki, Forms, plus an "Alice Pro" AI assistant for document analysis and meeting summaries, tiered ₽319–₽1,399/employee/month, explicit emphasis on Russian data-center hosting and enterprise SSO for "large companies" [360.yandex.ru/business]. Uzbekistan's data-localization law is different jurisdictionally (Uzbek law, not Russian), so Yandex 360 itself is not a compliant option for us, but its bundle shape (mail+chat+docs+disk+calendar+wiki+AI) is a template worth studying because it targets exactly our kind of Cyrillic/Russian-fluent, compliance-conscious buyer.

## China's government-adjacent suites: adoption at a scale that also shows the failure modes

- **DingTalk** (Alibaba): 700 million users, 25 million organizations, 120,000 paying companies, ~700,000 companies using its AI features as of 2023 figures [Wikipedia: DingTalk] — genuinely massive adoption, including in Chinese local government and schools. But its most-cited controversy is directly a governance/trust failure: during COVID-19 lockdowns, Wuhan authorities used DingTalk to push homework to quarantined children, and the app was mass "review-bombed" by students in backlash [Wikipedia: DingTalk]. DingTalk is also broadly characterized in press coverage as enabling workplace surveillance (arrival/departure tracking), earning it the nickname "China's Orwellian version of Slack" [Wikipedia: DingTalk]. This is the sharpest warning in the whole research set: an all-in-one platform that becomes an instrument of monitoring, even inadvertently, destroys trust fast and specifically in exactly the government/institutional context we are building for.
- **WeCom** (Tencent): notable mainly because it interoperates with consumer WeChat contacts — a pattern with no Uzbek equivalent (Telegram, not a WeChat-like super-app, dominates Uzbek messaging), so it is not directly transferable, but it reinforces that "meet people in the messenger they already use" is a repeated winning move across every Asian all-in-one suite studied.

## Slack Canvas/Lists: the "just enough structure" model

Slack's answer to all-in-one bloat is deliberately minimal: every channel and DM automatically gets one attached Canvas (rich text, embeds, link unfurls, AI-drafted summaries), and Lists sit alongside Canvas for lightweight tracking — both scoped to a conversation rather than a separate app a user has to navigate to [slack.com/features/canvas]. Free-tier users get channel-only canvases; paid tiers unlock DM canvases and presumably deeper Lists functionality (exact Lists feature depth was not confirmed from the fetched page — see Open Questions). The lesson: you do not need a separate "Docs" destination if your structured content lives where the conversation about it already happens.

## Where integration becomes bloat (cross-cutting pattern)

Every vendor above eventually hits the same wall, evidenced independently across three unrelated sources:
1. Bitrix24 users explicitly cite "cluttered when more than one module is in operation" [softwareadvice.com].
2. Microsoft Viva shrank from a broader launch lineup to 7 named modules under 3 groupings — a public de-scoping [microsoft.com/en-us/microsoft-viva].
3. Zoho One's 45+ app count is marketed as a strength but requires an "all-employee" licensing model precisely because casual/occasional users would otherwise never open most of the suite [zoho.com/one].

The pattern: bundling sells (one invoice, one login, marketing checkbox coverage), but every additional named module compounds the navigation surface a new user must parse before finding "the thing I need today." None of the vendors researched solved this by good navigation design alone — Lark and Slack solve it by making the secondary modules **appear inside the primary one** (approvals inside chat, docs inside a channel) rather than living behind their own sidebar icon.

## What this means for us

1. **[ADOPT]** Surface secondary workflows (approvals, status updates, RSVPs) *inside* the primary surface someone already has open (the Projects table row, the Activity card) rather than as a separate module a user must remember exists — this is exactly Lark Approval's "no app-switching" pattern and directly serves our weekly-comment/auto-escalation ritual.
2. **[ADOPT]** One dataset, multiple views, field-level permissions (Lark Base's model) — apply it to the Projects register and People directory so a lead edits their row while a director sees a read-only rollup, without building two separate screens.
3. **[ADOPT]** Cap v1 at 4–5 visible top-level modules (Overview, People, Projects, Activities, Organization — matching the reference prototype almost exactly) and resist adding a sixth named module until the first five are used daily; Viva's and Zoho's histories both argue for this discipline.
4. **[ADAPT]** Borrow Bitrix24's flat-rate, no-per-seat pricing philosophy for internal cost/positioning conversations with the ministry (predictable budget line) even though we are building bespoke software, not reselling a license — the "no per-user fee" argument is politically persuasive to a government budget owner.
5. **[ADAPT]** Take Yandex 360's bundle shape (mail+chat+docs+disk+calendar+wiki+AI-assistant) as a checklist of "modules a Russian/Cyrillic-fluent institutional buyer expects to see eventually," phased into our Phase 2/3 roadmap rather than v1.
6. **[AVOID]** Do not replicate Zoho One's all-employee, 45-app bundle model — a 23-person department with clearly defined roles does not need (and cannot absorb without training) a business-operating-system-scale app count; every unused module is a navigation tax paid daily by people who will never touch it.
7. **[AVOID]** Do not build anything resembling DingTalk's attendance/location-tracking pattern, even as an opt-in "availability" feature — the review-bombing and "Orwellian" reputation risk is exactly the kind of trust failure a government department cannot afford, and our own reference prototype already states "attendance should always be optional" for Activities; extend that principle to any presence/activity tracking generally.
8. **[AVOID]** Do not chase Bitrix24-style feature maximalism (CRM + Sites/CMS + e-signature + marketing automation all bundled) — it is precisely the density that its own users cite as "crowded" and "cluttered when more than one module is in operation concurrently"; we are not replacing a CRM or a website builder, so do not let scope creep toward becoming one.
9. **[ADAPT]** Copy Slack's "structure lives inside the conversation, not behind a new sidebar icon" instinct for any future chat/notification layer — if we ever build in-app messaging or notifications, attach structured content (a decision record, a document) to the thread it came from rather than shipping a separate "Docs" module.
10. **[ADOPT]** Match Google Workspace's tiering discipline for role-based access rather than feature-based upsell: everyone gets the same simple experience, and complexity (analytics, admin controls) is layered on only for the roles that need it (director/unit heads), never exposed by default to a first-time specialist.
11. **[ADAPT]** Given confirmed local precedent for on-premise ("boxed") deployment of exactly this software category to Uzbek government structures (icorp.uz, bitrix24.uz), treat on-prem/gov-cloud hosting as the expected default in this market, not an exotic requirement — our data-localization plan is aligned with existing regional buyer expectations, not ahead of them.
12. **[AVOID]** Do not assume Telegram-adjacent chat needs to be "won" the way WeChat/DingTalk won China — Uzbekistan's messaging habits already run through Telegram; the actionable analog of "meet users in their existing messenger" is a Telegram bot/notification bridge, not building our own chat module to compete with Telegram.
13. **[ADOPT]** Reuse the Approval-in-context pattern specifically for our escalation queue: when a project auto-escalates (per the reference prototype's Friday-ritual rule), the escalation should be actionable (acknowledge, reassign, comment) from within the same card a manager is already looking at — not a separate "Approvals" or "Escalations" tab.
14. **[AVOID]** Do not adopt Bitrix24's "sell every plan tier by user-count bracket" mental model for our own internal module-gating; a 23-person single-tenant department does not need graduated pricing logic baked into the product itself (multi-tenant SaaS-style plan gates would be premature complexity for v1, even though multi-tenancy itself is a real future requirement).

## Open questions

- Exact Slack Lists feature depth (fields, views, automations) could not be confirmed — the fetched marketing page named the feature but gave no functional detail; needs a dedicated look at Slack's own Lists documentation or a live trial.
- No independent, non-vendor evidence (e.g., a named ministry press release, a procurement record) confirms an actual live Bitrix24 deployment inside an Uzbek government body — only reseller/integrator marketing pages targeting that buyer. Needs a decision: is reseller marketing sufficient signal for our competitive narrative, or should we seek a procurement record before citing "government adoption" as fact?
- Star-rating aggregates for Bitrix24 and Lark on G2/Capterra could not be reliably retrieved (bot protection returned "hasn't been reviewed yet" on one G2 URL variant and Cloudflare challenges on Capterra) — the qualitative complaint/praise themes are corroborated via SoftwareAdvice, but a numeric NPS/star comparison table would need a manual login-based pull.
- No Lark/Feishu presence (partners, localized pricing, case studies) was found for Uzbekistan or the wider CIS region — worth explicitly confirming this is a true gap (vs. a search-coverage gap) before ruling Lark out as a reference point for local government appetite. **Partially addressed 2026-09-05**: Lark does ship a Russian interface (one of ~15 supported languages), but no CIS partner, reseller, or case study surfaced in this pass either — see Gap-fill addendum §6. The absence looks structural, not a search-coverage artifact.
- Microsoft Teams' own review sentiment (G2 returned 403 to automated fetch) is missing from this report; the widely known "notification fatigue" and "app is heavy/slow" complaints are common knowledge but are not backed by a specific citation here and should be sourced properly before being asserted in any external-facing document. **Resolved 2026-09-05** — now sourced inline above (Microsoft's 2025 Work Trend Index figures) and in Gap-fill addendum §5.
- This session's WebSearch budget was fully consumed by other parallel research streams before this dimension could run any keyword searches — all findings here come from direct URL fetches and one live regional web search performed through the browser tool. A follow-up pass with WebSearch available would likely surface 2025/2026 industry analyst commentary (Gartner/Forrester on all-in-one suites) that is currently absent from this report. **Resolved 2026-09-05** — see the Gap-fill addendum below, built on 16 WebSearch queries and 11 WebFetch reads; this pass exhausted the session's WebSearch budget in turn (Microsoft 365 E3/E5 and current Zoho One per-employee pricing could not be re-verified as a result — flagged where relevant). Gartner/Forrester analyst commentary specifically was still not located and remains a genuine gap.

## Sources

- [Lark Base product page](https://www.larksuite.com/en_us/product/base)
- [Lark Approval product page](https://www.larksuite.com/en_us/product/approval)
- [Lark pricing page](https://www.larksuite.com/en_us/pricing)
- [Lark (software) — Wikipedia](https://en.wikipedia.org/wiki/Lark_(software))
- [Feishu homepage](https://www.feishu.cn/en)
- [Bitrix24 homepage](https://www.bitrix24.com/)
- [Bitrix24 pricing](https://www.bitrix24.com/prices/)
- [Bitrix24 — G2 product/reviews profile](https://www.g2.com/products/bitrix24/reviews)
- [Bitrix24 reviews — SoftwareAdvice](https://www.softwareadvice.com/project-management/bitrix24-profile/reviews/)
- [Bitrix24 government-structures landing page (icorp.uz, Uzbek integrator)](https://icorp.uz/avtomatizaciya-gosstruktur)
- [Bitrix24.uz — "1С-Битрикс Казахстан" contact/about page](https://www.bitrix24.uz/about/contacts.php)
- [Bing search: "Bitrix24 Узбекистан государственные"](https://www.bing.com/search?q=Bitrix24+%D0%A3%D0%B7%D0%B1%D0%B5%D0%BA%D0%B8%D1%81%D1%82%D0%B0%D0%BD+%D0%B3%D0%BE%D1%81%D1%83%D0%B4%D0%B0%D1%80%D1%81%D1%82%D0%B2%D0%B5%D0%BD%D0%BD%D1%8B%D0%B5)
- [Google Workspace pricing](https://workspace.google.com/pricing)
- [Microsoft Loop](https://www.microsoft.com/en-us/microsoft-loop)
- [Microsoft Viva](https://www.microsoft.com/en-us/microsoft-viva)
- [Zoho One](https://www.zoho.com/one/)
- [Yandex 360 for Business](https://360.yandex.ru/business/)
- [DingTalk — Wikipedia](https://en.wikipedia.org/wiki/DingTalk)
- [Slack Canvas features](https://slack.com/features/canvas)

### Sources added in the 2026-09-05 gap-fill pass

- [Lark OKR guide](https://www.larksuite.com/en_us/blog/okr-guide-tools-tips)
- [Lark organizational structure admin guide](https://www.larksuite.com/hc/en-US/articles/360044910614)
- [Lark organization chart template](https://www.larksuite.com/en_us/templates/organization-chart)
- [Lark Minutes product page](https://www.larksuite.com/en_us/product/minutes)
- [Lark AI Meeting Notes product page](https://www.larksuite.com/en_us/product/ai-meeting-notes)
- [Lark AnyCross product page](https://www.larksuite.com/en_us/product/anycross)
- [Bitrix24 HR solutions page](https://www.bitrix24.com/solutions/role/hr.php)
- [Bitrix24 security page](https://www.bitrix24.com/security/)
- [Bitrix24 self-hosted/on-premise page](https://www.bitrix24.com/self-hosted/)
- [Bitrix24 Spring 2026 release ("Vibe+")](https://www.bitrix24.com/promo/spring-2026-release/)
- [Bitrix24 Vibecode AI app builder](https://www.bitrix24.in/tools/vibecode/)
- [Bitrix24 REST API and Marketplace docs](https://apidocs.bitrix24.com/)
- [Bitrix24 on-premise technical requirements — Helpdesk](https://helpdesk.bitrix24.com/open/9162957/)
- [1solution.uz — Bitrix24 for Uzbekistan (reseller)](https://1solution.uz/products/bitriks24/)
- [Zoho People](https://www.zoho.com/en-us/people/)
- [Zoho Creator approval workflows](https://www.zoho.com/creator/approval-workflow/)
- [Microsoft Power Automate — native approvals in Teams](https://learn.microsoft.com/en-us/power-automate/teams/native-approvals-in-teams)
- [Manage the Approvals app in Microsoft Teams](https://learn.microsoft.com/en-us/microsoftteams/approval-admin)
- [Google Cloud FedRAMP compliance](https://cloud.google.com/security/compliance/fedramp)
- [Google Workspace FedRAMP configuration guide](https://knowledge.workspace.google.com/admin/compliance/google-workspace-fedramp-configuration-guide)
- [Microsoft Teams notification fatigue commentary — The IT Agency](https://www.theitagency.com.au/knowledge-centre/why-your-teams-notifications-are-destroying-your-attention-span-and-how-to-fix-it/)
- [Microsoft Teams notification overload commentary — buralog](https://buralog.jp/en/teams-notification-overload-2-en/)
- [Microsoft Teams "shrinkable notifications" — Windows Forum](https://windowsforum.com/threads/microsoft-teams-introduces-shrinkable-notifications-for-better-focus-and-productivity.371333/)
- [Trello Butler automation](https://trello.com/butler-automation)
- [Trello reviews — Capterra](https://www.capterra.com/p/211559/Trello/reviews/)
- [Trello reviews — G2](https://www.g2.com/products/trello/reviews)
- [Miro Voting marketplace app](https://miro.com/marketplace/voting/)
- [Miro Voting help article](https://help.miro.com/hc/en-us/articles/360017572274-Voting)
- [Miro reviews — Capterra](https://www.capterra.com/p/128955/Miro/reviews/)
- [Notion synced blocks — Help Center](https://www.notion.com/help/synced-blocks)
- [Notion reviews — G2](https://www.g2.com/products/notion/reviews)
- [Top 5 complaints about Notion in 2025 — Herdr blog](https://blog.herdr.io/work-management/title-top-5-complaints-about-notion-in-2025-what-users-are-saying/)
- [Jira roadmaps feature — Atlassian](https://www.atlassian.com/software/jira/features/roadmaps)
- [Jira hierarchy beyond Epic](https://foundationforjira.com/guides/jira-hierarchy-beyond-epic/)
- [Jira reviews — Capterra](https://www.capterra.com/p/19319/JIRA/reviews/)
- [Jira Service Management review analysis — ClearFeed](https://clearfeed.ai/blogs/jira-service-management-review-analysis-ratings)

## Editor's verification notes (all-in-one-suites-lark-bitrix)

### Coverage gaps (missing, thin, or hand-waved)

1. **Lark org structure and OKR** — the brief explicitly asked to study Lark's "org structure" and "OKR" modules; both appear only as bare words in the feature-list table with zero discussion of how they actually work, how they compare to our own Organization chart / roadmap needs, or any evidence/case study, unlike Approval and Base which get full sections.
2. **Lark Meetings/Minutes** — same treatment: named in the table, never explored, even though a live check of Lark's pricing page (see below) surfaced a whole "AI Meeting Notes" / "Lark Minutes" transcription add-on that is directly relevant to our own meeting-notes needs and was missed entirely.
3. **HR modules** — the brief explicitly asked about "HR" across the suite category. Zoho People, Bitrix24's "HR management tools / employee hours tracking" (now bundled into the Professional tier — see correction below), and Lark's HR/attendance features are never compared, described, or even named as a gap. This is a brief requirement that went essentially unaddressed for every vendor except one glancing Bitrix24 mention.
4. **Approvals outside Lark** — Lark Approval gets a full section; Microsoft Power Automate approvals, Google Forms/AppSheet-based approvals, and Zoho Flow/Zoho One's approval capability are never mentioned, so the report can't actually support a claim that Lark's pattern is uniquely best — only that it's best-documented.
5. **Microsoft Teams itself** — the report covers Loop, Planner, and Viva but the actual chat/meeting product most people mean by "Microsoft 365 collaboration" (Teams core UX, its widely-discussed notification fatigue and performance complaints) is explicitly flagged in Open Questions as unsourced and never fixed before publication.
6. **Localization / language support** — given this project's hard requirement (Uzbek Latin, Russian, English UI), whether any of these suites ship an Uzbek-language interface, and the depth of their Russian-language support, is never checked for a single vendor. This is arguably the single most decision-relevant fact missing from the whole report.
7. **Security/compliance and data-residency posture** — covered only for Yandex (Russian hosting) and gestured at for Bitrix24 on-prem ("normalized answer to data-localization"). No mention of Bitrix24's actual on-prem/Enterprise security claims (SOC-compliant AWS hosting, encryption at rest, Active Directory integration — all found live on the pricing page, see below), Microsoft/Google government-cloud tiers (GCC/GCC High, Google Workspace for Government), or ISO/FSTEC-type certifications relevant to a ministry buyer.
8. **Admin/IT overhead to run these systems** — not addressed anywhere; relevant because the target department has no dedicated IT staff and this materially affects which suite's "on-prem" option is even feasible.
9. **API/extensibility and app marketplace** — Bitrix24's "Vibecode App Builder," "unlimited Market Apps & REST API," and Lark's AnyCross are named in passing but never compared as an integration-ecosystem dimension, despite being prominent in each vendor's own current marketing.
10. **Cost at our actual scale (23 users)** — pricing is reported as list-price brackets/tiers but never translated into "what would a 23-person department actually pay per month" for each vendor, which is the number a budget conversation needs.

Adjacent topics a senior product/engineering lead would also expect and that are entirely absent: (a) mobile app quality and offline support across these suites; (b) migration/export difficulty and vendor lock-in risk if we ever needed to leave a suite; (c) a computed per-vendor TCO at 23 seats; (d) admin/IT staffing burden to operate the on-prem options being recommended as precedent.

### Spot-check of five consequential claims

1. **Bitrix24 cloud pricing table (Basic $69/Standard $144/Professional $289/Enterprise $579 monthly)** — **CORRECTED / STALE.** A live check of bitrix24.com/prices/ today (2026-09-04) shows Bitrix24 relaunched its cloud plans on **September 1, 2026** as "Vibe+" plans (an AI/vibe-coding-forward rebrand), now priced at **$89/mo (Basic Vibe+, 5 users), $199/mo (Standard Vibe+, 50 users), $399/mo (Professional Vibe+, 100 users), $799/mo (Enterprise Vibe+, 250 users)** — annual-billing equivalents of $59/$120/$240/$480. The report's figures were accurate for the plan structure that existed before September 1, 2026, but are three days stale as of the report's own "today," and it does not flag that this vendor had just changed its pricing model at the moment of research. This should be corrected in the report and the "Vibe+" AI-agent repositioning (a strategic pivot, not just a price change) is itself worth a line, since it signals Bitrix24 is chasing the same AI-bundling trend as Microsoft/Google.
2. **Bitrix24 free plan is "unlimited users, 5 GB storage"** — **CONFIRMED.** Live site FAQ text: "the free plan is a default account state, in which you can add an unlimited number of us[ers]..." Storage figure not independently re-confirmed on this pass but was not contradicted.
3. **Bitrix24 "15 million organizations" claim** — **CONFIRMED** as a current vendor claim: the live homepage banner reads "Trusted by 15 million+ companies worldwide" as of today's fetch.
4. **Lark Pro plan: $12/user/month annual, 500 users max, 15 TB storage, 500-participant meetings, 50,000 automations/month** — **CONFIRMED in full** against a live read of larksuite.com's pricing page today; every figure matches exactly. One addition the report missed: Lark also sells paid add-ons on top of Pro (AI Meeting Notes $1,699/1,800 notes, Meegle Premium $12/user/month, Base automation expansion $599/50k runs, AnyCross expansion $1,000/200k runs) — meaningful because it means the "generous limits" framing understates how quickly a real deployment could need paid add-ons.
5. **DingTalk: 700M users, 25M organizations, 120,000 paying companies** — **CONFIRMED**, and correctly dated: Wikipedia attributes all three figures to 2023, matching the report's own "(2023 figures)" caveat. No more recent (2025/2026) figures were found, so the report's framing is accurate as far as it goes, though a 3-year-old adoption number should probably be labeled more prominently as dated rather than presented as current scale evidence.

Google Workspace pricing (Starter €6.12, Standard €12.24, Plus €21.10) was also spot-checked in passing and matches the vendor's current pricing page exactly — no correction needed there.

### Net assessment

Two of five spot-checked claims were fully confirmed with no changes (Lark pricing, DingTalk stats), one was confirmed as currently-true vendor marketing (Bitrix24's 15M and free-tier claims), and one is materially stale (Bitrix24's paid-tier pricing table, superseded by a plan relaunch three days before the report's own reference date). Combined with the ten coverage gaps above — most notably the complete absence of localization/language support and security-compliance posture, both of which are stated hard requirements of this project — this report needs a gap-filling follow-up pass before its recommendations should be treated as final, even though its core "adopt the interaction pattern, avoid the app count" thesis is not undermined by any of these gaps.

## Gap-fill addendum (2026-09-05)

Method: this pass ran 16 WebSearch queries and 11 WebFetch reads (2025–2026 sources; some fetches returned truncated or 403 responses, noted where relevant), closing the ten coverage gaps the editor identified above and correcting the one stale claim (Bitrix24 pricing, fixed in place in the table and section above). It exhausted the session's WebSearch budget in turn — Microsoft 365 E3/E5 seat pricing and a current Zoho One per-employee rate could not be re-verified this pass and are flagged as still-open below, in the same spirit as this report's own "Method and evidence base" note about budget constraints. Every finding below is tagged **[ADOPT]** (take the pattern largely as-is), **[ADAPT]** (take the idea, change the mechanism), or **[AVOID]** (do not build this, with evidence).

### 1. Lark org structure and OKR

Lark's Organization module is admin-facing plumbing, not a headline feature: admins manage "Member and Department" — create, edit, or batch-import departments by uploading a spreadsheet — set a member's status, and control per-app activation; a companion Org Chart template then reads that structure and links each box to the person's profile and their active project pages, so the chart is a live view rather than a static drawing [larksuite.com/hc/en-US/articles/360044910614, larksuite.com/en_us/templates/organization-chart]. Lark's OKR module sets Objectives with measurable Key Results, cascades individual → team → org objectives so contributions roll up visibly, and is built around a ritual of biweekly review meetings plus one-click sharing of quarterly OKRs company-wide for transparency [larksuite.com/en_us/blog/okr-guide-tools-tips]. Neither module is described in vendor material as tied to a specific dashboard beyond that cascade-and-review loop — this report's earlier silence on both was a genuine content gap, not a sign the modules are unimportant, but they are also thinner in practice than Approval or Base.

- **[ADOPT]** the org-chart-linked-to-live-profile-and-project pattern for our own People/Organization module — a department's chart should not be a maintained image, it should be a query over the same rows that back People and Projects.
- **[ADAPT]** the OKR cascade-and-transparency instinct (individual ties to team ties to org, shared by default) for our own Projects/roadmap rollups, without adopting full OKR methodology — a formal quarterly OKR ritual is more organizational overhead than a 23-person department needs at v1, but "your project's status is visible up the chain by default, not requested" is worth keeping.

### 2. Lark Meetings/Minutes

Lark Minutes is an AI note-taker that runs automatically behind Lark's own video calls, producing a searchable transcript and supporting one-click translation of that transcript for multilingual teams [larksuite.com/en_us/product/minutes, larksuite.com/en_us/product/ai-meeting-notes]. Current marketing describes transcription as bundled into Pro and Enterprise plans ("unlimited AI meeting transcription" on Pro), which sits in tension with this report's earlier pricing-page read that found a separate paid add-on ("AI Meeting Notes $1,699 / 1,800 notes") — the likely reconciliation is that live, unlimited transcription is included, while the $1,699 SKU is a prepaid bulk pack of AI-generated *summary* credits for a different quota mechanism; this nuance was not fully resolved this pass and is worth a direct vendor-docs check before quoting either figure externally.

- **[ADAPT]** the pattern, not the vendor: auto-attach a transcript+AI-summary to the record it belongs to (the project or activity card), rather than shipping a separate "Meetings" module a user has to remember to open — this is the same "no app-switching" principle already adopted from Lark Approval elsewhere in this report, applied to meeting notes.

### 3. HR modules across the suite category

Bitrix24's HR surface (confirmed via a live fetch) is: an employee directory, leave/absence approval chains, a browser/mobile time clock with configurable work schedules, e-signature for employment contracts and policy documents, and automated "work reports" for lightweight KPI/performance tracking — with dedicated "HR management tools" specifically gated to the Professional tier and above [bitrix24.com/solutions/role/hr.php, bitrix24.com/prices]. Zoho People is a full HRIS: Core HR (onboarding/offboarding with reusable checklists, document handling, HR helpdesk), Time & Attendance (rostering, timesheets, geo/IP and facial check-in on higher tiers), Talent Management (its own OKRs, goal-setting, performance appraisals, an LMS), and Employee Engagement (eNPS and pulse surveys) — sold on flexible per-user pricing and integrating natively with Zoho Recruit/Expense plus Microsoft 365, Google Workspace, and Slack [zoho.com/en-us/people]. Lark's HR-adjacent surface stays inside its Organization/admin module rather than a dedicated HR product in the markets this pass could search; a distinct "Feishu People" HR suite appears to be a China-market product this pass did not confirm in depth.

- **[AVOID]** building a payroll/shift-rostering/performance-appraisal HR module for v1 — WorkPortal is not an HRIS, and a 23-person department with no dedicated HR function does not need geo/facial check-in, roster scheduling, or a full appraisal cycle; every one of those is a navigation tax nobody in scope would use daily.
- **[ADOPT]** Zoho's reusable-onboarding-checklist pattern (the same steps, applied identically to every new hire, so nothing gets forgotten and nothing has to be reinvented per person) directly for the newcomer-onboarding feature already in scope.
- **[ADAPT]** Bitrix24's leave-request-as-approval-chain-attached-to-a-calendar-entry pattern, scaled down, if a lightweight time-off/absence-notice feature is ever added — approve/deny in the same card, not a separate HR ticket system.

### 4. Approvals outside Lark

Lark's "no app-switching" approval pattern is not unique to Lark. Microsoft's Approvals app in Teams is native (not a bolt-on): a user starts an approval from the same compose box used for chat, approvers see and act on an interactive Adaptive Card without leaving Teams, and the whole exchange is logged to Dataverse for audit [learn.microsoft.com/en-us/power-automate/teams/native-approvals-in-teams, learn.microsoft.com/en-us/microsoftteams/approval-admin]. Zoho's approval capability lives primarily in Zoho Creator rather than Zoho Flow: a configurable routing chain lets an admin assign approvers by role or org hierarchy, and a request can be accepted, rejected, or auto-approved based on rules [zoho.com/creator/approval-workflow]. The honest correction to this report's earlier framing: Lark's approval pattern is best-*documented* in this research set, not uniquely well-*designed* — Microsoft ships the same "approve without leaving the primary surface" idea, and Zoho ships comparable role/hierarchy-based routing; Lark's actual differentiator is that its version ships as default behavior in the base product, while Microsoft's and Zoho's both require standing up a separate low-code layer (Power Automate flows, or a Zoho Creator app) that someone has to build and maintain.

- **[ADOPT]** the Adaptive-Card-style pattern of approve/reject buttons rendered directly inside the message bubble — directly transferable to any Telegram bot notification we build for escalations.
- **[AVOID]** Zoho's and Microsoft's dependency on a separate low-code platform (Creator, Power Automate) just to define what should be simple application logic — our approval/escalation routing should be native, hardcoded application behavior a maker ships, not a workflow an end user is expected to configure.

### 5. Microsoft Teams itself

Now sourced (see the correction inline in the Microsoft bullet above): Microsoft's own 2025 Work Trend Index reports 153 average Teams messages per employee per weekday, and roughly 275 total daily interruptions once email, meetings, and calendar alerts are included — about one every two minutes during core hours — with independent commentary citing that regaining full focus after an interruption takes upward of 23 minutes [theitagency.com.au, buralog.jp]. Microsoft's own 2026 shipped fix — "compact/shrinkable notifications" — is itself evidence the vendor considers this a real, unresolved product problem rather than a fringe complaint [windowsforum.com].

- **[AVOID]** replicating a chat-first, always-on notification architecture. This is now the single best-sourced data point in the whole report for the existing decision (already implicit elsewhere in this document) to keep WorkPortal's own alerting batched/digest-based and to treat Telegram as a notification bridge rather than build competing in-app chat.

### 6. Localization and language support — the most decision-relevant finding in this addendum

No vendor studied — Lark, Bitrix24, Microsoft, Google, Zoho, Notion, Trello, Miro, or Jira — was found to ship a native Uzbek-language interface in this pass. Bitrix24's self-hosted edition ships in a base language set (English and German confirmed) with other localizations, including presumably Russian, "provided and supported by partners" rather than the vendor itself — meaning Uzbek/CIS users get Russian-language *support* from regional resellers (1solution.uz, icorp.uz, bitrix24.uz) rather than a vendor-shipped, vendor-maintained interface [bitrix24.com/about/blogs/bitrix24-tips-and-updates, 1solution.uz/products/bitriks24]. Lark ships roughly 15 interface languages including Russian, but no CIS partner, reseller, or case study was found in this pass either — the earlier open question about Lark's CIS presence being a true gap versus a search-coverage artifact is now better supported as a true gap. Russian-language support elsewhere in this set is inconsistent: Bitrix24 and Yandex 360 are native CIS products with strong Russian support; Google Workspace, Microsoft 365, and Zoho all support Russian at the platform level; Trello, Notion, Miro, and Jira's Russian-language depth was not confirmed as first-party (vs. community-translated) in this pass.

- **[ADOPT]** — treat "ships fluent Uzbek Latin plus complete Russian as first-party, vendor-maintained languages, not a bolted-on translation layer" as a genuine, defensible competitive differentiator in stakeholder and procurement conversations, not merely an internal requirement to satisfy. No competitor studied in this entire dimension currently does this.

### 7. Security, compliance, and data-residency posture

Google Workspace holds a FedRAMP High Provisional Authorization to Operate and is certified against ISO 27017, 27018, and 27001, with AICPA SOC audits; Gemini inside core Workspace apps (Docs, Drive, Gmail, Meet, Sheets, Slides) has also achieved FedRAMP High authorization, and a "Google Workspace for Government" edition exists separately from the U.S. DoD-specific "GCC High" tier [cloud.google.com/security/compliance/fedramp, search-synthesized — the source page did not fully render on direct fetch]. Bitrix24's security claims (confirmed via a live fetch of bitrix24.com/security) are: TLS with a 256-bit key for every connection, browser-side authentication additionally hashed via JavaScript/RSA, cryptographically hashed passwords, optional two-factor auth (Bitrix24 OTP or Google Authenticator), a proactive web application firewall, daily automated backups, redundant clustering across two independent data centers, and IP-based access restriction for server access; cloud hosting is on AWS in either the US (Virginia) or EU (Frankfurt), or fully on-premise in the customer's own country/server. The AWS-inherited certifications Bitrix24 cites (HIPAA, GDPR, ISO 27001, SOC 1/2/3, PCI DSS Level 1) are AWS's *infrastructure* certifications, not independently confirmed Bitrix24 *application-level* audits — a distinction the vendor's own marketing blurs. Enterprise-tier Vibe+ specifically adds encryption at rest and Active Directory integration [bitrix24.com/prices, fetched 2026-09-05].

- **[ADOPT]** Bitrix24's "identical product, cloud OR fully on-premise" flexibility as a hosting model to architect toward, since it is the direct precedent this report's own Bitrix24 section already found being sold to Uzbek government buyers by local integrators.
- **[AVOID]** citing a hosting provider's infrastructure certifications as if they were our own application-level compliance posture — Bitrix24's own marketing does this, and we should not, when describing our security posture to the ministry; our own audit logging, `can()` permission checks, and tenant scoping (already project conventions) need to be the thing we can actually stand behind.

### 8. Admin/IT overhead to operate an on-prem system

Bitrix24's on-premise entry requirements are nominally light (PHP + MySQL 8.x, ≥1 GB RAM, ≥10 GB disk for a trivial install), but a realistic deployment sized for roughly 25 employees is recommended at 4 CPU cores, 12 GB RAM, and 256 GB SSD, and installation explicitly requires "a skilled operator" to configure SSL, firewalls, and the environment — ongoing PHP and platform updates need either a dedicated in-house specialist or a paid integrator/support contract [helpdesk.bitrix24.com/open/9162957, emcsoft.medium.com, atevisystems.com]. This matters directly for us: the target department has no dedicated IT staff, and the same Uzbek integrators this report already cites selling the on-prem "boxed" Bitrix24 edition to government structures (icorp.uz, 1solution.uz, team24.uz) are, by the nature of that product, also selling the ongoing support contract needed to actually run it — "on-prem" in this market is normally sold bundled with a managed-support relationship, not as a walk-away install.

- **[AVOID]** presenting on-prem/gov-cloud hosting to the ministry as a cost-saving move relative to a managed cloud option without also costing in either a sysadmin hire or an equivalent support contract — the regional precedent we are following already assumes one.
- **[ADAPT]** publish our own minimum server/ops footprint up front (mirroring Bitrix24's own published sizing guidance) so a hosting decision is made with real numbers rather than discovered later.

### 9. API, extensibility, and app marketplace

Bitrix24's Vibecode is a describe-what-you-want AI app builder that hosts and connects the resulting app to a customer's Bitrix24 instance; every paid Vibe+ tier (starting at Basic Vibe+, $89/mo) now bundles it along with "unlimited Market Apps & REST API," backed by a free, openly documented REST API [bitrix24.in/tools/vibecode, apidocs.bitrix24.com, bitrix24.com/apps/dev.php]. Lark's AnyCross is a visual, no-code/low-code integration builder connecting Lark's own products and third-party services via trigger→action flows — syncing new orders into a CRM, firing low-stock alerts, or pushing marketing data between systems — using a mix of standardized Lark connectors and third-party connectors [larksuite.com/en_us/product/anycross].

- **[AVOID]** building a general-purpose no-code app builder or a public app marketplace for v1 — this is precisely the kind of platform-scale ambition that turns a 23-person internal tool into an entirely different (and much larger) product than what was scoped.
- **[ADAPT]** keep a narrow, well-documented internal REST API and webhook layer (in the spirit of Bitrix24's own developer docs) so that future integrations we already anticipate — Telegram, OneID, e-imzo — are not blocked, without exposing that API as a customer-facing "build your own app" feature.

### 10. Cost at our actual scale (23 users)

| Suite | Tier that fits 23 users | Monthly cost for the whole department | Note |
|---|---|---|---|
| Bitrix24 Vibe+ | Standard Vibe+ (up to 50 users) | **$199/mo list, $120/mo if billed annually** | Flat-rate — 23 users cost the same as 50; cheapest whole-department number in this set [bitrix24.com/prices] |
| Lark | Pro, per-seat | $12 × 23 = **$276/mo** ($3,312/yr, annual billing) | Per-seat, not flat-rate [larksuite.com/en_us/pricing] |
| Google Workspace | Standard (needed for Docs/Meet, not just Gmail) | €12.24 × 23 ≈ **€281.52/mo** | Starter (€6.12 × 23 ≈ €140.76/mo) is Gmail-only and insufficient for our use case [workspace.google.com/pricing] |
| Yandex 360 | Advanced | ₽1,399 × 23 ≈ **₽32,177/mo** | Not a compliant option for Uzbekistan (Russian jurisdiction) — included only as a bundle-shape reference [360.yandex.ru/business] |
| Zoho One | All-employee flat rate | **Not independently re-verified this pass** (WebSearch budget exhausted before a pricing-page fetch) | All-employee licensing means the number is driven by total headcount (23), not just active users — the same cautionary licensing model this report already flags |
| Microsoft 365 | Enterprise-licensed (E3/E5) | **Not independently re-verified this pass** | Requires a specific SKU quote; no flat consumer number exists |

- **[ADAPT]** use the Bitrix24 Vibe+ Standard figure (**$199/month for the entire department**, or $120/month annual) as the anchor number in any "why not just buy an existing suite" budget conversation — it is the single lowest total-cost data point across every directly comparable vendor in this research set, and it is a flat-rate, not per-seat, so it does not grow if headcount grows toward the ministry-wide rollout this project anticipates.

### The steal list from Trello, Miro, Notion and Jira

Four products this report's brief named explicitly as sources to "take what we need from." Below: 6–10 specific, exact-UX features worth stealing per product, and 5 things per product to explicitly refuse, each backed by cited user complaints rather than assumption.

#### Trello

**Take:**
1. **Checklist items with their own due date and assignee** — a card shows a live fraction badge (e.g., "3/5") on its face without opening it, so board-level scanning tells you progress at a glance.
2. **Card covers** — a color strip or an attachment's image becomes the card's visual identifier on the board face, making a Kanban board scannable without reading every title.
3. **Butler's trigger → action(s) rule structure** — one rule fires one or more chained actions (e.g., "when a card enters Done, check all checklist items, then archive it after 3 days"); triggers include card moved, label added, checklist completed, or due date reached [trello.com/butler-automation].
4. **Card buttons and board buttons** — a one-click custom button on a card's back or the board header fires a whole sequence instantly, with no menu-diving.
5. **Due-date text parsing** — typing (or emailing) a date-like phrase into a card's title auto-sets its due date.
6. **Automation "tip" suggestions** — the product watches for a user's repeated manual sequence and proactively offers to turn it into a one-click rule, rather than requiring the user to discover automation unprompted.
7. **Power-Ups as strictly opt-in extension points** — a board only gains a capability (voting, card aging, custom fields) when someone deliberately enables it, keeping the default board minimal.

**Refuse:**
1. Boards becoming "overcrowded, unreadable screens" once hundreds of cards accumulate, with no native Gantt or dependency view — a repeatedly cited ceiling once a project outgrows simple Kanban [reviews synthesis, capterra.com/p/211559/Trello/reviews].
2. A hard free-tier wall (10 boards/workspace, 10 MB uploads) that surprises teams mid-adoption rather than degrading gracefully.
3. Power-Ups gating genuinely useful functionality behind extra paid tiers — "most useful power-ups require a paid plan," making the free product feel deliberately hollowed out.
4. Notification handling described as "excessive, poorly managed, delayed, or lacking customization," causing missed updates.
5. A permission model reported as "rigid or insufficiently granular" on free plans, with public-board/broad-edit-rights accidental exposure risk — a direct concern for a government tenant handling internal work.

#### Miro

**Take:**
1. **Voting sessions** — any editor starts a session, sets votes-per-person (up to 99) and a duration (minutes/hours/days), can restrict to one vote per object, and results stay anonymous until the session ends, avoiding groupthink/anchoring [help.miro.com/hc/en-us/articles/360017572274-Voting].
2. **A visible countdown timer** attached to a workshop step — a hard stop nobody has to police verbally.
3. **Frames** — draggable containers that group canvas content into "sections/slides," doubling as both a presentation mechanism and a navigation/table-of-contents structure on an otherwise infinite canvas.
4. **Prebuilt ritual templates** (retrospectives, ice-breakers, design-thinking canvases) available on every plan including free — a zero-cost path to a good starting structure instead of a blank canvas.
5. **Live multi-cursor presence** during synchronous sessions, so collaborators see exactly where teammates are working in real time.
6. **Voting as a free, plan-independent capability** — proof a core facilitation primitive doesn't need to be an upsell lever.

**Refuse:**
1. Performance degrading on large boards heavy with images/PDFs — a recurring complaint across G2 and Capterra reviews [capterra.com/p/128955/Miro/reviews].
2. Boards becoming genuinely hard to navigate once a whole team adds content simultaneously, with no built-in decluttering or archiving mechanism.
3. Restrictive data export — hard to bulk-export, size limits apply, and there's no way to track board size while building, a real lock-in risk for a government tenant that must retain the ability to leave.
4. Billing surprises — "almost every one-star review is about billing": seats or members added without approval, and view-only links silently triggering paid annual licenses.
5. Advanced capabilities gated behind higher tiers, each with its own learning curve — directly opposed to a zero-training mandate.

#### Notion

**Take:**
1. **Synced blocks** — select content, "Turn into → Synced block," then paste the copy anywhere; editing any instance updates every instance, the UI marks the "ORIGINAL," and shows "Editing in ↙ # other pages" so nobody is confused which copy is authoritative [notion.com/help/synced-blocks].
2. **Database relations plus rollups** — one database (Projects) links to another (Tasks), which links to another (People); a rollup field aggregates across that chain (total hours per project, completion rate per person) without re-entering data.
3. **Multiple views over one database** (table/board/calendar/gallery/timeline) sharing the same underlying rows — the same "one dataset, many views" principle this report already adopts from Lark Base, now confirmed as an industry-standard pattern rather than a Lark-only idea.
4. **Reusable onboarding-checklist templates** duplicated per new hire, with shared policy text kept in a synced block so an update to company policy propagates into every already-created onboarding page automatically.
5. **A template gallery as the primary "how do I start" affordance** — a first-time user picks a template rather than confronting a blank page, directly relevant to a zero-training requirement.
6. **Toggle/collapsible sections** for progressive disclosure — advanced or historical content stays hidden by default and expands on demand.

**Refuse:**
1. Performance collapse at scale — databases over roughly 5,000 records show 3–5 second page loads and sluggish filtering; 10,000+ record databases are described by enterprise users as "impractical as a primary database" [reviews synthesis]. Not urgent for a 23-person department's own tables, but a hard limit to keep in mind if this scales to a ministry-wide, multi-tenant rollout.
2. Reliability gaps — multiple reported outages in late 2025 affecting database views, search, and page duplication, plus reports of crashes losing unsaved work.
3. New features shipping "with rough edges" (Notion Mail, offline mode, and forms specifically named) — a caution against shipping a half-finished module just to claim feature parity with a competitor.
4. Limited offline functionality — a real risk in any office context with unreliable connectivity, relevant to a ministry network.
5. An overwhelming first-run experience driven by unconstrained customization — flexibility power users love reads as "what do I even do here" to a first-time civil servant, the opposite of this project's zero-training mandate [blog.herdr.io/work-management/title-top-5-complaints-about-notion-in-2025-what-users-are-saying].

#### Jira

**Take:**
1. **A formal, named issue hierarchy** — subtask at level -1, standard issue at level 0, epic at level 1, with Premium plans allowing custom levels above epic (Initiative, Theme) — a strict parent-child structure rather than an ad hoc tagging convention [foundationforjira.com/guides/jira-hierarchy-beyond-epic].
2. **Structured, saveable filters** (JQL-style, e.g. `parent = DEV-100`) that a director can bookmark as a personal view instead of rebuilding a filter from scratch every time.
3. **Field-propagation automation** — set a label on an Epic and auto-copy it down to every child issue (or roll a child field up to its parent) — directly reusable for our own escalation/rollup logic.
4. **A roadmap/timeline view deliberately separated from the execution view** — "the roadmap shows what and why; the working plan shows how you'll execute it" — two different audiences, two different surfaces, not one overloaded screen [atlassian.com/software/jira/features/roadmaps].
5. **Published, read-only roadmap snapshots** for external stakeholders — share status with ministry leadership without granting them edit or board access.
6. **Configurable custom hierarchy levels with sane out-of-the-box defaults** — power available to whoever needs it, without forcing every team to configure it before first use.

**Refuse:**
1. Steep configuration complexity — "steep configuration complexity for small teams," with workflows, request types, and automation rules requiring near-admin-level expertise to set up [clearfeed.ai/blogs/jira-service-management-review-analysis-ratings].
2. The lowest ease-of-setup score among mainstream PM tools in reviewer benchmarks (7.5/10, versus Trello's 9.0 and Monday's 9.2) — a quantified onboarding-tax data point.
3. Non-technical teams (marketing, HR, ops) reporting Jira as "overwhelming" and "painful" to manage their own work in, even when they can view and comment on others' tickets — precisely the profile of most WorkPortal users, who are civil servants, not engineers.
4. A cluttered interface making it "difficult for new users to find what they need," with search and filtering "not always intuitive" at volume.
5. Hidden or unexpected automation costs and poor integration with non-Atlassian tools — a caution against bolting a metered, opaque automation engine onto our own product.
