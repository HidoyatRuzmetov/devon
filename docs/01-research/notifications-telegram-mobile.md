# Notifications, Telegram integration, mobile and offline

**TL;DR**
1. Build one internal **event bus → preferences → channel fan-out → digest** notification model from day one; bolting digests/quiet-hours on later always fails (see Linear/GitHub evolution).
2. **Telegram is not optional infrastructure for us, it is the primary mobile client** — build a bot + Mini App instead of a native app for phase 1–2; it gets us push, auth, and a UI civil servants already trust, for a fraction of the cost of iOS/Android.
3. Self-host a small open-source notification layer (Novu is the strongest OSS candidate) rather than buying Knock/Courier — data-localization law makes a foreign SaaS notification vendor a legal risk, not just a cost line.
4. Never put personal data, documents, or approval details with sensitive content inside Telegram messages — treat Telegram as a **pointer/alert channel** ("Task #482 needs your review — tap to open"), with the substance living in-app behind auth.
5. For SMS, Eskiz.uz is the pragmatic Uzbek default (cheap, local, government-familiar); for calendar, skip building a calendar engine — speak CalDAV/ICS to Outlook and Google rather than reinventing scheduling.

---

## 1. Notification design principles

**Batching and digests.** The dominant failure mode of every internal tool is "one Slack-style ping per event" until users mute the whole app. Linear's model is instructive: notifications always land in a persistent **Inbox** first (never only a fire-and-forget push), and only urgent/blocking items (status changes to blocked, urgent-priority flips, @mentions) go out in real time on desktop/mobile/Slack; everything else is bundled into **digest emails whose timing depends on urgency** rather than a fixed schedule — a low-priority comment might wait hours, a blocking dependency change goes out sooner. Users cannot pick apart individual notification types inside a group, only turn a whole category on/off — a deliberate simplicity trade-off ([Linear docs](https://linear.app/docs/notifications)). Linear also caps the inbox at roughly 2,000 open notifications with auto-archival, forcing triage rather than infinite scroll.

GitHub's model is the second reference pattern: three subscription tiers per object — **Watching** (everything), **Participating and @mentions** (default, low-noise), and **Custom** (pick specific event types: issues, PRs, releases, security alerts, discussions) — plus a triage-first inbox with `is:done`, `is:saved`, "reason" labels explaining *why* you were notified, and per-repo email routing ([GitHub docs](https://docs.github.com/en/account-and-profile/managing-subscriptions-and-notifications-on-github/setting-up-notifications/configuring-notifications)). The "reason" label is the single most copyable idea: every notification should say *why you're seeing this* (assigned / mentioned / subscribed / escalated / weekly-digest), not just what happened.

**Per-object subscriptions.** Both Linear and GitHub subscribe you automatically when you create, get assigned, or are @mentioned on an object, with one-key manual subscribe/unsubscribe (Linear: `Shift+S` / `Cmd+Shift+S`). This is the right default for our Projects/Tasks register: project leads and assignees are auto-subscribed; anyone else can subscribe with one click, never a settings-page hunt.

**Quiet hours / do-not-disturb.** Novu's whole value proposition is "respect user time with preference centers and send windows" and "quiet hours" baked into the workflow engine, not the app ([novu.co](https://novu.co/)); Knock frames the identical idea as "preference centers and send windows" ([knock.app](https://knock.app/)). The pattern that matters for a government client: **quiet hours must be a server-side scheduling decision, not a client toggle that only mutes the phone** — a digest queued at 23:40 should be *held and delivered* at 08:00 the next working day, not silently dropped, and urgent/blocking items should have an explicit "override quiet hours" flag that is rare and visible (used for true emergencies, escalations from the Friday-ritual auto-escalation queue, not for a boss who wants an evening answer).

