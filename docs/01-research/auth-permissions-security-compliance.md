# Identity, permissions, audit and security for a government tool

**TL;DR**
1. Self-host a single OIDC-native IdP (Keycloak 26.7 or Zitadel) behind the app from day one — never bolt on SSO later — and put Uzbekistan's OneID (or its OIDC successor) behind it as a federated upstream provider, not as the primary IdP, so the tool still works if OneID is down or a partner ministry has no OneID account.
2. Use hierarchical RBAC (Director → Head of Sub-department → Employee, mirroring the org chart already in the reference audit) as the default mental model, with a thin ReBAC layer only for one-off object shares ("share this project with X") — do not reach for Zanzibar-style tools like OpenFGA/SpiceDB until you have >50 tenants or genuinely tangled sharing graphs.
3. Field-level tiers (Public / Internal / Restricted) on the People record are the single highest-value permission feature for this brief — model it as a per-field visibility tag, not a second "HR system," and log every read of a Restricted field.
4. Passkeys/WebAuthn should be the primary second factor for a 2026 build (biometric, phishing-resistant, no SMS costs), with a self-hosted OIDC IdP handling session/MFA policy centrally rather than in the app.
5. Uzbekistan's data-localization law is a hard constraint (Uzbek citizens' personal data must sit on servers physically inside Uzbekistan, registered in the State Register of Personal Databases) — this alone rules out most SaaS IdPs (Auth0, Clerk, WorkOS, Zitadel Cloud) as the system of record and forces self-hosted, in-country deployment for anything holding real employee PII.

## 1. Identity providers: build vs. buy vs. self-host

For a government tool with a data-localization mandate, "buy a SaaS IdP" is mostly off the table for anything touching real personal data — Auth0, Clerk, WorkOS, Zitadel Cloud, Okta, and Firebase Auth all store user data on foreign infrastructure by default. That leaves three real paths: self-hosted IdP, embedded auth library, or federation to a national identity system.

### Self-hosted IdPs compared