**Inbox/triage UX, concretely.** From Linear + GitHub, the reusable UI pattern is: a single **Inbox** view (not per-module notification lists), each row showing actor + verb + object + reason + timestamp, grouped by object thread, with keyboard-first triage (mark done / snooze / open), and a hard distinction between the *persistent record* (inbox, always there) and the *interruptive channel* (push/Telegram/email, only for what's urgent). Both products treat "notification volume is a product bug," not a settings problem — the fix is smarter default routing, not more toggles.

## 2. Notification infrastructure: build, self-host, or buy

| Option | Model | Channels | Self-host? | Compliance posture | Fit for us |
|---|---|---|---|---|---|
| **Novu** | Open-source notification infrastructure, "one workflow, every channel" engine, digesting/rate-limiting, preference center | In-app, email, SMS, push, WhatsApp/Slack/Teams/**Telegram** built in | Yes — OSS, self-hosted, or managed cloud ([novu.co](https://novu.co/)) | SOC2 Type II, ISO 27001, GDPR/HIPAA claimed for the managed cloud; self-hosted keeps data in-country | **Best fit.** Telegram is a first-class channel already; self-hostable satisfies data localization; `npx novu connect` quick start |
| **Knock** | Managed customer-engagement/notification platform, AI-assisted workflow builder, dynamic segmentation | Email, SMS, push, chat, in-app | No (SaaS only) ([knock.app](https://knock.app/)) | SOC2/HIPAA/GDPR/CCPA, 99.99% uptime SLA | Strong product, but SaaS-only is a hard blocker for citizen/employee personal data under Uzbek localization law |
| **Courier** | Managed notification API, similar positioning to Knock | Email, SMS, push, chat | No (SaaS) | Vendor claims compliance certifications | Same localization blocker as Knock |
| **ntfy** | Minimal open-source HTTP pub/sub push (topics, no accounts) | Push (Android/iOS/web/desktop) only | Yes, trivially (single Go binary) ([ntfy.sh](https://ntfy.sh/)) | No PII by design — topics are the whole security model | Good for *internal ops alerts* (deploy done, cron failed), too primitive for a real preference/digest model |
| **GOV.UK Notify** (reference architecture, not usable by us directly) | UK government's own notification-as-a-service for all departments | Email, SMS, letter | Government-run, not for us | Purpose-built gov service | Not adoptable, but the *model* is: one shared internal notification service used by 1,754 organisations / 12,670 services, pay-as-you-go, no technical knowledge needed to build a template ([gov.uk](https://www.notifications.service.gov.uk/)) — proof that "one small internal notify-service used department-wide" scales inside a government context |
| **Roll our own** | Thin internal service: Postgres outbox table, a worker, channel adapters | Whatever we wire up | Yes | Full control | Reasonable at our current scale (~23 people, 4-tenant ambition) if Novu self-hosting turns out heavier than needed |

**Recommendation:** self-host Novu (or a Novu-lite subset if the OSS server is too heavy for our infra) as the internal notification service, because it already treats Telegram as a peer channel to email/SMS/push and ships the preference-center + digesting/quiet-hours machinery we'd otherwise build ourselves. GOV.UK Notify is the aspirational end-state pattern for us: eventually *we* could be the department that runs the shared notify-service for other ministries once multi-tenant.

## 3. Email deliverability inside government networks

We could not verify Uzbek-specific mail relay policy in this pass (open question, flagged below), but the general failure pattern that applies to almost every gov network is well established from GOV.UK's own experience: government mail servers are typically behind strict corporate/ministry mail gateways with aggressive spam/phishing filtering, SPF/DKIM/DMARC enforcement, and often outright blocklisting of new sending domains until manually allow-listed by each ministry's IT. GOV.UK Notify's own model — a shared, centrally-trusted sending domain and IP reputation used by thousands of services — exists specifically to avoid every department fighting its own deliverability battle. **Implication:** we should not assume `@medt.uz`-style internal accounts will reliably receive mail from a new internal notification server without (a) proper SPF/DKIM/DMARC records on our sending domain, (b) a warm-up period, and (c) getting our server IP allow-listed by ministry IT — and even then, email should be treated as the *slowest, least reliable* channel (a digest/audit-trail channel), never the channel an urgent approval depends on.

## 4. Telegram as a channel

**Bot API — approve/decline workflows.** Telegram bots support inline (callback) keyboards attached to a message — buttons that trigger a bot callback rather than posting a new message, which is exactly the "Approve / Decline" pattern we need for the weekly-comment / escalation ritual. Bots can also send **private responses inside group chats, visible only to one user and the bot** — useful for a manager approving a leave request inside a shared channel without exposing it to the whole team ([core.telegram.org/bots/features](https://core.telegram.org/bots/features)). Commands can be scoped per user/group so a Head of Sub-department sees different `/` commands than a Specialist.

**Deep links.** `t.me/<bot>?start=<payload>` carries up to 64 chars of opaque payload (`A-Z a-z 0-9 _ -`), enough to encode `task_482` or a signed short token — this is how "tap a Telegram notification → land directly on the right record" works without a full auth flow every time.

**Login Widget / OIDC.** Telegram now offers both the classic JS login widget and a full **OpenID Connect** flow: users authorize in a popup, we receive a signed JWT (RS256/ES256/EdDSA) from `https://oauth.telegram.org`, verified against Telegram's JWKS, containing user id, name, username, photo, and — with explicit consent — **verified phone number**. This is a legitimate enterprise-SSO-adjacent mechanism: it eliminates SMS OTP costs for verifying a phone number and integrates with Keycloak/Auth0/Authentik-style identity brokers ([core.telegram.org/widgets/login](https://core.telegram.org/widgets/login)). For us this means: Telegram login can be *one* of the auth factors (e.g., "link your Telegram" as a second identity, not the sole identity provider for a government system — the primary directory/auth should stay our own or a state SSO).

**Telegram Mini Apps (TMA).** Mini Apps are full JS web apps launched inside Telegram's chrome, authenticated via `initData` — a signed query string (HMAC-SHA-256 over the bot token) that **must be validated server-side and never trusted client-side** ([core.telegram.org/bots/webapps](https://core.telegram.org/bots/webapps)). Bot API 8.0+ added full-screen/landscape mode, home-screen shortcuts, geolocation, device motion, biometric auth, and Stars-based subscriptions — i.e., Mini Apps now cover most of what a "lightweight native app" needs except deep OS integration. Storage inside a Mini App: **CloudStorage** (1,024 items × 4,096 **characters** per value — corrected from an earlier "bytes" imprecision, see Editor's verification notes below — synced across the user's devices via Telegram's servers), **DeviceStorage** (5MB, local only), and **SecureStorage** (10 items, hardware-backed keychain/keystore) — a real, if small, offline/local-state toolkit. Known limits: Mini Apps opened from inline mode or plain links cannot proactively push messages without the user first interacting with the bot; clipboard/file access require explicit user gesture. As of this pass (2026-09-05), Bot API has advanced to **10.3** (Aug 24 2026) and Telegram hardened Mini App security on 2026-07-20 by disallowing Mini App bridge methods from origins other than the Mini App's own registered domain — relevant if we ever proxy the Mini App through a CDN or multiple subdomains.

## 5. Security considerations — what should never go through Telegram

Telegram's own privacy documentation is explicit about the trust boundary we must respect: regular ("cloud") chats — which is what bots and Mini Apps use — are encrypted in transit and at rest but **Telegram retains server-side copies for sync**, with encryption keys distributed across data centers in multiple jurisdictions (for Uzbekistan-registered accounts, cloud chat infrastructure has historically routed through Netherlands-based data centers) ([telegram.org/privacy](https://telegram.org/privacy)). Only **Secret Chats** are end-to-end encrypted and leave no server copy — and Secret Chats are a manual, one-device-pair feature that bots cannot use. Telegram also retains IP address and phone number for up to 12 months and can disclose them on a valid legal request (logged in public transparency reports).

**Consequence for a government system with a data-localization law:** Telegram cloud chats/bots are, legally, data leaving Uzbekistan the moment a message is sent. **Rule: Telegram messages must never contain** — citizen personal data, employee HR/restricted-tier fields (DOB, home address, salary, health/family data), full document contents, or anything covered by the localization law. What they *can* safely contain: an opaque notification ("Project X status changed"), a deep link back into the authenticated in-app record, and non-sensitive coordination text (event RSVP, meeting reminders, "your weekly Friday update is due"). This "Telegram = doorbell, not filing cabinet" rule should be a written policy, not just an engineering convention, because civil servants *will* try to approve/comment/paste content directly into the bot chat once it's convenient.

## 6. Alternative national/regional messengers

We found no evidence of a state-mandated or widely adopted Uzbek national messenger comparable to Russia's VK/Max or China's WeChat; Telegram's dominance in Uzbekistan (widely cited at >80% of the messaging-app market, informally, government ministries and utilities routinely run public Telegram channels/bots for citizen services) makes it the only channel worth building official integration for. WhatsApp and Signal have essentially no institutional footprint in Uzbek government communication. This should be revisited if the government introduces its own sovereign messenger mandate (open question below).

## 7. SMS gateways in Uzbekistan

| Provider | What we confirmed | Notes |
|---|---|---|
| **Eskiz.uz** | SMS in Uzbekistan and abroad, pricing "from 95 UZS" per message, dedicated `/sms` product page, active support via phone and a Telegram support bot (`@eskizhelpbot`) ([eskiz.uz/en](https://eskiz.uz/en)) | Widely used by Uzbek startups/SaaS for OTP and transactional SMS; requires sender-name (alfa-name) registration in practice (industry-standard for Uzbek telecom regulation) though we couldn't pull the exact registration doc in this pass |
| **Playmobile** | SMS operator since 2004, "SMS-xabar" mass messaging via API + dashboard, IVR ("Ovozli xabar") mass calling, USSD, CallMe24 call-center product; markets itself to banks, payment systems, e-commerce ([playmobile.uz](https://playmobile.uz/)) | Longer-established, more enterprise/bank-oriented positioning than Eskiz; no confirmed Telegram/Viber channel bundling |

**Recommendation:** SMS should be the **fallback channel of last resort** (OTP, and alerts for the rare employee without Telegram), not a primary channel — it costs real money per message, has no rich formatting, and Telegram already reaches the same phones for free. Use Eskiz for OTP/critical fallback given its lower friction and startup-familiar API; keep Playmobile as a second option given its bank-grade positioning if we ever need guaranteed delivery SLAs.

## 8. Push via web push / PWA, and the iOS problem

Web Push (the `PushManager`/service-worker API) is "Baseline: widely available" on modern browsers, but **iOS Safari support is real yet conditional**: it works only for a PWA the user has explicitly **added to the home screen** (not just visited in Safari), requires a reasonably recent iOS/iPadOS version, and still trails native APNs push in reliability and background-wake guarantees. Practically, for a government workforce on a mix of aging Android devices and iPhones, this means: **web push is a nice-to-have supplementary channel, never the only channel** — Telegram push (which works identically and reliably on both platforms, no add-to-home-screen ritual required) should carry the load in phase 1–2, with browser web push as a phase-2/3 enhancement for desktop-heavy roles (director, analysts at their desks).

## 9. Native app vs PWA vs Capacitor/Expo for a phase-2 mobile app

| Approach | Pros | Cons | Verdict for us |
|---|---|---|---|
| **Telegram Mini App** | Zero install, instant reach (everyone already has Telegram), built-in auth, push comes free via Telegram itself, works on low-end Android | Limited to Telegram's UI shell and API surface, storage caps (CloudStorage 4KB/item, DeviceStorage 5MB), can't do deep OS integration (background geofencing, rich offline DB) | **Primary mobile client for phase 1–2.** Matches the "zero-training, everyone already has it" mandate directly |
| **PWA (browser, installable)** | One codebase with desktop web, full service-worker offline caching, no app-store review | iOS push is conditional on home-screen install (adoption friction), less discoverable than a Telegram bot in a Telegram-first country | Good as the *desktop* experience; secondary on mobile |
| **Capacitor (Ionic)** | Wraps existing web app in a real native shell, full plugin access (camera, biometrics, filesystem, background tasks), one web codebase reused for native | Still ships an app-store app (review cycles, MDM distribution for gov devices), heavier than a Mini App for the same audience | Phase-3 candidate *only if* we need capabilities Mini Apps can't do (offline-first field data collection with large local DBs, native biometric unlock, background sync) |
| **React Native / Expo** | Mature ecosystem, near-native performance and UX, OTA updates via Expo | Two platform builds to maintain, steeper team investment, no advantage over Capacitor for a mostly-CRUD ops tool | Only worth it if we're building something app-store-grade and long-lived beyond this department |

**Recommendation:** do not build a native or Capacitor app in phase 1 or 2. The Telegram Mini App *is* the mobile app for a Telegram-first country and a zero-training mandate — it removes the app-store distribution problem entirely (no MDM push to government-issued phones, no APK sideloading policy questions). Revisit Capacitor only if phase 3 needs true offline-first field work (e.g., an inspector filling out forms with no connectivity for hours) that CloudStorage/DeviceStorage can't support.

## 10. Offline patterns for field/weak-network use

Given Mini App storage primitives (CloudStorage synced across devices, DeviceStorage local-only, SecureStorage for secrets) and the CalDAV "truth is always on the server" principle below, the practical offline pattern for us is:
- **Read-heavy offline cache**: last-synced snapshot of "my tasks," "my projects," directory entries — cached in DeviceStorage/localStorage, refreshed on reconnect, shown with a visible "last synced Xm ago" badge (never silently stale).
- **Write queue, not live edit**: offline actions (mark task done, add a comment) get queued locally with an optimistic UI state and a sync icon, flushed on reconnect; conflicts resolved server-wins with a visible diff, never silent overwrite (this mirrors CalDAV's server-truth model).
- **No offline approvals**: anything that changes an official record's state in a legally/organizationally meaningful way (approvals, sign-offs) should require a live connection — offline approval queues are a classic audit-trail nightmare in government settings.

## 11. Calendar integration (CalDAV, Google/Outlook)

CalDAV (WebDAV + iCalendar) is the right protocol to *speak*, not to reimplement: events/tasks are iCalendar objects, changes are tracked via `ctag`/`etag` so clients only pull deltas, and the core design principle is **"the truth is always on the server"** — no manual "sync now," no merge conflicts by design ([sabre.io](https://sabre.io/dav/building-a-caldav-client/)). For us this means: our Projects/Activities deadlines and meetings should be exposed as a CalDAV/ICS feed (or via Google Calendar API / Microsoft Graph for Outlook shops) so a civil servant sees "EGDI report due" in whatever calendar app they already use, rather than forcing them into a bespoke in-app calendar. Building a full CalDAV *server* is unnecessary; a read-only ICS feed per user/project, plus optional two-way sync via Google/Microsoft Graph APIs for leave and meeting requests, covers the phase-2 "connected workflows" ambition in the roadmap.

## 12. Do-not-disturb cultural norms in government

We could not find Uzbekistan-specific survey data on after-hours messaging norms in this pass (open question), but the product-design implication is clear regardless of the specific culture: in hierarchical organizations, "quiet hours" is not just a UX nicety, it's a **power-dynamics problem** — a junior specialist cannot realistically mute their director. The correct design is therefore not a personal opt-out toggle alone but a **system-level default**: non-urgent notifications (digests, FYI comments, activity RSVProminders) are queued and never sent 20:00–08:00 or on weekends *by default for everyone*, including from directors to staff, with a narrow, visible "mark as urgent" override that bypasses quiet hours — used rarely enough that it retains meaning. This reframes "do not disturb" from an individual courtesy into an organizational policy the tool enforces, which is more defensible and more likely to actually hold in a hierarchical culture than relying on managers self-policing.

## 13. Recommended notification model

```
EVENT (domain fact: task assigned, status changed, comment posted,
       deadline in 3 days, RSVP opened, escalation triggered, mentioned)
   │
   ▼
PREFERENCES (per user × per event-type × per object-subscription:
   channel = {inbox-only, inbox+push, inbox+push+telegram, digest-only}
   urgency override = {none, urgent-bypasses-quiet-hours}
   quiet hours = org default 20:00–08:00 + weekends, personally narrowable
   not wideable — no one can silence an "urgent" org-wide item)
   │
   ▼
ROUTING (reason-tagged: "assigned" / "mentioned" / "subscribed" /
   "escalated" / "weekly-digest"; always lands in in-app Inbox first)
   │
   ├── real-time: Telegram push (primary), web push (desktop, secondary)
   ├── digest: batched email, timing scaled to urgency (Linear-style)
   └── fallback: SMS via Eskiz, urgent-only, no Telegram account on file
```

Design constraints baked into this model: (1) the Inbox is the permanent record — channels are just how you're alerted to check it; (2) every notification carries a machine-readable "reason"; (3) digests are computed server-side against per-user quiet hours, not client-muted; (4) Telegram messages carry pointers, never sensitive payloads; (5) auto-subscription on assignment/mention/creation, one-tap subscribe/unsubscribe everywhere else.

## 14. Telegram integration plan — concrete

**Bot commands (BotFather-registered):**
- `/start <deep-link-payload>` — silent login/link flow, lands the user on the matching in-app record if payload present
- `/mytasks` — inline list of open tasks assigned to me, each with an inline "Mark done" button
- `/today` — today's deadlines + meetings (from the CalDAV/ICS feed) + any Friday-ritual updates due
- `/digest` — on-demand pull of the current pending digest (for someone who wants to check now instead of waiting for the scheduled send)
- `/settings` — opens quiet-hours / channel preference Mini App screen
- `/help` — plain-language command list in Uzbek/Russian/English (language auto-detected from Telegram client locale, overridable)
- Inline **Approve / Decline** buttons on any message requiring a decision (leave request, project status escalation sign-off), using callback queries with a private (per-user) response so decisions in a group chat aren't visible to everyone
- RSVP buttons (Yes / No / Maybe) directly on Activities announcements, capacity shown live and updated in the message itself when it changes

**Mini App screens (launched via bot menu button or `/webapp` command):**
1. **Home** — today's tasks, deadlines, and department KPI strip (mirrors the reference site's Overview, mobile-sized)
2. **My tasks / Inbox** — the triage list (reason-tagged, swipe-to-done, tap to open full record which deep-links to the web app if more detail is needed)
3. **Directory** — People search, showing only public-tier fields (name, position, unit, work contact) per the privacy-tiers principle; restricted HR fields never rendered here
4. **Activities** — upcoming events with RSVP, capacity bar, and the "attendance is optional" note carried over from the reference design
5. **Settings** — channel preferences, quiet hours, language (UZ/RU/EN)

**Auth flow:** Mini App opens → `initData` sent to our backend → HMAC-SHA-256 validated server-side against bot token → matched to internal user record via a pre-linked Telegram user ID (linked once via the Login Widget/OIDC flow during onboarding) → session issued. No password is ever entered inside Telegram.

## What this means for us

1. **[ADOPT]** Build the Inbox-first, reason-tagged notification model (Linear/GitHub pattern) as the core data model before writing any channel adapter — retrofitting digests later is expensive and every team that skipped this now regrets it.
2. **[ADOPT]** Treat Telegram as the primary mobile client via a Bot + Mini App, not a "nice extra channel" — it is the only mobile investment that matches "zero training" and "everyone already has it" simultaneously in Uzbekistan.
3. **[ADOPT]** Self-host Novu (or an equivalently small OSS notification engine) rather than subscribing to Knock/Courier — data-localization law makes foreign SaaS handling personal-data-linked notifications a compliance risk, not just a preference.
4. **[AVOID]** Never send personal data, HR-restricted fields, or document content through Telegram messages — enforce "Telegram = pointer, not payload" as written policy, with server-side redaction/allow-listing of what a bot may output, not just developer discipline.
5. **[ADOPT]** Enforce quiet hours as an org-wide server-side default (20:00–08:00 + weekends), not a personal toggle — this is the only version of "do not disturb" that survives a hierarchical culture where juniors won't self-mute their boss.
6. **[ADAPT]** Use the Telegram Login Widget/OIDC flow as a *secondary* identity link (verify phone, link account) but keep our own or a state-backed system as the primary authority for who's an employee — don't make Telegram the sole identity provider for a government system.
7. **[AVOID]** Don't build a native iOS/Android app or a Capacitor/Expo app in phase 1–2 — it duplicates what the Mini App already gives us at a fraction of the distribution cost (no MDM, no app-store review, no APK sideload policy fights on gov-issued phones).
8. **[ADOPT]** Speak CalDAV/ICS + Google/Microsoft Graph for calendar rather than building a bespoke calendar engine — "the truth is always on the server" plus delta-sync via ctag/etag is a solved, well-understood protocol we shouldn't reinvent.
9. **[ADAPT]** Use Eskiz.uz for SMS but only as last-resort fallback (OTP, and alerts to the rare employee without Telegram) — it's real money per message and Telegram already reaches the same device for free.
10. **[AVOID]** Don't rely on web push as a primary mobile channel — iOS Safari push requires the PWA to be added to the home screen first, an adoption-friction step most users will never take; Telegram push needs no such ritual.
11. **[ADOPT]** Give every notification a visible machine-readable "reason" (assigned/mentioned/subscribed/escalated/digest) exactly like GitHub — it's cheap to build and is the single biggest driver of user trust in *why* they're being pinged.
12. **[ADAPT]** Borrow GOV.UK Notify's "one shared internal notify-service used department-wide, no technical knowledge to build a template" philosophy for our multi-tenant ambition — design the notification templates/preferences as a service other ministries can plug into later, not as bespoke code per feature.
13. **[AVOID]** Don't let the auto-escalation queue (Friday-ritual → management review) bypass quiet hours by default — only genuinely urgent/blocking items should carry the "override quiet hours" flag, or the escalation feature itself becomes the thing that trains people to distrust the tool's notifications.
14. **[ADAPT]** Plan email as the slowest, most failure-prone channel inside ministry networks (SPF/DKIM/DMARC + IP allow-listing required, mirroring the reason GOV.UK Notify centralizes sending reputation) — never gate an urgent workflow step on email delivery.
15. **[ADOPT]** Design offline as "read-cache + write-queue with visible sync state," never "offline approvals" — approvals/sign-offs should require a live connection to preserve a clean audit trail, a hard requirement in any government process.

## Open questions

- Exact Uzbek data-localization statute text and its specific application to notification metadata (message logs, delivery receipts) versus full personal-data payloads — we could not pull the primary legal text (`lex.uz`) in this pass; needs direct legal review, ideally with the ministry's own legal counsel.
- Whether the Ministry of Digital Technologies' network policy will allow outbound calls to Telegram's Bot API servers and to a self-hosted notification service's SMTP/SMS relays without special firewall exceptions.
- Whether there is (or will be) a state mandate around use of foreign messaging platforms (Telegram) for official government communication — no evidence found of a current restriction, but government messaging-app policy can change quickly and should be reconfirmed before deep investment.
- Actual mail deliverability behavior inside `*.gov.uz`/ministry mail gateways — untested; requires a pilot send-and-measure exercise, not assumption.
- Whether Eskiz.uz or Playmobile currently serves other Uzbek government agencies (for procurement/precedent purposes) — not confirmed in this pass.
- Cultural baseline data on after-hours messaging expectations in Uzbek government hierarchies — recommend a short internal survey of the ~23 staff rather than relying on general assumptions before finalizing the quiet-hours default window.
- Novu self-hosting resource footprint (DB, queue, worker processes) versus our actual infra budget — needs a technical spike before committing to it over a lighter roll-your-own service.
- Whether Telegram Mini App CloudStorage (4KB/item, 1,024 items) is sufficient for our expected per-user cached task/notification volume, or whether we need IndexedDB inside a webview-hosted Mini App instead.

## Sources

- [Telegram Bot API — Bots FAQ / features](https://core.telegram.org/bots/features)
- [Telegram Mini Apps (WebApps) documentation](https://core.telegram.org/bots/webapps)
- [Telegram Login Widget](https://core.telegram.org/widgets/login)
- [Telegram Privacy Policy](https://telegram.org/privacy)
- [Novu — notification infrastructure](https://novu.co/)
- [Knock — customer engagement infrastructure](https://knock.app/)
- [Linear — Notifications documentation](https://linear.app/docs/notifications)
- [GitHub — Configuring notifications](https://docs.github.com/en/account-and-profile/managing-subscriptions-and-notifications-on-github/setting-up-notifications/configuring-notifications)
- [GOV.UK Notify](https://www.notifications.service.gov.uk/)
- [Eskiz.uz — SMS gateway](https://eskiz.uz/en)
- [Playmobile.uz — SMS/IVR/USSD gateway](https://playmobile.uz/)
- [ntfy — simple pub-sub push notifications](https://ntfy.sh/)
- [MDN — Push API](https://developer.mozilla.org/en-US/docs/Web/API/Push_API)
- [sabre.io — Building a CalDAV client](https://sabre.io/dav/building-a-caldav-client/)
- [gov.uz — Davlat xizmatlari portal](https://gov.uz/)
- [Telegram Bot API changelog](https://core.telegram.org/bots/api-changelog)
- [Telegram Bots FAQ — rate limits](https://core.telegram.org/bots/faq)
- [grammY — Telegram Bot Framework](https://grammy.dev/)
- [grammY — webhookCallback reference](https://grammy.dev/ref/core/webhookcallback)
- [grammY — Long Polling vs. Webhooks](https://grammy.dev/guide/deployment-types)
- [@telegram-apps/sdk — npm](https://www.npmjs.com/package/@telegram-apps/sdk)
- [Telegram Mini Apps — Methods reference](https://docs.telegram-mini-apps.com/platform/methods)
- [Telegram Mini Apps — Haptic Feedback](https://docs.telegram-mini-apps.com/platform/haptic-feedback)
- [pg-boss — Postgres-backed job queue](https://pgboss.io/)
- [pg-boss — GitHub / README](https://github.com/timgit/pg-boss)
- [Novu — Self-Host overview](https://docs.novu.co/community/self-hosting-novu/overview)
- [web-push — npm](https://www.npmjs.com/package/web-push)
- [web-push-libs/web-push — GitHub](https://github.com/web-push-libs/web-push)
- [my.gov.uz — official Telegram channel](https://t.me/s/MyGovUz)
- [my.gov.uz — @MyGovRasmiyBot](https://t.me/MyGovRasmiyBot)
- ["Soliq qonunchiligi" Telegram bot launch — kun.uz](https://kun.uz/news/2024/02/01/soliq-qonunchiligi-telegram-boti-ishga-tushirildi)
- [WhatsApp API Pricing Explained (2026) — Authgear](https://www.authgear.com/post/whatsapp-api-pricing/)
- [Conversation-based pricing (deprecated) — Meta for Developers](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/conversation-based-pricing)

## Editor's verification notes (notifications-telegram-mobile)

**Spot-check of 5 consequential factual claims (WebFetch against primary sources, 2026-09-04):**

| # | Claim in report | Result | Source |
|---|---|---|---|
| 1 | Telegram Mini App storage limits: CloudStorage 1,024 items × 4,096 bytes/item, DeviceStorage 5MB, SecureStorage 10 items | **CONFIRMED** (CloudStorage limit is 4,096 *characters* per value, not bytes — a minor imprecision, not material) | [core.telegram.org/bots/webapps](https://core.telegram.org/bots/webapps) |
| 2 | Deep-link `start` payload: up to 64 chars, charset `A-Z a-z 0-9 _ -` | **CONFIRMED** exactly, including the base64url encoding recommendation for binary payloads | [core.telegram.org/bots/features#deep-linking](https://core.telegram.org/bots/features) |
| 3 | Novu is open-source/self-hostable and lists Telegram as a first-class channel alongside email/SMS/push/WhatsApp/Slack/Teams | **CONFIRMED** verbatim from novu.co marketing copy | [novu.co](https://novu.co/) |
| 4 | Eskiz.uz SMS pricing "from 95 UZS" per message | **CONFIRMED** — page states "From 95 uzs" for domestic and international | [eskiz.uz/en](https://eskiz.uz/en) |
| 5 | GOV.UK Notify used by "1,754 organisations / 12,670 services" | **CONFIRMED** exactly — page states "There are 1,754 organisations and 12,670 services using Notify" | [notifications.service.gov.uk](https://www.notifications.service.gov.uk/) |

All five checked claims held up; the only imprecision found is trivial (CloudStorage's 4,096-char cap described as "bytes" — for Latin/Cyrillic text this distinction rarely matters in practice, but a build-time note should say "characters" to avoid an off-by-encoding bug if UTF-8 multi-byte content is ever cached there).

**Gaps — missing, thin, or hand-waved relative to the brief:**

1. **Uzbek gov Telegram bots — entirely absent.** The brief explicitly asks for named examples ("Uzbek gov bots"); the report only asserts generically that "government ministries and utilities routinely run public Telegram channels/bots for citizen services" with no single bot named, screenshotted, or linked. This is the most concrete, most locally-relevant ask in the whole brief and it's the one item skipped outright. A revision should name and briefly examine at least 2–3 real examples (e.g., myGov.uz-affiliated bots, tax/Soliq bots, a ministry citizen-appeals bot) for UX patterns worth copying or avoiding.
2. **Examples of gov/enterprise Mini Apps — entirely absent.** Same brief line, same gap: no non-Uzbek reference Mini Apps (e.g., known enterprise or public-sector TMAs) are examined for what a "serious," non-toy Mini App looks like at the UI/information-architecture level. Without this, the Mini App screen list in §14 is designed from first principles rather than from precedent.
3. **Telegram Bot API rate limits — not mentioned anywhere.** This is a load-bearing omission for the recommended architecture: Telegram enforces roughly 30 messages/second bot-wide and about 1 message/second per individual chat (with tighter limits for broadcasting into groups), which directly shapes how a fan-out worker must throttle/queue digest sends and how an "escalation broadcast to all sub-department heads" event should be batched. The notification model in §13 needs an explicit queuing/backoff note tied to these limits.
4. **Notification delivery audit trail / compliance logging — not addressed.** For a government system, "who was notified of what, when, and did they see it" is itself a record with retention/audit implications (relevant to escalation sign-offs and approvals specifically). The report designs the routing and channels but never discusses persisting delivery/read receipts as an auditable log, which is a natural adjacent requirement a senior engineering lead would flag immediately given the approval/escalation use case already described in the doc.
5. **WhatsApp Business API — dismissed in one sentence without real evaluation.** The report states WhatsApp has "essentially no institutional footprint" but doesn't check whether Meta's WhatsApp Cloud API is technically usable/available for Uzbek numbers, its cost model versus Telegram, or why it's excluded beyond adoption — worth one paragraph since it's a common fallback in other markets when Telegram is unavailable via MDM policy.
6. **No testing/staging strategy for the bot and notification pipeline** — no mention of a sandbox bot token, test chat, or how templates/digests get validated before hitting real users; a reasonable adjacent expectation for a production notification system.
7. **No rough cost model** — Eskiz per-SMS pricing (95 UZS) and Novu self-hosting are both mentioned but never translated into an estimated monthly cost at current (~23 people) and target multi-tenant scale, which a product/eng lead reviewing this for a build decision would want even as a rough order-of-magnitude figure.

**Assessment:** the report is well-researched and its verifiable claims check out cleanly (5/5 confirmed, one trivial units imprecision). The gaps are concentrated in the most Uzbekistan-specific and most operationally load-bearing parts of the brief — named local examples and Telegram API rate limits — rather than in the general design-pattern sections, which are strong.

## Gap-fill addendum (2026-09-05)

This pass ran 14 WebSearch queries and 10 WebFetch reads against primary sources (`core.telegram.org/bots/api-changelog`, `core.telegram.org/bots/faq`, `core.telegram.org/bots/webapps`, `grammy.dev`, `docs.telegram-mini-apps.com`, `docs.novu.co`, `pgboss.io` / `github.com/timgit/pg-boss`, `npmjs.com` registry, and Uzbek gov Telegram channels) to close every gap the editor flagged and to bring the doc to code-level specificity for TECH-SPEC. One correction was made in §4 above (CloudStorage's per-item cap is 4,096 **characters**, not bytes). Everything below is new material appended, not a rewrite of the sections above — §2's Novu recommendation is specifically **superseded** by §K below given what self-hosting Novu actually costs in infrastructure surface once you look past its marketing page.

### A. Telegram Bot API — current version and the features we'll use

Current version as of 2026-09-05 is **Bot API 10.3** (released 2026-08-24); the doc's live sections referenced Bot API 8.0's feature set, which is still accurate for our needs — nothing in 9.x/10.x removes or breaks any of it. Feature inventory we will actually build against:

| Feature | API surface | Our use |
|---|---|---|
| Inline keyboards | `reply_markup.inline_keyboard`, `answerCallbackQuery` | Approve/Decline, RSVP, "Mark done" |
| Callback queries | `callback_query` update, `answerCallbackQuery({ text, show_alert: false })` for a private per-user response inside a group | Decisions on shared/group messages stay invisible to the room |
| Deep links | `t.me/<bot>?start=<payload>`, ≤64 chars, `A-Z a-z 0-9 _ -` | Notification → exact in-app record, no extra auth prompt |
| Message editing | `editMessageText`, `editMessageReplyMarkup` | Live RSVP capacity counters, live approval-status line on the original message |
| Forum topics | `message_thread_id`, `ExternalReplyInfo` | Only relevant if we ever run a group-per-department; not needed for bot-to-user DMs, noted for completeness |
| Reactions | `setMessageReaction` (Bot API 7.0+) | Optional lightweight "seen"/"👍" ack on FYI-only messages without opening a thread |
| Login Widget | `https://oauth.telegram.org`, JWT (RS256/ES256/EdDSA), JWKS verification | Secondary identity link only, per §4/§13 of the base report |
| `initData` HMAC validation | `HMAC_SHA256(secret_key, data_check_string)`, `secret_key = HMAC_SHA256("WebAppData", bot_token)` | Every Mini App request, server-side, before trusting `user.id` |

**`initData` validation, TypeScript (Node `crypto`, no dependency needed):**

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

interface VerifiedInitData { ok: true; userId: number; params: URLSearchParams }
interface RejectedInitData { ok: false; reason: "missing_hash" | "bad_signature" | "stale" | "missing_user" }

const MAX_INIT_DATA_AGE_SECONDS = 300; // 5 minutes — reject replayed launch URLs

export function verifyTelegramInitData(
  initDataRaw: string,
  botToken: string,
): VerifiedInitData | RejectedInitData {
  const params = new URLSearchParams(initDataRaw);
  const hash = params.get("hash");
  if (!hash) return { ok: false, reason: "missing_hash" };
  params.delete("hash");

  // Data-check-string: all remaining fields, sorted alphabetically, "key=value" joined by \n.
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  const computedHash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  const a = Buffer.from(computedHash, "hex");
  const b = Buffer.from(hash, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: "bad_signature" };

  const authDate = Number(params.get("auth_date") ?? 0);
  if (Date.now() / 1000 - authDate > MAX_INIT_DATA_AGE_SECONDS) return { ok: false, reason: "stale" };

  const userJson = params.get("user");
  if (!userJson) return { ok: false, reason: "missing_user" };
  const telegramUserId = JSON.parse(userJson).id as number;

  return { ok: true, userId: telegramUserId, params };
}
```

Never trust `initDataUnsafe` (the client-parsed object the SDK exposes for convenience) for anything auth-relevant — always ship `initData.raw()` to the server and re-derive.

### B. grammY (current: 1.46.0) — Fastify webhook integration

grammY (1.46.0 on npm, ~1.26M weekly downloads vs. Telegraf's ~857K) is the better-fit framework for us: first-class TypeScript types, an official plugin for exactly the flood-control problem in §D below, and an official Fastify adapter built into `webhookCallback`.

```ts
// apps/api/src/telegram/bot.ts
import { Bot, webhookCallback } from "grammy";
import { autoRetry } from "@grammyjs/auto-retry";
import { apiThrottler } from "@grammyjs/transformer-throttler";

export const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN!);

// Honors Telegram's own 429 + Retry-After automatically.
bot.api.config.use(autoRetry({ maxRetryAttempts: 5, maxDelaySeconds: 30 }));
// Enforces the three official ceilings (global/group/private) before Telegram ever has to 429 us.
bot.api.config.use(apiThrottler());

bot.command("mytasks", async (ctx) => { /* inline list + "Mark done" buttons */ });
bot.command("settings", async (ctx) => { /* opens the Mini App settings screen */ });

bot.on("callback_query:data", async (ctx) => {
  const [action, taskId] = ctx.callbackQuery.data.split(":");
  // ... apply the decision, then:
  await ctx.answerCallbackQuery({ text: "Recorded — thanks", show_alert: false }); // private, per-user
  await ctx.editMessageReplyMarkup({ reply_markup: undefined }); // remove buttons once decided
});
```

```ts
// apps/api/src/server.ts
import Fastify from "fastify";
import { webhookCallback } from "grammy";
import { bot } from "./telegram/bot";

const app = Fastify({ logger: true });

app.post(
  `/telegram/webhook/${process.env.TELEGRAM_WEBHOOK_PATH_SECRET}`,
  webhookCallback(bot, "fastify", {
    secretToken: process.env.TELEGRAM_WEBHOOK_SECRET, // Telegram echoes this in X-Telegram-Bot-Api-Secret-Token
    timeoutMilliseconds: 10_000,
    onTimeout: "return",
  }),
);

await app.listen({ port: 3000, host: "0.0.0.0" });
await bot.api.setWebhook(process.env.TELEGRAM_WEBHOOK_URL!, {
  secret_token: process.env.TELEGRAM_WEBHOOK_SECRET,
  drop_pending_updates: false,
});
```

Register the route path with a random secret segment *and* Telegram's `secret_token` header check (defense in depth — the path alone is guessable if it's ever logged by a proxy).

### C. Mini App SDK (`@telegram-apps/sdk`, current: 3.11.8) — auth, theming, back button, haptics

`@telegram-apps/sdk` (3.11.8) is the actively maintained, fully-typed successor to the old `twa-dev`/`telegram-web-app.js` global-object style; it wraps the same bridge but gives typed, tree-shakeable modules.

```ts
// apps/web/src/telegram/bootstrap.ts
import { init, initData, backButton, hapticFeedback, themeParams, viewport } from "@telegram-apps/sdk";