| Product | License | Protocols | Multi-tenancy | Notable 2025–26 state | Fit for this project |
|---|---|---|---|---|---|
| **Keycloak** | Apache 2.0 (CNCF, Red Hat-backed) | OIDC, SAML2, LDAP, SCIM (preview, Keycloak 26.x) | "Organizations" feature (added 2024, matured through 26.x) with per-org role inheritance and delegated admin | Version 26.7.x as of mid-2026; SCIM API promoted to preview, Identity Brokering API v2, WebAuthn policy now supports preferred/required/discouraged, multi-cluster HA v2 removes the need for external Infinispan caches, admin console rewritten in React. Verifiable-credentials (OID4VCI) support is experimental — relevant if Uzbekistan ever issues OID4VC-based digital IDs. | Best default choice: mature, huge deployment base, Java/Quarkus runtime is heavy (needs a real VM, not a Raspberry Pi) but that's a non-issue for gov-cloud/on-prem. Multi-realm model maps directly onto "one realm per ministry/tenant." |
| **Zitadel** | Apache 2.0 core, paid features gated | OIDC, SAML2, SCIM, passwordless | "Organizations" as a first-class primitive from day one (cleaner than Keycloak's bolt-on) | Free self-hosted tier; hosted pricing is $0 (100 DAU) → $100/mo (25k DAU) → custom enterprise; ISO 27001, SOC2 Type II, OIDC-certified. Go-based, much lighter runtime than Keycloak. | Strong alternative if you want a lighter footprint and cleaner multi-tenant primitives; smaller ecosystem/plugin base than Keycloak, fewer Central-Asian deployment precedents. |
| **Authentik** | MIT-ish open source (self-hosted) | OAuth2/OIDC, SAML2, SCIM, LDAP, RADIUS | Yes, via "Flows" and per-app policies | Over 1M installs, used by Cloudflare/Gopuff/CoreWeave; strong "application proxy" mode (put it in front of legacy apps with no auth at all) — directly useful for wrapping old ministry systems that predate any IdP. Includes geolocation/"impossible travel" alerts and privileged-access workflows out of the box. | Good option specifically because ministries have legacy intranet apps with zero auth — Authentik's reverse-proxy SSO mode retrofits them without code changes. |
| **Ory (Kratos/Hydra/Keto/Oathkeeper)** | Apache 2.0, cloud add-on paid | OIDC (Hydra), identity/credentials (Kratos), ReBAC (Keto = Zanzibar-inspired), API gateway (Oathkeeper) | Via Keto's relationship graph | API-first, headless (bring your own UI) — much more engineering lift than Keycloak/Zitadel/Authentik, which ship a usable admin UI and login screens out of the box. | Not recommended here: a 23-person department needs an IdP with a UI today, not a toolkit to build one. Revisit only if this platform becomes a multi-ministry identity *platform* in its own right. |

**Recommendation: Keycloak 26.x**, self-hosted on gov-cloud or on-prem, one realm per tenant (ministry/department), because it is the most battle-tested option with the largest base of public-sector deployments worldwide, has native LDAP/AD federation (ministries commonly run on-prem Active Directory), and its "Organizations" feature gives clean per-tenant admin delegation. Authentik is worth keeping in reserve specifically for wrapping legacy unauthenticated intranet tools via its app-proxy mode.

### Embedded auth libraries (if you build the login layer into the app instead of a standalone IdP)

| Library | What it is | 2025–26 status |
|---|---|---|
| **Better Auth** | TypeScript, code-first, plugin-based auth framework ("auth that lives inside your app") | Raised a **$5M seed round on 24 June 2025** (led by Peak XV Partners) as an independent company, then was **acquired by Vercel on 7 July 2026** ("Better Auth is joining Vercel... to accelerate our work on open-source auth and securing agent workflows" — Better Auth's own blog), signalling it is becoming the default Next.js-ecosystem answer. Ships email/password, 34+ social providers, passkeys, magic links, 2FA, and — notably — an **Organizations plugin** with teams/roles/invitations and a **SCIM/SSO/SAML plugin**, i.e. it already speaks the enterprise-directory language you'll need. |
| **Auth.js (NextAuth)** | Long-standing session/OAuth glue library for Next.js/SvelteKit etc. | Mature, but positioned as thinner glue rather than a full identity system; no built-in org/RBAC/SCIM model — you build that yourself. |
| **Lucia** | Was a minimal, "copy the code into your repo" session library | **Deprecated in 2025** — the author stopped maintaining it and now publishes a guide on rolling your own sessions instead. This is a useful negative data point: even a well-regarded, security-literate maintainer concluded a tiny auth library doesn't stay worth maintaining, and pointed users toward either rolling minimal code by hand or moving to a fuller solution (which is part of why Better Auth gained traction as the "spiritual successor"). |

**Recommendation:** do not use an embedded library as the *primary* identity boundary for a government system of record — self-hosted Keycloak should own accounts, sessions, and MFA. An embedded lib like Better Auth is reasonable only for a lightweight companion app/microservice that must stay framework-native, and even then it should delegate to Keycloak via OIDC rather than keep its own password store.

## 2. National SSO: OneID / ONEST

Uzbekistan's national single sign-on for government e-services is operated under the "Yagona identifikatsiya tizimi" (One ID / ONEST) framework used by my.gov.uz and gov.uz portals; publicly documented technical detail is thin (much of the integration spec is only published to registered agencies through the E-Government Development Center, and the public onest.uz endpoint was not reachable during this research — see Open Questions). What is reliably known from the broader pattern of similar CIS/Central Asian national ID systems and from what public developer materials exist: OneID exposes an OAuth2/OIDC-style authorization-code flow returning a citizen's PINFL (personal identification number) and verified name/DOB, intended for authenticating **citizens** to public-facing services, not primarily for **employee** SSO into internal back-office tools.

Practical implication for this platform: treat OneID as an optional **citizen-facing login option** for any future public-facing module (e.g., a citizen feedback portal bolted onto the department's work), but do **not** make it the employee login path — staff should authenticate via the self-hosted Keycloak realm federated to the ministry's Active Directory, exactly the pattern most ministries already run for their intranet systems. If/when a future phase needs to verify an employee's PINFL-linked identity (e.g., for a formal digital-signature action), integrate OneID as a secondary identity broker inside Keycloak (Keycloak's Identity Brokering API v2, per its 26.x release notes, explicitly supports this kind of upstream federation with per-client authorization).

## 3. Directory sync: SCIM and LDAP/AD

Ministries commonly run on-prem Active Directory for user accounts; SCIM (System for Cross-domain Identity Management) is the modern REST-based protocol for provisioning/deprovisioning users and groups into an app or IdP automatically, replacing manual CSV imports. Keycloak's LDAP federation lets it read (and optionally write back to) an AD forest directly, so the practical integration path is: AD/LDAP → Keycloak (LDAP federation, one-way or read-write) → app (OIDC). SCIM becomes relevant later if this platform must *provision into* other ministries' systems (Keycloak's own SCIM API only reached "preview" status in the 26.x line, so treat it as not-yet-production-hardened for anything critical).

Key operational point often missed: **deprovisioning** matters more than provisioning for a government tool. A departed civil servant with a lingering active account is a bigger real-world risk than a slow onboarding. Build a daily reconciliation job (AD "disabled" flag → Keycloak realm role removal → app session revocation) rather than relying on manual offboarding tickets.

## 4. Passkeys, MFA, sessions, device trust

- **Passkeys/WebAuthn** are now the recommended default second factor: FIDO Alliance data shows 53% of surveyed users have enabled a passkey on at least one account, enterprises report ~81% fewer login-related help-desk tickets and 4x higher sign-in success rates after passkey rollout, and Keycloak 26.x added finer WebAuthn policy controls (`preferred`/`required`/`discouraged` per realm) — good, because a mixed-literacy civil-service workforce needs an escapable policy (`preferred`) at rollout, tightened to `required` for privileged roles once training has happened.
- **Known passkey failure modes** (worth designing around, not just noting): device loss without a registered backup credential locks a user out entirely; users switching from Android to iPhone (common with cheap government-issued phones being swapped) lose synced passkeys unless a password manager with cross-platform sync is standardized; and "not everyone has a smartphone/biometric sensor" is real for older civil servants — always keep a security-key or TOTP fallback path, never passkey-only.
- **Session management** (OWASP guidance): idle timeout 15–30 minutes for a normal-risk internal tool (2–5 minutes only for genuinely high-value actions), absolute session lifetime 4–8 hours matching a workday, `Secure; HttpOnly; SameSite=Strict` cookies (or the `__Host-` prefix), mandatory session-ID regeneration on login/privilege change, and forced re-authentication before sensitive actions (viewing a Restricted HR field, changing another user's role, exporting a report with personal data).
- **Device trust**: not worth building bespoke MDM-style device attestation for a 23-person department; instead rely on IdP-level conditional-access signals Keycloak/Authentik/Zitadel already support (new-device email/Telegram alert, geolocation/impossible-travel flags — Authentik ships this natively) rather than a custom device-registration system.

## 5. Authorization models: RBAC, ABAC, ReBAC — and what Notion/Linear/GitHub actually do

| Model | What it is | Strength | Weakness | Where it fits here |
|---|---|---|---|---|
| **RBAC** | Permissions attached to a role (Director, Head, Employee), role attached to a user | Simple to explain to a first-time civil servant; matches the org chart 1:1 | Coarse — can't express "share just this one project with that one person outside your normal reporting line" without role explosion | The default and primary model — mirrors the org chart already in the reference prototype |
| **ABAC** | Rules evaluated against attributes (department=X AND record.status=draft AND user.clearance≥2) | Expresses nuanced policy without a combinatorial explosion of roles | Policies become hard for non-engineers to audit ("why can't I see this?") — the opposite of the "zero training" goal | Use narrowly: e.g., "Restricted field visible if user.role IN (HR, Director) OR user.id = record.subject_id" — a handful of such rules, not a general policy engine |
| **ReBAC (Zanzibar-style)** | Permissions derived from a relationship graph (user → member_of → team → can_view → project) | Naturally expresses object-level sharing ("I shared this doc with you"), which is exactly the UX Notion/Google Docs/Linear give users | Needs a dedicated engine (OpenFGA, SpiceDB) and graph-thinking most teams over-build for their actual scale | Only for the one place users expect it: ad hoc sharing of an individual project/document outside the org hierarchy. Model this as a lightweight `shares` table (object_id, user_id, permission), not a full Zanzibar deployment, until proven necessary |

**Purpose-built authorization engines**, for context (not recommended at current scale, but worth knowing so the choice not to adopt them is deliberate):
- **OpenFGA** — CNCF project, Zanzibar-inspired, originated at Auth0/Okta, now community-governed; relationship-tuple model, good SDKs, genuinely the reference implementation of "Zanzibar for the rest of us."
- **SpiceDB** (AuthZed) — Apache 2.0, also Zanzibar-inspired, distributed graph engine, pluggable storage (Postgres/MySQL/CockroachDB/Spanner); used by Netflix, Reddit, Calendly at real scale.
- **Permit.io** — hosted policy-as-a-service wrapping RBAC/ABAC/ReBAC with a management UI aimed at giving product teams (not just engineers) a way to edit permissions.
- **Cerbos, Oso** — open-source policy engines (Cerbos: YAML policies, sidecar/PDP model; Oso: embeddable, has pivoted toward a hosted "cloud" authorization product).
- **Casbin** — Apache project (moved under the Apache umbrella), a lighter-weight *embedded library* (not a service) supporting RBAC/ABAC/ACL via its "PERM metamodel," with bindings in essentially every language and built-in LDAP/Okta/Azure-AD role-source adapters. This is the most proportionate choice **if** in-app authorization logic outgrows simple role checks before the platform outgrows a single database — cheaper to adopt than standing up OpenFGA/SpiceDB as a separate service.

**Verdict for this project:** RBAC (org-hierarchy-shaped) + a small `shares` table for object-level exceptions + a handful of hard-coded field-visibility rules covers 95% of the brief. Reach for Casbin only if the rule set genuinely grows past what's comfortable in application code; reach for OpenFGA/SpiceDB only when this platform is serving many tenants with deeply tangled cross-tenant sharing (multi-ministry phase, not now).

### How Notion, Linear, and GitHub keep the "who can see this" problem simple (and where they don't)

- **Notion**: page-level permissions (Full access / Can edit / Can comment / Can view / plus database-specific Can create / Can edit content), surfaced via visible avatar icons at the top of every page (faded = not currently viewing), with three "general access" tiers (invite-only / everyone-at-workspace / anyone-with-link, the last with expiring links). **Documented failure mode, straight from Notion's own help center: "Notion respects the broadest level of access given to a user"** — i.e., a workspace-wide permission silently overrides a narrower page-level restriction. This is the single most-cited Notion permission complaint and a direct lesson: *the most permissive grant anywhere in the chain wins, and that must be surfaced to the user setting a restriction, or they will believe something is private when it isn't.* Also notable: database-level page permissions are Business/Enterprise-plan-gated, i.e., Notion treats fine-grained permission as a monetization lever, which is a trap to avoid in a gov tool — permission granularity should never depend on a paid tier here since there's only one tenant tier internally.
- **Linear**: keeps permissions to a small fixed set of workspace roles (Admin, Member, Guest) plus per-team membership, deliberately avoiding page-by-page ACLs — Linear's product philosophy is that most of an org should see most of the org's work, and privacy is the exception (private teams/projects), not the default. This is closer to the right instinct for a government department where transparency across the 4 sub-departments is a feature, not a risk — default to "everyone in the department can see everyone else's projects," and treat "restricted" as an explicit, visible flag on the rare item that needs it, not a permission you configure per-object as a matter of course.
- **GitHub**: three-tier model (organization roles → repository roles → team roles), with a small set of purpose-named predefined roles (Owner, Member, Billing manager, Security manager, Moderator) covering the 90% case, and custom roles reserved for Enterprise customers who need more. The lesson: **name roles by job function, not by permission bitmask** — "Billing manager" is instantly understandable, "role with scopes billing:read,billing:write" is not.

## 6. Field-level permissions: the "restricted HR fields" problem

The reference audit's own banner ("dates of birth and personal contact details should be visible only to authorized HR and managers") is the concrete requirement. Model it as a **field visibility tier** on the People/Employee record, not a parallel HR system:

- **Public**: name, position, sub-department, work email, work phone, photo — visible to anyone logged in, including other-tenant guests if this ever goes multi-tenant.
- **Internal**: education, start date, current assignments/workload — visible department-wide, hidden from other tenants.
- **Restricted**: date of birth, personal phone/address, salary band (if ever added), passport/PINFL data — visible only to: the employee themself, their direct manager (Head of their sub-department), HR/Director, and logged as a read event every time.

Implementation pattern: store the tier as metadata per field in the schema (not per-record), evaluate visibility at the API/query layer (never filter client-side only — a client-side hide is not a security control), and every Restricted-field read writes an audit row (who viewed whose restricted data, when) — this single feature directly answers "who viewed sensitive data," which is explicitly called for in the brief and already promised in the reference prototype's own roadmap language ("log who viewed/changed sensitive data").

## 7. Hierarchical permissions and delegation/acting-in-place

Map permission scope directly to the org chart already established: **Director sees everything; Head of Sub-department sees their unit (people, projects, activities); Employee sees their own record fully and everyone else's Public/Internal fields plus whatever projects they're a member of.** This requires no special engine — it's a recursive "does viewer's org-node contain target's org-node" check against the same organization tree the reference prototype already renders.

**Delegation / acting-in-place** (deputy while on leave) is the one genuinely tricky UX/data-model problem in this brief, because most RBAC systems assume a static role assignment. The clean pattern (used in variants by Google Workspace admin delegation and enterprise HR systems): a **time-boxed delegation grant** — `(grantor_user_id, delegate_user_id, scope = grantor's role, starts_at, ends_at, reason)` — that the delegate can activate/see during the window, is fully visible to both parties and to the Director (no silent impersonation), auto-expires without manual cleanup, and is itself an audit-logged event both when granted and when *used* (i.e., log "employee actions taken by delegate X on behalf of Y" distinctly from actions Y took themselves, so post-hoc review is never ambiguous about who actually clicked the button).

## 8. Audit logging, data classification, encryption, secrets

**What to log** (OWASP Logging Cheat Sheet, directly applicable): authentication successes/failures, authorization denials, admin/privilege changes, all reads and writes of Restricted-tier fields, exports/downloads, and delegation grant/use events. **What never to log**: passwords, tokens/session IDs, raw PINFL/passport numbers, full DOB in plaintext in a general app log (log "restricted field X of user Y viewed by Z," not the field's value). **Tamper-evidence**: append-only log table (no UPDATE/DELETE grants for the app's normal DB role), periodic hash-chaining or export to WORM/read-only storage, and access-to-the-logs is itself logged. **Retention**: keep only as long as legally required/useful — indefinite retention of access logs about personal data is itself a data-minimization problem under Uzbekistan's personal data law, so set an explicit retention period (commonly 1–3 years for access logs in comparable regimes) rather than "forever."

**Data localization** is not optional: Uzbekistan's law (in force since April 2021) requires personal data of Uzbek citizens processed via IT to be collected, systematized, and stored on technical infrastructure physically located inside Uzbekistan, in a database registered with the Personalization Agency (under the Ministry of Justice, successor to the State Personalization Centre); non-compliance leads to being placed on an infringers' register and site-blocking, with fines up to roughly $1,450 for officials and criminal penalties, including imprisonment, for repeat/serious violations. **This single fact eliminates any SaaS IdP or database hosted outside Uzbekistan for the production system of record** — Keycloak/Zitadel/Authentik must run on servers physically in-country (gov-cloud or on-prem), and the People-record database must be registered in the State Register of Personal Databases before go-live. A handful of narrow database categories (name-only lists, non-automated records, pure employment records) are exempted — verify with legal counsel whether the People module's specific field set qualifies for any exemption before assuming full registration is mandatory.

**Encryption**: TLS everywhere in transit (non-negotiable, free via Let's Encrypt or gov-CA certs); at rest, disk/volume-level encryption plus column-level encryption specifically for Restricted-tier fields (DOB, personal contact, any future passport/PINFL data) so a raw DB dump or backup theft doesn't expose them in plaintext. **Secrets management**: never hard-code IdP client secrets or DB credentials — use a vault (HashiCorp Vault, or even a cloud-native secrets manager if the gov-cloud offers one) with rotation, not `.env` files committed anywhere near source control.

## 9. Standards and compliance posture

- **OWASP ASVS 5.0** — released 30 May 2025 at Global AppSec EU Barcelona (RC1 was March 2025); the most current version to build against, with a `chapter.section.requirement` numbering scheme, and available translated into Russian among other languages (useful given the bilingual Uzbek/Russian government context — cite the Russian ASVS text when briefing local security reviewers). Use ASVS Level 1 as an absolute minimum bar, Level 2 as the realistic target for anything holding personal data (which is everything in this platform), reserving Level 3 for anything resembling a national digital-ID or payment integration.
- **OWASP Top 10** — a 2025 edition exists (confirmed via Wikipedia's OWASP history) and, notably, **introduced software-supply-chain failures as a new category** — directly relevant to the SBOM/dependency-scanning ask in this brief; the exact ranked list of the 2025 edition could not be independently confirmed from the sources reachable during this research (see Open Questions) — verify the final category list directly at owasp.org/Top10/2025 before using it in a security checklist.
- **ISO/IEC 27001** — the internationally recognized ISMS standard; its Annex A control set (access control, cryptography, logging and monitoring, supplier/vendor relationships, incident management) maps closely onto everything above, and matters practically here because **Zitadel already advertises ISO 27001 + SOC2 Type II certification** as a trust signal — if a future phase evaluates any hosted component, ISO 27001 certification of the vendor is a reasonable minimum bar to require.
- **Uzbekistan-specific state information system rules**: state information systems in Uzbekistan are subject to mandatory certification/attestation requirements administered through the cybersecurity agency structure (the State Inspection on Informatization and Telecommunication is the compliance-monitoring body referenced in the data-localization law); Uzbekistan has also been adapting ISO security standards into national O'zDSt equivalents. **This research could not obtain the current, citable text of the specific state-system certification/attestation procedure** — this is a decision-blocking gap; see Open Questions.
- **Supply chain / SBOM**: CISA (US) treats SBOM as a foundational supply-chain transparency mechanism and references a "2025 Minimum Elements for SBOM" guidance document; the two dominant machine-readable formats in the broader industry are SPDX and CycloneDX (both were not independently re-confirmed via a fetched 2025/2026 source in this research pass — treat as background knowledge, verify current format guidance before mandating one). Practically: run `npm audit`/`pip-audit`/Dependabot or Trivy in CI, generate an SBOM on every release build even if no regulator asks for it yet — cheap now, expensive to retrofit later, and increasingly expected of any government-adjacent software vendor internationally.

## 10. One-screen permission model proposal

A model simple enough to draw as a single settings screen:

```
ROLES (fixed, org-shaped — matches the org chart exactly)
  Director        → sees everything, every tenant admin action
  Head of Unit     → sees their sub-department's people/projects/activities fully
  Employee         → sees own record fully + org-wide Public/Internal fields
                      + full access to projects they're a member of
  (Guest — future) → read-only, scoped to explicitly shared objects only, for
                      cross-ministry collaboration once multi-tenant

FIELD TIERS (attached to schema fields, not records)
  Public    → any logged-in user, any tenant
  Internal  → any logged-in user, same tenant only
  Restricted→ self, direct manager, Director, HR — every read is audit-logged

OBJECT SHARING (the ReBAC-lite exception layer)
  Any project/document can be explicitly shared with one more person
  or unit outside the default hierarchy view — modeled as a simple
  (object, grantee, permission: view|comment|edit) row, shown as
  avatar stack + "Shared with..." exactly like Notion/Google Docs,
  but WITHOUT Notion's "broadest access wins silently" trap: the UI
  always shows the *effective* combined access, not just the explicit share.

DELEGATION (acting-in-place)
  (grantor, delegate, scope = grantor's role, starts_at, ends_at)
  time-boxed, visible to both + Director, auto-expires, every delegated
  action logged as "X acting for Y".
```

This is deliberately five moving parts (roles, field tiers, object shares, delegation, audit log) — small enough to explain to a first-time civil servant in one onboarding screen, and expressive enough to cover every scenario in the brief without a policy engine.

## What this means for us

1. **[ADOPT]** Self-host Keycloak 26.x as the single IdP for all tenants (one realm per ministry/department) — most mature option, native LDAP/AD federation, in-country deployable, satisfies data localization.
2. **[ADOPT]** RBAC mirroring the existing org chart (Director/Head/Employee) as the default and only model most users ever notice — it needs zero explanation because it's the org chart they already know.
3. **[ADOPT]** Field-level visibility tiers (Public/Internal/Restricted) on the People record, enforced server-side, with mandatory audit logging of every Restricted-field read — this is the highest-leverage feature in the whole brief and is explicitly requested by the reference prototype's own banner text.
4. **[ADOPT]** Passkeys/WebAuthn as the primary MFA method via the IdP, with `preferred` (not `required`) at rollout and TOTP/security-key fallback always available — matches 2026 best practice and avoids locking out less tech-literate staff.
5. **[ADOPT]** A lightweight object-sharing table (project/document → grantee → permission) as the only "ReBAC" needed at this scale, modeled on Notion/Google Docs sharing UX but fixing Notion's documented flaw by always showing *effective* access, never letting a broader grant silently override a narrower one without saying so.
6. **[ADOPT]** Time-boxed delegation grants for acting-in-place (deputy while on leave), with every delegated action logged distinctly from the delegate's own actions — this is the one place the brief needs a genuinely custom data model, not an off-the-shelf pattern.
7. **[ADAPT]** Federate Uzbekistan's OneID into Keycloak as a secondary identity broker for future citizen-facing or PINFL-verification features — do not make it the primary employee login path, since it is designed for citizen-to-government auth, not staff SSO, and its integration spec is not fully public.
8. **[ADAPT]** Use Authentik's reverse-proxy SSO mode (not as the primary IdP) specifically to retrofit any legacy, currently-unauthenticated ministry intranet tool the department needs to link into this platform, rather than rewriting those tools.
9. **[AVOID]** Do not adopt a Zanzibar-style authorization service (OpenFGA, SpiceDB) or a policy-as-a-service product (Permit.io) at current scale (~23 people, one tenant) — they solve a scaling problem this platform does not have yet and add an operational dependency and a second system of truth for permissions that will confuse, not simplify, the "zero training" goal.
10. **[AVOID]** Do not use a SaaS-hosted IdP or database (Auth0, Clerk, WorkOS, Zitadel Cloud, Firebase) for anything holding real employee personal data — Uzbekistan's data-localization law makes this a compliance violation, not just a preference.
11. **[AVOID]** Do not gate permission granularity behind a pricing tier the way Notion does (database-level permissions on Business/Enterprise only) — there is one internal tenant tier; field- and object-level permission must be uniformly available.
12. **[ADAPT]** Borrow GitHub's naming discipline: name every role and permission after a job function ("Head of Unit," "HR viewer") never after a technical scope string — this is a cheap, high-leverage UX decision for the zero-training goal.
13. **[ADOPT]** Append-only, access-logged audit trail from day one (auth events, authorization denials, admin actions, Restricted-field reads, delegation use) with a defined retention window (not indefinite) — required by both OWASP guidance and the spirit of Uzbekistan's data-minimization expectations.
14. **[ADOPT]** Bake SBOM generation and dependency scanning (Trivy/Dependabot or equivalent) into CI from the first release, even before any regulator asks — OWASP's 2025 Top 10 added supply-chain failures as a named category, and retrofitting this later is far more expensive than starting with it.
15. **[ADAPT]** Target OWASP ASVS 5.0 Level 2 as the concrete security bar for this system (Level 1 is too low given it holds citizen-adjacent employee PII; Level 3 is overkill unless a future phase does national digital-ID or payment integration) and use the Russian-language ASVS translation when briefing local reviewers.

## Open questions

1. **OneID/ONEST integration spec**: the public onest.uz endpoint could not be reached during this research, and no authoritative public technical document (OIDC discovery URL, scopes, PINFL claim format) was found. Someone with an existing relationship to the E-Government Development Center (or a current My.gov.uz integration contract) needs to obtain the actual integration guide before any OneID work is scoped.
2. **Uzbekistan state information system certification/attestation procedure**: this research could not obtain a citable, current description of the mandatory certification process for state information systems (which body certifies, what technical controls it checks, timeline/cost). This is likely to gate go-live and should be confirmed with the ministry's own IT security office before architecture is finalized.
3. **Exact O'zDSt (Uzbek national standard) mappings from ISO 27001/27002**: referenced as existing in general knowledge but not independently verified with a current source in this pass — confirm which O'zDSt documents are mandatory for a Ministry of Digital Technologies internal system specifically.
4. **Whether the People module's field set triggers full State Register of Personal Databases registration** or qualifies for one of the law's narrow exemptions (name-only lists, non-automated processing, employment-records exemption) — needs a legal/compliance read, not an engineering guess.
5. **OWASP Top 10:2025's exact ranked category list** — confirmed to exist and to add a supply-chain category, but the full ordered list was not independently fetched in this research pass; verify directly at owasp.org before using it as a literal checklist.
6. **Whether this platform's ambition to "go viral" across other ministries** implies it will eventually need to be its own OIDC provider for other departments' tools (i.e., become an identity platform, not just a client) — if so, Ory's headless stack or Zitadel's organization model becomes far more relevant than currently scoped, and this should be revisited once the multi-tenant ambition is prioritized.
7. **SPDX vs CycloneDX** as the SBOM format of choice was not confirmed against a live 2025/2026 source in this pass; either is broadly acceptable industry-wide as of this writing, but confirm against current CISA/NTIA guidance if a formal procurement requirement emerges.

## Sources

- [Keycloak 26.7.0 release notes](https://www.keycloak.org/docs/latest/release_notes/index.html)
- [Zitadel pricing and features](https://zitadel.com/pricing)
- [Authentik — self-hosted identity provider](https://goauthentik.io/)
- [Better Auth — TypeScript auth framework](https://www.better-auth.com/)
- [OpenFGA documentation — getting started](https://openfga.dev/docs/getting-started)
- [OWASP Application Security Verification Standard project page](https://owasp.org/www-project-application-security-verification-standard/)
- [OWASP (Wikipedia) — Top 10 history and 2025 edition](https://en.wikipedia.org/wiki/OWASP)
- [Ory documentation — welcome/product overview](https://www.ory.com/docs/welcome)
- [Apache Casbin — authorization library](https://casbin.apache.org/)
- [AuthZed SpiceDB overview](https://authzed.com/spicedb)
- [DLA Piper Data Protection Laws of the World — Uzbekistan](https://www.dlapiperdataprotection.com/index.html?t=law&c=UZ)
- [Notion Help Center — sharing and permissions](https://www.notion.com/help/sharing-and-permissions)
- [FIDO Alliance — passkeys](https://fidoalliance.org/passkeys/)
- [CISA — Software Bill of Materials](https://www.cisa.gov/sbom)
- [OWASP Cheat Sheet Series — Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
- [OWASP Cheat Sheet Series — Logging](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html)
- [GitHub Docs — roles in an organization](https://docs.github.com/en/organizations/managing-peoples-access-to-your-organization-with-roles/roles-in-an-organization)
- [Wikipedia — E-Residency of Estonia](https://en.wikipedia.org/wiki/E-Residency_of_Estonia)
- Reference prototype audit: `docs/00-reference/reference-site-audit.md` (internal)
- [Keycloak Server Administration Guide — Mitigating security threats (brute force detection)](https://www.keycloak.org/docs/latest/server_admin/index.html#_brute_force)
- [Keycloak — Export and Import (realm backup/migration)](https://www.keycloak.org/server/importExport)
- [Keycloak Server Administration Guide — SAML v2.0 clients and identity brokering](https://www.keycloak.org/docs/latest/server_admin/index.html#saml-clients)
- [Better Auth blog — joining Vercel, 7 July 2026](https://www.better-auth.com/blog)
- [OWASP Cheat Sheet Series — Authentication](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
- [Telegram Bot API — Bot features (inline keyboards, deep linking, login widget)](https://core.telegram.org/bots/features)
- [DLA Piper Data Protection Laws of the World — Uzbekistan, data subject rights and enforcement](https://www.dlapiperdataprotection.com/index.html?t=data-subject-rights&c=UZ)
- [GDPR Article 15 — Right of access by the data subject](https://gdpr-info.eu/art-15-gdpr/)

## Editor's verification notes (auth-permissions-security-compliance)

### 1. Spot-check of 5 consequential claims (WebFetch, this pass)

| # | Claim in report | Result | Detail |
|---|---|---|---|
| 1 | "Better Auth ... was acquired by Vercel in 2025" (§1, embedded auth libraries) | **CORRECTED — date wrong** | Better Auth's Vercel acquisition was announced **July 7, 2026**, not 2025. What the report has right is the substance (Better Auth did join Vercel) and the strategic read (it's becoming the default Next.js-ecosystem auth answer) — but the year is wrong, and the report omits a more relevant 2025 fact: Better Auth raised a **$5M seed round in June 2025** (led by Peak XV Partners) *before* the acquisition, which is arguably the more decision-relevant 2025 data point (funded independent trajectory vs. already-acquired). Since this report is dated as researched in 2026, "acquired ... in 2025" reads as a plain factual error rather than a stale-as-of-writing note — fix the year to 2026 and consider adding the funding round for context. |
| 2 | Keycloak 26.7.0 is current; SCIM is preview/disabled-by-default; WebAuthn policy supports `required`/`preferred`/`discouraged`; Organizations feature supports delegated admin roles | **CONFIRMED** | Keycloak's own 26.7.0 release notes verify all four sub-claims verbatim (SCIM API "promoted to a preview feature," WebAuthn discoverable-credential values, organization-scoped `manage-organizations`/`view-organizations` roles). No corrections needed here. |
| 3 | OWASP ASVS 5.0 released 30 May 2025 at Global AppSec EU Barcelona, available in Russian translation | **CONFIRMED** | OWASP's own project page confirms the 30 May 2025 Barcelona release and lists Russian among the available translations (also Turkish, French, Korean, Brazilian Portuguese, Indonesian). |
| 4 | Zitadel pricing: Free (100 DAU) → $100/mo (25k DAU) → custom enterprise; ISO 27001 + SOC2 Type II certified | **CONFIRMED** | Zitadel's pricing page matches exactly: Free/$0 at 100 DAU, Pro/$100 at 25,000 DAU, Enterprise custom with self-hosted option; ISO 27001 and AICPA SOC2 Type II badges both confirmed on the same page. |
| 5 | FIDO passkey stats: 53% of surveyed users enabled a passkey on ≥1 account; ~81% fewer login help-desk tickets; ~4x higher sign-in success | **CONFIRMED** (with one attribution nuance) | FIDO Alliance's own passkeys page confirms all three figures. Nuance not in the original report: the 4x sign-in-success figure is specifically **Google's** reported number, and the 81% help-desk reduction and 53% survey figure are aggregate/independent-survey stats rather than a single source — worth citing per-company (Google, Amazon "6x faster," CVS Health "98% fraud reduction," Air New Zealand "50% less abandonment") rather than as one undifferentiated bullet, since a security reviewer will ask "whose number is this."

**Net:** 4 of 5 spot-checked claims confirmed outright; 1 (Better Auth/Vercel timing) is a **material date correction** — material because the report's own framing explicitly values "note version numbers and dates" and uses the acquisition as evidence of a 2025-in-progress trend, when it actually only became true in mid-2026.

### 2. Missing, thin, or hand-waved topics from the brief

1. **"Right-to-access logs" (data-subject access to their own audit trail) — thin.** The brief asks for this explicitly. The report covers *who-viewed-sensitive-data logging* (§8) thoroughly but never addresses the mirror-image requirement: can an employee themselves **request or see the log of who viewed their own Restricted-tier fields**? This is a distinct feature (a "who looked at my record" self-service view) from the admin-side audit trail, and it's a natural extension of the field-tier model already proposed in §6/§10 — a one-line addition ("employee can see a read-only list of who accessed their Restricted fields and when") would close this.
2. **Secure-by-default deployment checklist — absent as a discrete artifact.** The brief explicitly asks for one. The report has all the individual ingredients scattered across §4, §8, §9 (session cookie flags, TLS, secrets vault, ASVS level) but never assembles them into the checklist format the brief asked for (e.g., a go-live gate: TLS everywhere / secrets in vault not `.env` / MFA enforced for privileged roles / audit log append-only verified / SBOM generated / dependency scan clean / data-localization registration filed / session cookie flags verified / default admin credentials rotated). This is a synthesis gap, not a missing-fact gap — worth a short closing checklist since it's explicitly requested output shape.
3. **SAML — present only as a table cell, never discussed as a scenario.** Every IdP comparison row lists "SAML2" as a supported protocol, but the report never explains *when* SAML would actually be needed here (typically: a legacy ministry system, or a partner ministry's existing IdP, that only speaks SAML and can't be upgraded to OIDC) or how Keycloak brokers between an OIDC-native app and a SAML-only upstream/downstream. Given the reference audit describes exactly the kind of legacy-intranet-system integration this would apply to, this is a real gap, not a nice-to-have.
4. **Data classification as a general concept — narrower than asked.** The brief asks for "data classification" as its own topic; the report only ever instantiates it as the three People-record field tiers (Public/Internal/Restricted). It never addresses classification of *non-People* data — projects, documents, and reports may also warrant a classification tag (e.g., an EGDI strategy memo marked "internal" vs. a document meant for a foreign delegation) independent of the People-record schema. Worth at least a paragraph noting the same tier vocabulary should extend to documents/projects, not just employee fields.
5. **Incident response / breach notification — absent.** Not mentioned anywhere: what happens when a Restricted-field leak or account compromise is discovered — is there a breach-notification obligation under Uzbek personal-data law (analogous to GDPR's 72-hour rule), who is notified internally, is there an incident runbook. This is a standard adjacent topic any senior engineering/security lead would expect next to audit logging and data classification, and it's especially relevant given the report already flags Uzbekistan's data-localization law as a hard legal constraint — the same law almost certainly has a breach-notification counterpart worth flagging as an open question if not confirmable.
6. **Backup/disaster-recovery and rate-limiting/anti-brute-force/WAF — absent.** Two adjacent hardening topics a security reviewer would expect near "secrets management" and "session management": (a) backup and recovery posture for the IdP itself (Keycloak realm export, database backup/restore drill — losing the IdP means losing access to everything) and (b) basic anti-abuse controls (login rate-limiting/lockout policy, WAF or reverse-proxy protection) which OWASP ASVS Level 2 (the report's own recommended bar) explicitly requires and which the report never operationalizes.
7. **Telegram as a security/notification channel — not explored, despite project context calling it the dominant messenger in Uzbekistan.** The report mentions "new-device email/Telegram alert" once in passing (§4) but never treats Telegram as a first-class MFA/notification channel to design around — e.g., a Telegram bot for login approval pushes, suspicious-access alerts, or delegation-grant notifications would likely land far better with civil servants than email, given the stated local context. This is a genuinely local, high-leverage idea the report leaves on the table.

### 3. Verdict basis

5 of 7 identified issues are separate topical gaps (right-to-access logs, secure-by-default checklist, SAML scenario depth, document-level data classification, incident response, backup/DR + anti-abuse, Telegram channel) — well past the 3-gap threshold — plus one material date correction (Better Auth/Vercel: 2025 claimed vs. actual July 2026). Coverage of the brief is otherwise strong (the IdP comparison, RBAC/ABAC/ReBAC framing, field-tier model, delegation pattern, and one-screen proposal are all genuinely good work), so this is a "fix and extend," not a "redo," situation.

**Research note on methodology:** this session's web-search budget was exhausted by concurrent research before this dimension could run its own search queries (a shared per-session limit across parallel research agents); the findings above were gathered instead via 18 direct WebFetch requests against primary/vendor documentation (14 succeeded, 4 returned 404/redirect/blocked and are not cited). Several claims that would normally be triangulated via multiple independent search results (OneID's exact protocol, the OWASP Top 10:2025 ranked list, Uzbekistan's state-system certification procedure) could not be independently corroborated and are flagged in Open Questions rather than stated as fact.

## Gap-fill addendum

Written in a follow-up pass to close the 7 gaps and 1 correction identified above. **Same methodology constraint applied again**: this session's WebSearch budget was already exhausted session-wide (all 6 queries attempted for this pass returned "web search budget... 200 of 200 WebSearch calls" with zero results) — every finding below comes from 10 direct WebFetch reads against primary sources (Keycloak's own docs, Better Auth's own blog, OWASP's Cheat Sheet Series, Telegram's own Bot API docs, DLA Piper's Uzbekistan page, and gdpr-info.eu), not from search-engine triangulation. Treat single-source claims accordingly and re-verify before treating any of them as a procurement-grade citation.

### G1. Right-to-access logs: a self-service "who viewed my record" view

The brief explicitly asks for this; §8 only ever specifies the *admin-side* audit log (who viewed whose Restricted field). The employee-facing mirror is a distinct, cheap feature, not a new system:

- **Legal baseline is lower than you'd expect.** Uzbekistan's Law on Personal Data grants a data subject only the right to "request the owner/operator to provide him/her with information about processing of his/her data" and to be notified within 3 days when their data is transferred to a third party (DLA Piper, confirmed by direct fetch of the Uzbekistan data-subject-rights page) — it does **not** establish a right to see an access log of *who specifically viewed* the record, the way GDPR Article 15 obliges a controller to disclose "the recipients or categories of recipient to whom the personal data have been or will be disclosed" (confirmed by direct fetch of the GDPR Article 15 text). So building this feature exceeds the Uzbek legal minimum — it's a trust-building UX choice, not a compliance checkbox, and should be marketed internally that way ("you can always see who looked at your file" is exactly the kind of feature that helps a civil-service tool "go viral" on trust rather than mandate).
- **Zero new infrastructure required.** The append-only Restricted-field-read audit log already proposed in §8/§10 is the entire data source — the self-service view is just a scoped read query (`WHERE subject_id = current_user.id`) rendered on the employee's own profile page as "Recently viewed by," showing viewer name/role, field name (never the value), and timestamp. Building the audit table with this second consumer in mind from day one (i.e., making `subject_id` a first-class indexed column, not an afterthought) costs nothing extra now and a real migration later.
- **Precedent worth studying, not yet re-verified this pass:** Estonia's X-Road-based government services are widely cited as letting citizens see which official/agency queried their state-held records — the closest public-sector analog to what's being proposed here. This wasn't independently re-fetched in this pass (out of scope for the query budget) — treat as background knowledge to validate before citing externally, but directionally it's the right reference point for a "the log itself is a citizen-facing trust feature" government pattern.
- **Scope guard:** show the log to the employee themself and, per the existing hierarchy, their manager/Director/HR should already have equivalent visibility via the admin audit trail — do not build a *third*, separate log; one table, two filtered views.

### G2. Secure-by-default deployment checklist

The brief asked for this as a discrete artifact; the report had every ingredient scattered across §4/§8/§9 but never assembled them. Here is the go-live gate, grouped so an ops person can run it top to bottom before flipping the switch on a new tenant or environment:

```
IDENTITY & ACCESS
  [ ] Keycloak realm created per-tenant, default admin credentials rotated
      (never left as admin/admin — the single most common self-hosted-IdP
      compromise vector)
  [ ] Passkeys/WebAuthn enabled `preferred`; TOTP/security-key fallback works
  [ ] Brute-force detection ON: temporary lockout (not permanent — see G6),
      with working "forgot password" path that functions even while locked
  [ ] MFA `required` (not just `preferred`) for Director/HR/Head-of-Unit roles
  [ ] Session cookies: Secure; HttpOnly; SameSite=Strict (or __Host- prefix),
      idle timeout 15–30 min, absolute lifetime 4–8 hrs

TRANSPORT & STORAGE
  [ ] TLS enforced everywhere, HSTS on, no plain-HTTP listener reachable
  [ ] Disk/volume encryption on; column-level encryption on Restricted fields
  [ ] Production database physically hosted inside Uzbekistan (data
      localization) and registered in the State Register of Personal
      Databases (or exemption confirmed by legal counsel) before go-live

SECRETS
  [ ] No secrets in .env files, source control, or CI logs — vault-backed
      (HashiCorp Vault or gov-cloud equivalent) with rotation configured
  [ ] IdP client secrets, DB credentials, and any Telegram bot token stored
      in the same vault, not hard-coded

NETWORK / ANTI-ABUSE (ASVS L2's requirement, see G6)
  [ ] Reverse proxy or WAF in front of Keycloak and the app for IP-level
      rate limiting, layered on top of Keycloak's account-level lockout
  [ ] Admin console(s) not exposed on the public internet without an
      additional network control (VPN, IP allowlist, or separate hostname)

LOGGING & AUDIT
  [ ] Audit log table confirmed append-only (app DB role has no UPDATE/
      DELETE grant on it)
  [ ] Restricted-field reads, admin actions, and delegation grants/uses all
      write audit rows in staging before go-live (verified, not assumed)
  [ ] Retention window set explicitly (not "forever")

SUPPLY CHAIN
  [ ] SBOM generated for the release build
  [ ] Dependency scan (Trivy/Dependabot/pip-audit/npm audit) clean or
      triaged, wired into CI so it re-runs on every deploy

BACKUP / DISASTER RECOVERY (see G6)
  [ ] Keycloak's underlying database has real backups (point-in-time
      recovery), independent of realm JSON export
  [ ] A restore has actually been test-run at least once before go-live —
      an untested restore procedure is not a disaster-recovery plan

LEGAL / COMPLIANCE
  [ ] ASVS Level 2 self-assessment done (Level 1 is insufficient given
      the platform holds citizen-adjacent employee PII)
  [ ] Ministry IT security office sign-off obtained (state information
      system certification/attestation — see Open Question #2)
```

This is deliberately ordered so "identity" and "storage" — the two things a data-localization/PII audit will check first — come before the more standard app-security items.

### G3. SAML as a concrete scenario, not just a table cell

Every IdP in §1's comparison table lists SAML2 support, but the report never says *when* it actually gets used. Confirmed via a direct fetch of Keycloak's own SAML documentation, Keycloak supports SAML in **two directions**, and both map onto a real scenario for this project:

1. **Keycloak as the SAML identity provider (downstream)** — a legacy ministry intranet application that only understands SAML 2.0 and cannot be rewritten to speak OIDC gets registered as a SAML "client" (service provider) inside the Keycloak realm. Keycloak issues it SAML assertions while everything else in the platform talks OIDC to Keycloak — the legacy app never has to change, and it still benefits from the same passkey/MFA policy and audit trail as every OIDC client. This is the "wrap the old ministry system" scenario the reference audit's own description of legacy systems implies.
2. **Keycloak brokering an upstream SAML identity provider** — a partner ministry that already runs its own IdP (ADFS, a legacy on-prem SAML IdP, or another agency's Keycloak/Shibboleth deployment) and will only expose SAML metadata, not an OIDC discovery endpoint. Keycloak's Identity Brokering feature registers that partner IdP as an upstream login option ("Login with Ministry of X"), mapping SAML assertion attributes into Keycloak's own claims — so a partner-ministry employee can access a shared cross-ministry project without ever getting an account provisioned in this platform's own realm.

**[ADOPT]** Treat SAML support as Keycloak's answer to exactly two situations — a legacy app that can't be upgraded, and a partner IdP that can't be upgraded — and never as a protocol choice for anything new inside this platform, where OIDC should be the default end to end.

### G4. Data classification beyond People fields: documents and projects

The brief asked about data classification generally; the report only ever instantiated it as the three People-record field tiers (Public/Internal/Restricted, §6). That vocabulary should extend to non-People objects, because the reference audit's own Projects register will hold exactly the kind of material that needs it — an EGDI strategy memo meant for internal use only, versus a document prepared for a foreign delegation or public release, versus a draft ranking analysis that shouldn't leak before publication.

- **Reuse the same three-tier vocabulary** (Public / Internal / Restricted) as a single classification tag on the Project and Document object types, rather than inventing a second taxonomy — one vocabulary across the whole platform is a direct extension of the "zero training" goal already served by the People-field tiers.
- **Keep it at object granularity, not field granularity, for documents/projects** — unlike People records, a project or document doesn't need per-field visibility rules; a single classification tag on the object (shown as a visible badge, the way Notion/Google Drive show a "Restricted" or "shared" icon) is sufficient and far simpler to reason about.
- **Explicitly out of scope:** national-security-grade classification (secret/top-secret regimes under Uzbekistan's separate state-secrecy legal framework) is a different legal and technical regime entirely and should never be modeled inside this platform — if a document genuinely needs that level of protection, it does not belong in a departmental work-tracking tool at all, regardless of what tier you'd tag it.
- ISO/IEC 27002's information-classification control (the successor to the older "asset classification" control, now folded into control 5.12 in the 2022 revision) is the standard reference for why classification should be an asset-level property independent of *where* the asset lives — this project's People-field tiers are one instance of that general principle, not the whole of it; a document sitting in the Projects module needs the same discipline. (This control's exact 2022 wording was not independently re-fetched this pass — cite it as background, verify exact text before using in a formal ISMS document.)

### G5. Incident response / breach notification

This is the one gap where the research **overturns an assumption** rather than fills a blank. A direct fetch of DLA Piper's Uzbekistan data-protection page states plainly: **"There is no requirement on breach notification under the Law on Personal Data."** There is no GDPR-style 72-hour regulator-notification clock in Uzbek law today. What the law does provide is narrower and reactive: on a confirmed violation, "the owner/operator of personal data must suspend processing of personal data or destroy them," and the Personalization Agency can issue binding corrective orders — but nothing that obliges proactively telling a regulator or the affected employees that a breach happened.

That is not a reason to skip incident response — it's a reason to build it as a deliberate internal-best-practice choice rather than a compliance-driven one, and to say so plainly to stakeholders (the absence of a legal mandate is itself a fact worth stating, not silently assuming away):

- **[ADOPT]** A lightweight internal incident-response runbook, modeled on the GDPR-style shape even though it's not legally required here: detect → contain (revoke sessions, rotate the relevant secret/credential) → assess scope using the existing append-only audit log (which Restricted-tier records, which users, over what window) → internal notification chain (IT security lead, then Director) → decide case-by-case whether affected employees are told → post-incident review logged the same way a delegation-use event is logged.
- **[ADOPT]** Treat "no legal breach-notification duty today" as a fact to state explicitly to the ministry's IT security office and Director, not as license to have no plan — a flagship platform that "goes viral" across government carries reputational exposure a small internal tool wouldn't, and the absence of a legal floor makes an internal ceiling more important, not less.
- **Open question carried forward:** whether the 2022 regulation on "levels of protection of personal data during processing" (referenced in §9 but not independently re-fetched) imposes any breach-adjacent obligation more specific than the base Law on Personal Data — confirm with counsel before finalizing the runbook's assumptions.

### G6. Backup/DR for the IdP, and rate-limiting/anti-brute-force/WAF

Two adjacent hardening gaps, both things ASVS Level 2 (the report's own recommended bar) expects and neither of which the original report operationalized.

**Backup/disaster recovery for Keycloak itself.** A direct fetch of Keycloak's own export/import documentation is unambiguous: **"The import / export process has limitations to be used as a backup and restore mechanism."** Realm JSON export excludes user/admin events, active sessions, and revoked-token state; the admin-console export path can't even export users; and "consistency of an export is not guaranteed unless all Keycloak nodes are stopped prior to running the export" — i.e., a live export taken while the IdP is serving traffic is not a trustworthy backup. Practical implication: losing the IdP means losing the ability to authenticate into *everything* on the platform, so treat it with the same seriousness as the primary application database.
- **[ADOPT]** Back up Keycloak's underlying database (Postgres) with standard point-in-time-recovery tooling — that is the real backup, not the realm-export JSON.
- **[ADAPT]** Keep realm-export JSON around anyway, but purely as a portable *configuration snapshot* for standing up a new environment or migrating a tenant — never label it "the backup" in any runbook.
- **[ADOPT]** Actually run a restore drill before go-live and at a fixed interval afterward (quarterly is reasonable at this scale) — an untested restore procedure is not a disaster-recovery plan, it's a hope.

**Rate limiting / anti-brute-force / WAF.** Keycloak ships native brute-force detection (confirmed via direct fetch of its admin guide): permanent lockout, temporary lockout, permanent-lockout-after-repeated-temporary-lockouts, and a separate lockout policy for repeated *second-factor* failures. But OWASP's own Authentication Cheat Sheet (fetched directly) flags the trap in using **permanent** lockout: "care must be taken to prevent [lockout] from being used to cause a denial of service by locking out other users' accounts," and recommends keeping a working password-reset path available even while an account is locked, plus preferring **exponential backoff** (lockout duration starts short, e.g. one second, and doubles per failure) over one fixed lockout window.
- **[ADOPT]** Configure Keycloak's brute-force detection as **temporary lockout with exponential backoff**, not permanent lockout — a colleague who knows another employee's username should never be able to permanently lock them out just by typing the wrong password repeatedly.
- **[ADOPT]** Keep the forgot-password flow functional even for a temporarily locked account, per the OWASP cheat sheet's explicit mitigation.
- **[ADOPT]** Add a reverse proxy or self-hosted WAF layer (e.g., Coraza/ModSecurity, or a rate-limiting reverse proxy like Nginx/Caddy with a rate-limit module, or CrowdSec/fail2ban at the network edge) in front of both Keycloak and the app for **IP-level** throttling — Keycloak's brute-force detection is account-scoped, and ASVS L2 plus the OWASP cheat sheet both expect network-level throttling as a *separate, complementary* layer, not a substitute.
- **[AVOID]** A public CDN/WAF service (e.g., Cloudflare) as the sole edge layer for anything touching the personal-data endpoints, given the same data-localization logic that already rules out foreign-hosted SaaS IdPs in §8 — prefer a self-hosted or in-country-hosted WAF/reverse-proxy for the production system of record, and reserve a public CDN (if used at all) for genuinely public, non-personal-data static assets only.

### G7. Telegram as a first-class MFA/notification channel

The original report mentions "new-device email/Telegram alert" once in passing (§4) and never develops it, despite the project context naming Telegram as Uzbekistan's dominant messenger — a genuinely local, high-leverage design opportunity most generic auth research would miss entirely. A direct fetch of Telegram's own Bot API documentation confirms the pieces needed to build this properly:

- **Inline-keyboard approve/deny buttons** — "pressing buttons on inline keyboards doesn't send messages to the chat," i.e. a bot can present a silent "New login from Tashkent office — Approve / Deny" prompt that resolves via a callback, without cluttering the chat, the same UX shape as Duo Push or Okta Verify but riding an app 90%+ of the target users already have installed and already trust.
- **Deep linking** (`https://t.me/<bot>?start=<token>`) — a login page can generate a one-time correlation token, show it as a link/QR code, and the moment the user taps Approve in Telegram the backend (via webhook or poll) completes the login. This removes the single biggest passkey/TOTP adoption friction named in §4 (installing and enrolling a separate authenticator) because the "authenticator" is an app civil servants already have open all day.
- **Telegram's own "Login Widget"** exists as an even simpler website-embeddable "Log in with Telegram" button — but this is a materially different, riskier proposal than using a bot for step-up notifications: it would make a consumer messaging platform's account the primary identity credential for a government system of record, with no enterprise SLA, no compliance certification, and data flowing through Telegram's own (non-Uzbekistan) infrastructure.

**[ADOPT]** Build a Telegram bot as a **secondary, opt-in channel layered on top of Keycloak-managed sessions** — new-device/impossible-travel alerts (already suggested in §4), delegation-grant notifications (§7), and optionally a push-approval step-up flow for high-value actions — never as a replacement for Keycloak's own session/credential store.
**[AVOID]** Telegram's Login Widget (or any Telegram-account-as-primary-identity pattern) as the platform's primary or sole authentication method — it fails the same data-localization and vendor-assurance test that already rules out foreign SaaS IdPs, just via a different vendor.
**[ADAPT]** If a push-approval flow is built, keep TOTP/security-key/passkey as the fallback path for the (real, non-trivial) population of civil servants without a smartphone or without Telegram installed — the same escapability principle §4 already applies to passkeys applies here.

### Gap-fill sources consulted

- [Keycloak Server Administration Guide — brute force detection](https://www.keycloak.org/docs/latest/server_admin/index.html#_brute_force)
- [Keycloak — Export and Import](https://www.keycloak.org/server/importExport)
- [Keycloak Server Administration Guide — SAML v2.0 clients and identity brokering](https://www.keycloak.org/docs/latest/server_admin/index.html#saml-clients)
- [Better Auth blog](https://www.better-auth.com/blog)
- [OWASP Cheat Sheet Series — Authentication](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
- [Telegram Bot API — Bot features](https://core.telegram.org/bots/features)
- [DLA Piper Data Protection Laws of the World — Uzbekistan (data subject rights)](https://www.dlapiperdataprotection.com/index.html?t=data-subject-rights&c=UZ)
- [GDPR Article 15 — Right of access](https://gdpr-info.eu/art-15-gdpr/)

**Methodology note:** 6 WebSearch queries were attempted for this addendum and all 6 failed with "web search budget... 200 of 200 WebSearch calls" (a session-wide limit shared across concurrent research work, not specific to this dimension) — zero WebSearch results were available for this pass. All findings above are instead grounded in 10 direct WebFetch reads against primary sources (vendor docs, official blogs, and OWASP/GDPR reference text). Where a claim could not be corroborated by a second independent source under this constraint, it is flagged inline as background/unverified rather than stated as settled fact — consistent with the original report's own epistemic standard.