init();
await Promise.all([backButton.mount(), themeParams.mount(), viewport.mount()]);

// --- Auth flow: raw initData → our backend → session, never trust the client copy ---
export async function authenticateMiniApp(): Promise<{ sessionToken: string }> {
  const raw = initData.raw();
  if (!raw) throw new Error("Not launched inside Telegram");
  const res = await fetch("/api/auth/telegram-mini-app", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ initData: raw }),
  });
  if (!res.ok) throw new Error("Mini App auth rejected");
  return res.json(); // { sessionToken } — store in memory + SecureStorage, never localStorage
}

// --- Theming: map Telegram's theme onto our own design tokens, don't hardcode a look ---
function applyTelegramTheme() {
  const p = themeParams.state();
  const root = document.documentElement.style;
  root.setProperty("--wp-color-bg", p.bgColor ?? "#ffffff");
  root.setProperty("--wp-color-text", p.textColor ?? "#111111");
  root.setProperty("--wp-color-accent", p.accentTextColor ?? p.linkColor ?? "#2563eb");
  root.setProperty("--wp-color-button", p.buttonColor ?? "#2563eb");
  root.setProperty("--wp-color-destructive", p.destructiveTextColor ?? "#dc2626");
}
themeParams.state.sub(applyTelegramTheme);
applyTelegramTheme();

// --- Back button: every non-root screen shows it; root screen hides it (closes the Mini App) ---
export function useMiniAppBackButton(onBack: () => void, isRoot: boolean) {
  if (isRoot) { backButton.hide(); return; }
  backButton.show();
  return backButton.onClick(onBack); // returns an unsubscribe fn
}

// --- Haptics: confirm every write action, distinguish success/error, never spam it ---
export const haptics = {
  tap: () => hapticFeedback.impactOccurred("light"),
  success: () => hapticFeedback.notificationOccurred("success"),
  error: () => hapticFeedback.notificationOccurred("error"),
  select: () => hapticFeedback.selectionChanged(),
};
```

Backend side of the auth flow uses the exact `verifyTelegramInitData` function from §A, then looks up (or, on first launch, prompts to link via the Login-Widget flow) the internal user by Telegram user id before issuing our own session.

### D. Rate limits and retry strategy

Confirmed from `core.telegram.org/bots/faq` (2026-09-05): **≤1 message/second per individual chat**, **≤20 messages/minute per group**, and **≈30 messages/second bot-wide** for broadcast/bulk sends (paid broadcasts can raise the global ceiling, not something we need at 23–~100 users). Exceeding any of the three independently returns `429` with a `Retry-After` header in seconds.

Architecture implication for the fan-out worker (§13's ROUTING stage): a single `telegram-outbound` pg-boss queue, one logical sender, two layers of protection —
1. **`@grammyjs/transformer-throttler`** (§B) enforces the three ceilings client-side before Telegram ever needs to reject us — it queues internally per-chat and globally.
2. **`@grammyjs/auto-retry`** catches any `429` that still slips through (clock skew, a burst from a concurrent process) and retries after the exact `Retry-After` window, up to a bounded attempt count — never a tight retry loop.

For the "escalation to all sub-department heads" broadcast case specifically: chunk the recipient list and `boss.send()` one job per recipient (not one job that loops and sends N messages inline) so a single failed send doesn't block the rest and pg-boss's own concurrency setting becomes the de facto rate limiter — cap worker concurrency at ~15–20 concurrent sends to stay under the 30 msg/s ceiling with headroom.

### E. Message templates (uz / ru / en)

Templates live as i18n keys (uz default, ru/en complete, per CLAUDE.md), rendered server-side before ever reaching a channel adapter — this is also the enforcement point for §F's redaction rule.

| Key | uz (Latin) | ru | en |
|---|---|---|---|
| `notif.task.assigned` | 🔔 Sizga vazifa biriktirildi: «{title}». Ochish uchun bosing → | 🔔 Вам назначена задача: «{title}». Нажмите, чтобы открыть → | 🔔 You were assigned a task: "{title}". Tap to open → |
| `notif.task.mentioned` | 💬 Sizni eslatishdi: «{title}» | 💬 Вас упомянули: «{title}» | 💬 You were mentioned: "{title}" |
| `notif.approval.requested` | ✅ Tasdiqlash kerak: «{title}» | ✅ Требуется подтверждение: «{title}» | ✅ Approval needed: "{title}" |
| `notif.approval.decided` | ℹ️ «{title}» bo'yicha qaror: {decision} | ℹ️ Решение по «{title}»: {decision} | ℹ️ Decision on "{title}": {decision} |
| `notif.digest.ready` | 📋 Kunlik hisobot: {count} ta yangi bildirishnoma. /digest orqali ko'ring | 📋 Ежедневная сводка: {count} новых уведомлений. Просмотр — /digest | 📋 Daily digest: {count} new notifications. View with /digest |
| `notif.escalation.urgent` | ⚠️ Shoshilinch: «{title}» — javob talab qilinadi | ⚠️ Срочно: «{title}» — требуется ответ | ⚠️ Urgent: "{title}" — response required |
| `notif.rsvp.opened` | 📅 Yangi tadbir: «{title}». Ishtirok etasizmi? | 📅 Новое мероприятие: «{title}». Примете участие? | 📅 New event: "{title}". Will you attend? |

Every template's only interpolated fields are `{title}` (truncated to 80 chars, HTML-stripped), `{count}`, and `{decision}` — never a free-text comment body or document field, enforced mechanically in §F.

### F. "Pointer not payload" — the redaction pattern, concretely

The rule in §5 of the base report ("Telegram messages must never contain personal/HR/document data") needs a mechanism, not just a policy. We implement it as an **allow-listed pointer builder** that is the *only* function permitted to construct an outbound Telegram/SMS/push message body — no channel adapter ever receives a raw domain object.

```ts
// packages/notifications/src/pointer.ts
interface DomainEvent {
  objectType: "task" | "project" | "activity" | "leave_request";
  objectId: string;
  title: string;          // may itself be sensitive in edge cases (e.g. a leave reason) — see stripSensitiveTitle
  actorName?: string;
}

const FORBIDDEN_FIELD_NAMES = [
  "dob", "homeAddress", "salary", "healthNote", "documentBody",
  "phoneNumber", "passportNumber", "fullMedicalHistory", "commentBody", "attachmentUrl",
] as const;

export function toPointer(event: DomainEvent): { titleSnippet: string; deepLink: string } {
  return {
    titleSnippet: truncate(stripHtml(event.title), 80),
    deepLink: `https://t.me/${BOT_USERNAME}?start=${signShortToken(event.objectType, event.objectId)}`,
  };
}

// Build-time guard: every i18n template under `notif.*` is scanned for interpolation
// placeholders; the build fails if any placeholder name matches FORBIDDEN_FIELD_NAMES
// or isn't one of the explicitly allow-listed {title}/{count}/{decision}/{actorName}.
export function assertTemplatesAreSafe(templates: Record<string, string>): void {
  const allowed = new Set(["title", "count", "decision", "actorName"]);
  for (const [key, source] of Object.entries(templates)) {
    for (const placeholder of [...source.matchAll(/\{(\w+)\}/g)].map((m) => m[1])) {
      if (!allowed.has(placeholder)) {
        throw new Error(`notif template "${key}" uses non-allow-listed placeholder {${placeholder}}`);
      }
    }
  }
}
```

`assertTemplatesAreSafe` runs in the `fast` gate (i18n check) alongside string-completeness — a template can't ship a new placeholder without an explicit allow-list change reviewed by a human, which is the actual enforcement of "policy, not just developer discipline" that the base report called for.

### G. Digest scheduling with pg-boss (current: 12.30.0)

pg-boss 12.30.0 requires **Postgres 13+** (we're on 17) and **Node 22.12+**; it needs no new datastore — it runs its queue tables inside our existing Postgres, which is the crux of the §K decision below.

```ts
// apps/api/src/notifications/digest-schedule.ts
import PgBoss from "pg-boss";

export const boss = new PgBoss({ connectionString: process.env.DATABASE_URL! });
await boss.start();

// Compute pending digests once a day at 08:00 Asia/Tashkent — the org-wide quiet-hours end time.
await boss.schedule("notif.digest.compute", "0 8 * * *", {}, { tz: "Asia/Tashkent" });

await boss.work("notif.digest.compute", { retryLimit: 3, retryBackoff: true }, async () => {
  const usersDue = await getUsersWithPendingDigestItems();
  for (const user of usersDue) {
    // singletonKey de-dupes if the compute job somehow fires twice for the same user/day.
    await boss.send("notif.digest.send", { userId: user.id }, {
      retryLimit: 5,
      retryBackoff: true,
      expireInSeconds: 3600,
      singletonKey: `digest:${user.id}:${isoDateInTz("Asia/Tashkent")}`,
    });
  }
});

await boss.work(
  "notif.digest.send",
  { batchSize: 10, pollingIntervalSeconds: 2 },
  async (jobs) => {
    for (const job of jobs) await sendDigestEmailAndTelegramSummary(job.data.userId);
  },
);

// Urgent/escalation items bypass the digest entirely and go through a separate
// low-latency "notif.realtime" queue with retryLimit but no batching.
```

The 08:00 compute time deliberately lines up with the org-wide quiet-hours end from §12/§13 of the base report — a digest queued at 23:40 is *held*, not dropped, by simply never enqueueing `notif.digest.send` until this scheduled run.

### H. Web push (VAPID) as a secondary channel

Confirms §8's "supplementary, never primary" framing with an implementation. `web-push` (npm) generates and consumes VAPID keys; failed sends with `410 Gone`/`404 Not Found` mean the subscription is dead and must be pruned (browser uninstalled the PWA, cleared storage, etc.) — silently retrying a dead subscription forever is the most common web-push bug.

```ts
import webpush from "web-push";

webpush.setVapidDetails(
  "mailto:it@medt.uz",
  process.env.VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!,
);

export async function sendWebPush(sub: PushSubscriptionRecord, pointer: NotificationPointer) {
  try {
    await webpush.sendNotification(sub.raw, JSON.stringify(pointer), { TTL: 3600, urgency: "normal" });
  } catch (err: any) {
    if (err.statusCode === 410 || err.statusCode === 404) {
      await markPushSubscriptionDead(sub.id); // stop retrying; UI should re-prompt on next visit
    } else {
      throw err; // let pg-boss retry/backoff handle transient failures
    }
  }
}
```

### I. Email via local SMTP

Per §3's deliverability warning, email is a digest/audit channel, sent through a **local mail relay** (Postfix/Exim on our own infra, or the ministry's mail gateway), never a public SaaS SMTP endpoint (keeps mail metadata in-country, matching the localization posture).

```ts
import nodemailer from "nodemailer";

const transport = nodemailer.createTransport({
  host: process.env.SMTP_RELAY_HOST ?? "localhost", // local relay, not smtp.sendgrid.net etc.
  port: 25,
  secure: false,
  tls: { rejectUnauthorized: true },
});

await transport.sendMail({
  from: '"WorkPortal" <noreply@medt.uz>',
  to: user.email,
  subject: t("notif.digest.subject", { locale: user.locale, count: digest.items.length }),
  html: renderDigestEmail(digest, user.locale),
  headers: { "X-Auto-Response-Suppress": "All" }, // stop auto-replies from bouncing back into the queue
});
```

Before relying on this in production: SPF/DKIM/DMARC records on the sending domain, a warm-up period, and getting the relay IP allow-listed by ministry IT — all three were flagged as open in §3 and remain open; this is implementation-ready, not deliverability-ready.

### J. Quiet-hours logic with Asia/Tashkent

Asia/Tashkent is **UTC+5 year-round with no daylight-saving transitions**, which simplifies this considerably versus a DST-observing timezone — but the code should still use a real timezone-aware library (not a hardcoded `+5` offset) so it keeps working if the org ever has staff traveling or the zone rule ever changes.

```ts
import { DateTime } from "luxon";

interface QuietHoursPref { tz: string; quietStart: string; quietEnd: string; quietWeekends: boolean }

export function isQuietNow(pref: QuietHoursPref, at: Date = new Date()): boolean {
  const local = DateTime.fromJSDate(at, { zone: pref.tz }); // "Asia/Tashkent"
  if (pref.quietWeekends && local.weekday >= 6) return true; // Luxon: Sat=6, Sun=7

  const minutesNow = local.hour * 60 + local.minute;
  const [startH, startM] = pref.quietStart.split(":").map(Number);
  const [endH, endM] = pref.quietEnd.split(":").map(Number);
  const start = startH * 60 + startM;
  const end = endH * 60 + endM;

  return start > end
    ? minutesNow >= start || minutesNow < end   // window crosses midnight (20:00–08:00)
    : minutesNow >= start && minutesNow < end;
}

export function nextDeliveryTime(pref: QuietHoursPref, from: Date = new Date()): Date {
  let candidate = DateTime.fromJSDate(from, { zone: pref.tz });
  // Step forward in 15-minute increments until outside quiet hours — bounded to 4 days
  // of stepping so a misconfigured preference can never loop forever.
  for (let i = 0; i < 4 * 24 * 4 && isQuietNow(pref, candidate.toJSDate()); i++) {
    candidate = candidate.plus({ minutes: 15 });
  }
  return candidate.toJSDate();
}
```

The "urgent bypasses quiet hours" flag from §13 is a separate boolean checked *before* calling `isQuietNow` at all — urgent items skip this function entirely and go straight to the realtime queue from §G.

### K. Notification preference model schema (SQL)

Formalizes §13's model, adds the tenant scoping and audit trail every table in this system requires per CLAUDE.md, and directly closes editor gap #4 (delivery audit trail).

```sql
-- Per user × per event-type channel/delivery-mode preference (§13's PREFERENCES stage).
CREATE TABLE notification_preferences (
  tenant_id     UUID NOT NULL REFERENCES tenants(id),
  user_id       UUID NOT NULL REFERENCES users(id),
  event_type    TEXT NOT NULL,               -- 'task.assigned' | 'task.mentioned' | 'approval.requested' | ...
  channel_inbox     BOOLEAN NOT NULL DEFAULT TRUE,
  channel_telegram  BOOLEAN NOT NULL DEFAULT TRUE,
  channel_email     BOOLEAN NOT NULL DEFAULT TRUE,
  channel_web_push  BOOLEAN NOT NULL DEFAULT FALSE,
  channel_sms       BOOLEAN NOT NULL DEFAULT FALSE,
  delivery_mode TEXT NOT NULL DEFAULT 'realtime'
                CHECK (delivery_mode IN ('realtime', 'digest', 'muted')),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id, event_type)
);

-- Quiet hours: org default is seeded per tenant; a user may only narrow it, never widen it
-- (enforced in the application layer, not SQL — the check needs the org-default row to compare against).
CREATE TABLE notification_quiet_hours (
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  user_id         UUID REFERENCES users(id),   -- NULL row = the tenant-wide default
  tz              TEXT NOT NULL DEFAULT 'Asia/Tashkent',
  quiet_start     TIME NOT NULL DEFAULT '20:00',
  quiet_end       TIME NOT NULL DEFAULT '08:00',
  quiet_weekends  BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (tenant_id, COALESCE(user_id, '00000000-0000-0000-0000-000000000000'))
);

-- The domain fact (§13's EVENT stage) — reason-tagged, per the GitHub-inspired "why am I seeing this" rule.
CREATE TABLE notification_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id),
  event_type    TEXT NOT NULL,
  reason        TEXT NOT NULL
                CHECK (reason IN ('assigned', 'mentioned', 'subscribed', 'escalated', 'weekly_digest')),
  object_type   TEXT NOT NULL,
  object_id     UUID NOT NULL,
  actor_user_id UUID REFERENCES users(id),
  pointer       JSONB NOT NULL,      -- output of toPointer() ONLY — never a raw domain record (§F)
  urgent        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX notification_events_object_idx ON notification_events (tenant_id, object_type, object_id);

-- The audit trail (editor gap #4): one row per (event, user, channel) — who was told what, when,
-- via which channel, and whether it was ever confirmed delivered/read. Retained per records-retention policy.
CREATE TABLE notification_deliveries (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id            UUID NOT NULL REFERENCES notification_events(id),
  tenant_id           UUID NOT NULL REFERENCES tenants(id),
  user_id             UUID NOT NULL REFERENCES users(id),
  channel             TEXT NOT NULL CHECK (channel IN ('inbox', 'telegram', 'email', 'web_push', 'sms')),
  status              TEXT NOT NULL DEFAULT 'queued'
                      CHECK (status IN ('queued', 'sent', 'delivered', 'failed', 'read')),
  provider_message_id TEXT,          -- Telegram message_id, SMTP message-id, Eskiz message id, etc.
  error               TEXT,
  queued_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at             TIMESTAMPTZ,
  read_at             TIMESTAMPTZ
);
CREATE INDEX notification_deliveries_user_status_idx ON notification_deliveries (tenant_id, user_id, status);
```

Every table carries `tenant_id` per the CLAUDE.md convention even though phase 1 is single-tenant — this is what makes the GOV.UK-Notify-style "shared service for other ministries" end state (base report §2, item 12) a config change later rather than a migration.

### L. Novu self-host vs. a ~300-line custom worker — the decision

The base report's §2 recommendation ("self-host Novu") was made from Novu's marketing surface. Digging into `docs.novu.co/community/self-hosting-novu/overview` changes the calculus:

**What self-hosting Novu actually requires:** API, Worker, and WS services, a separate Dashboard service, **MongoDB** (not Postgres), **Redis** (two clusters recommended for production), and **S3-compatible object storage** — minimum single-VM footprint is 4 vCPU / 8 GB just for the app services, plus 2 GB/20 GB for MongoDB and 2 GB for Redis; the documented production topology is multiple VMs per service. None of MongoDB, Redis, or S3 exist anywhere else in our stack (TECH-SPEC direction is Postgres 17 + pg-boss for everything, including jobs) — adopting Novu means standing up, securing, backing up, and getting three *new* categories of infrastructure allow-listed by ministry IT (base report §3's exact "gateway allow-listing" friction, now multiplied across services instead of just SMTP) for a department running one small notification workload for ~23 people.

**What our own need actually is:** one event table, one preference table, one queue, five channel adapters (inbox/Telegram/email/web-push/SMS), a digest scheduler, and a quiet-hours check — every one of which is now specified in code-level detail in §A–§K above, entirely on top of Postgres + pg-boss, which we are running anyway for every other background job in the system. This is a genuinely small, bounded domain problem, not a "notification infrastructure platform" problem — Novu's own docs describe itself as solving multi-provider, multi-tenant-SaaS-scale routing across dozens of provider integrations, none of which we need (we have exactly one Telegram bot, one SMTP relay, one SMS gateway).

**Decision: build the custom worker, not self-hosted Novu.** Reasons, in order of weight:
1. **Zero new datastores.** No MongoDB/Redis/S3 to provision, back up, patch, or get firewall exceptions for — a material win against the base report's own data-localization and ministry-network-policy concerns (§3, open questions).
2. **One thing to secure and audit**, not four — a smaller attack surface and a simpler answer when the ministry's security team asks "what runs our notifications and where does the data sit."
3. **The domain is small enough to specify exhaustively** — §A–§K above is close to the full spec already; a 300-line worker (event dispatch → preference lookup → quiet-hours gate → channel adapter → pg-boss retry) is a realistic estimate, not optimism.
4. **We keep Novu's *ideas*, discard its *infrastructure*** — the workflow/preference-center/digest concepts the base report rightly admired are design patterns, not code we need to inherit; §K's schema already encodes them.
5. **Novu remains the fallback if the custom worker's scope creeps** — if multi-tenant expansion (base report §2, GOV.UK-Notify end state) later demands true multi-provider routing across many ministries with different channel mixes, re-evaluate Novu (or by then, whatever the OSS notification landscape looks like) as a phase-3+ migration target, not a phase-1 dependency.

This reverses the base report's §2 recommendation; §2's comparison table and the GOV.UK-Notify aspirational framing both remain valid and are not otherwise affected.

### M. Named Uzbek gov Telegram bots (closing editor gap #1)

Concrete examples found this pass, for UX patterns worth studying before finalizing §14's command list:

- **`@MyGovRasmiyBot`** — the official my.gov.uz citizen-services bot, linked from the my.gov.uz Telegram channel ([t.me/s/MyGovUz](https://t.me/s/MyGovUz)) alongside a phone hotline (1242) and email; positioned as a feedback/appeals channel for the "hundreds of state services" portal, emphasizing 24/7 access "without leaving home" (`uydan chiqmasdan`) and no e-signature requirement for certain submissions — directly validates the base report's "Telegram as the trusted low-friction channel" thesis with a real, high-traffic government precedent.
- **`@soliq_mobililova_murojaatlar_bot`** — the State Tax Committee's bot for questions/appeals about its mobile app.
- **`@soliq_qonunchiligi_bot`** ("Soliq qonunchiligi" / Tax Legislation bot, launched Feb 2024) — organizes 300+ regulatory documents into 30 topic areas, answering tax-law questions 24/7; the "structured knowledge base behind a bot chat interface" pattern is directly reusable for a future WorkPortal `/help`-style FAQ bot.
- **`@dsq_anticorrupciya_bot`** — the Tax Committee's anti-corruption appeals bot, a second data point that Uzbek ministries already route *sensitive* citizen reports through Telegram bots (worth noting as a counter-example to our own "pointer not payload" rule — that bot is presumably built to keep report content in-bot, which is a legitimate but different trust model than a doorbell-only bot; we should not copy that pattern without a deliberate decision, since our rule in §5 is intentionally stricter for HR/personal data).

No non-Uzbek reference **Mini App** (as opposed to bot) case study was found with confidence in this pass before the session's search budget was exhausted — editor gap #2 is only partially closed. This remains a recommended follow-up spike before finalizing §14's five-screen Mini App IA: find 2–3 non-crypto, non-gambling production Mini Apps (large e-commerce or banking Mini Apps are the likeliest category) and audit their navigation/IA choices specifically.

### N. WhatsApp Business Cloud API — the real evaluation (closing editor gap #5)

Meta's WhatsApp Business Platform has **no country-level restriction on Uzbekistan** — it is technically usable for Uzbek numbers. Its pricing model changed materially on 2025-07-01: the old per-24-hour-conversation charge was replaced by **per-message pricing on template messages**, priced per recipient-country; free-form replies inside an open 24-hour service window remain free, as do utility-template replies inside that window. This makes WhatsApp technically viable but strategically redundant for us: it would require (a) a Meta Business verification process, (b) template pre-approval for every message shape (slower iteration than Telegram, where we control the bot entirely), and (c) per-message cost for anything outside a live conversation window — against Telegram, which is free, has no template-approval gate, and — per the base report's own market-share point — is the platform civil servants already have open. **Conclusion: WhatsApp Cloud API is a legitimate phase-3+ fallback if Telegram is ever banned/MDM-blocked, not worth building against now.** This confirms rather than overturns the base report's one-sentence dismissal, but on evaluated grounds rather than an assumption.

### O. Testing/staging strategy (closing editor gap #6)

- **Sandbox bot**: a second BotFather-registered bot (`@workportal_dev_bot` or similar) with its own token in `.env.example` as `TELEGRAM_BOT_TOKEN_DEV`, pointed at the staging API — never share a token between environments.
- **Test chat/group**: a private Telegram group containing only the engineering team, used as the target for staging broadcast tests (RSVP capacity updates, escalation fan-out) before anything touches the real ~23-person tenant.
- **Template preview endpoint**: an internal-only API route that renders any `notif.*` template (all three locales) with sample data and returns the exact string that would be sent — lets a non-engineer proofread uz/ru/en copy without triggering a real send.
- **Digest dry-run flag**: `boss.send("notif.digest.compute", {}, { ... })` accepts a `dryRun: true` payload field that computes and logs what *would* be sent without calling any channel adapter — used in CI and for a human sanity-check before the first real production digest run.
- **Webhook signature test**: a gate-mjs check (or a unit test) that posts a request to the webhook route with a deliberately wrong `X-Telegram-Bot-Api-Secret-Token` and asserts a 401 — regression-proofs the auth check in §B.

### P. Rough cost model (closing editor gap #7)

Order-of-magnitude only, at current scale (~23 people) and a hypothetical 5x multi-tenant scale (~120 people across a few ministries):

| Item | ~23 people/month | ~120 people/month | Basis |
|---|---|---|---|
| Telegram (bot + Mini App) | 0 | 0 | Free at any volume; only "cost" is engineering time |
| SMS fallback (Eskiz.uz) | ~5,000–10,000 UZS | ~25,000–50,000 UZS | 95 UZS/msg × a handful of OTP/fallback sends per person/month (most notifications never touch SMS) |
| Email (local SMTP relay) | ~0 marginal | ~0 marginal | Uses existing ministry mail infra; the real cost is the one-time SPF/DKIM/DMARC + allow-listing effort (§3, §I), not a recurring fee |
| Web push (VAPID) | 0 | 0 | No server fee — VAPID is a protocol, not a paid service |
| Custom notification worker (pg-boss on existing Postgres) | ~0 marginal | ~0 marginal | Reuses infra already budgeted for the rest of the app; no new service to license or host |
| **Novu self-hosted (for comparison, not chosen)** | new MongoDB + Redis + S3 + 4+ services, ≥4 vCPU/8GB minimum | same services, larger tier | Real cost is ops/hosting overhead and the ministry firewall/allow-list process, not a license fee (OSS) |

Bottom line: at this scale, the entire notification layer's recurring cash cost is **effectively just SMS fallback**, on the order of a few tens of thousands of UZS/month even at 5x scale — the real cost is engineering time to build §A–§K once, not a recurring line item, which further supports the §L decision to avoid taking on Novu's infrastructure weight for a workload this cheap to run ourselves.
