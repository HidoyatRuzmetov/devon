# Engineering quality, testing, delivery process, and agentic coding best practices

**TL;DR:** Build a thin testing pyramid (Vitest unit/component + a small Playwright E2E suite covering the weekly-update/escalation ritual, not every screen), with axe, Lighthouse CI, Semgrep, and Trivy as cheap always-on CI gates before anything fancier. Self-host everything touching personal data (GitLab CE/Gitea runners, self-hosted Sentry/GlitchTip, self-hosted Unleash) for Uzbekistan's data-localization law — don't default to Chromatic/Sentry SaaS. For AI-assisted delivery, the highest-leverage practice is giving Claude Code a runnable, falsifiable check (tests, typecheck, screenshot diff) per task, gating "done" with a Stop hook or fresh-context reviewer subagent, and writing acceptance criteria into a spec file *before* code — now Anthropic's own official guidance, not a community trick. Treat "looks done" as a known failure mode: agents write tests that assert nothing, edit tests to pass, hallucinate APIs, and silently skip steps under pressure — bound every loop with a max-iteration count and a deterministic gate, escalating to a human only on genuine ambiguity, never on repeated failure. Given the "no-training-required" mandate, over-invest in accessibility and i18n QA (Uzbek/Russian/English) — a first-time civil servant is also likeliest to be on assistive tech, weak hardware, or a second language.

**Methodology note:** This session's web-search quota was exhausted by concurrent research (0 of ~12 planned `WebSearch` calls succeeded), so this report draws on 18 full-page `WebFetch` reads of primary sources — Anthropic's Claude Code docs, Kiro, GitHub spec-kit, Playwright, Drizzle, k6/Semgrep/Trivy docs, Chromatic pricing, and Geoffrey Huntley's "Ralph Wiggum" writeup — plus stable engineering knowledge (tool names, licenses, general architecture) where live search wasn't available. Claims tied to a specific number/price/quote are sourced; treat pricing/version numbers as needing a final check before procurement (see Open Questions).

---

## Part A — Engineering quality for a robust internal platform

### 1. Testing pyramid for React + Node

| Layer | Tool | What it catches | Notes for this project |
|---|---|---|---|
| Unit | **Vitest** | Pure logic (escalation rule, RSVP capacity math, privacy-tier filtering) | Vite-native, fast; natural fit since the reference prototype is already Vite-based |
| Component | **Vitest + Testing Library** | Behavior from the user's perspective, not implementation | Mirrors Playwright's own stated philosophy: "verify the app works for end users, avoid relying on implementation details" ([playwright.dev/docs/best-practices](https://playwright.dev/docs/best-practices)) |
| Contract | Shared Zod/TypeBox schemas client↔server, or tRPC | API drift caught before staging | A shared schema package removes most need for a separate contract-test tool at this team size |
| Visual/Storybook | **Storybook** + one visual-regression tool (§3) | Unintended CSS/layout regressions | Stories double as living UI docs for a team with no design system yet |
| Accessibility | **axe-core** (`@axe-core/playwright`, `jest-axe`) | WCAG violations (contrast, labels, focus traps) | See §2 — non-negotiable given the zero-training mandate |
| E2E | **Playwright** | The rituals that make the product valuable: Friday update → escalation, RSVP capacity, privacy-tier visibility by role | Keep to 10–30 journey-named flows; isolate with `beforeEach`/auth setup projects, use web-first assertions (`toBeVisible()`) not manual waits |
| Load | **k6** | Throughput/latency at department + multi-tenant scale | See §9 |

### 2. Accessibility testing (axe)

`axe-core` integrates at three points: component tests (`jest-axe`/`vitest-axe` on every Storybook story), Playwright E2E (`@axe-core/playwright` scanning critical pages post-interaction, not just on load), and a CI-wide crawl. Given "understand without training" plus Uzbek/Russian/English, axe should be a **required, blocking** gate — screen-reader and keyboard-only use skews toward older civil servants. Automated tools catch roughly a third to half of WCAG issues; pair axe with periodic manual keyboard-only passes, since logical reading order and meaningful alt text need a human.

### 3. Performance budgets and Lighthouse CI

Run `@lhci/cli` against a fixed `budget.json` (bundle size, TTI, CLS) on every PR, posted as a PR comment, hard-failing on regression beyond a threshold (e.g., +10% bundle size). Treat mobile/3G Lighthouse scores as the target profile, not desktop broadband — many civil servants are on older machines and metered connections. This matters more here than in typical SaaS: the reference prototype's own audit calls the app "readable in five seconds," a bar non-technical readers will hold the product to intuitively.

### 4. Visual regression (Storybook-based)

| Tool | Model | Free tier | Self-hostable | Fit |
|---|---|---|---|---|
| **Chromatic** | Cloud SaaS, per-snapshot billing | 5,000 snapshots/mo free ([chromatic.com/pricing](https://www.chromatic.com/pricing)) | No | Fastest to adopt, but screenshots leave the network — a localization flag if demo data ever resembles real HR data |
| **Lost Pixel** | OSS core + optional cloud | Free (self-hosted) | Yes | Best fit for fully on-prem visual regression |
| **Argos** | OSS (AGPL) + hosted SaaS | Free for OSS repos | Partially | Similar tradeoff to Chromatic |
| Playwright `toHaveScreenshot()` | Self-hosted, in your own CI | Free | Yes | Lowest setup cost; no review dashboard, more cross-OS font flakiness |

**Recommendation:** start with Playwright's built-in screenshot assertions for the handful of pixel-critical surfaces (org chart, KPI cards, sidebar); add Chromatic/Lost Pixel only once the component library is large enough that manual screenshot review becomes the bottleneck — likely Phase 2, not Phase 1.

### 5. Database migration safety

- **Drizzle** offers six migration strategies (`push` for prototyping through `generate`+`migrate` for versioned SQL, or export to Atlas/Liquibase). Its docs cover schema diffing and rename-detection but **do not** document expand-contract ([orm.drizzle.team/docs/migrations](https://orm.drizzle.team/docs/migrations)) — that discipline must be imposed by process.
- **Prisma Migrate** has more mature shadow-database diffing and a documented expand-contract pattern (add nullable column → backfill → require → drop old, each a separate deploy) — the safer default where downtime is unacceptable.

**Recommendation:** Prisma for guardrails; Drizzle for raw-SQL control plus a self-imposed expand-contract checklist. Either way, make expand-contract a PR-template checklist item — a botched migration touching DOB/phone/HR fields is a compliance incident, not just a bug.

### 6. Seeding, fixtures, and demo tenants

Because the platform is explicitly multi-tenant, build a **seed script provisioning a fully-populated demo tenant** (fake 23-person roster, fake projects/activities, all three languages) as a first-class CI artifact so every preview environment boots pre-populated. This doubles as Playwright fixture data and as the "go viral across ministries" demo environment, without ever touching real personal data. Version it alongside migrations so schema and fixtures never drift.

### 7. CI/CD for a government context

Given data-localization and likely on-prem/gov-cloud deployment, cloud-hosted CI runners are not a safe default for anything touching secrets or deploy credentials. Two realistic patterns: **(1) GitLab CE/EE self-managed** with in-network runners — mature air-gapped support, built-in registry, bundled SAST/DAST at lower tiers than GitHub's equivalent; **(2) GitHub Actions with self-hosted runners**, or **Gitea + Gitea Actions** (fully open-source, Actions-workflow-compatible) if the team prefers that ecosystem but needs execution to stay inside the perimeter. Either way, secrets live in a self-hosted vault and images are built/scanned inside the perimeter.

### 8. Release trains, changelogs, feature flags

A ~23-person team growing multi-tenant doesn't need weekly release trains — fortnightly/on-demand releases with an auto-generated changelog (Conventional Commits + `changesets`/`release-please`) plus an in-app "What's new" panel is enough, since civil servants won't read GitHub release notes. For feature flags, **Unleash** or **Flagsmith** (both self-hostable) let sub-departments or pilot ministries be flagged into new modules gradually (e.g., Phase 3 "decision intelligence" to Data & BI Analytics first) without a full deploy. Avoid LaunchDarkly/Split.io as primary infra given localization — fine later once a data-processing agreement exists.

### 9. Error tracking, i18n QA, security scanning, load testing

- **Error tracking:** self-hosted **Sentry** ("feature-complete... for low-volume deployments" per its own repo, [github.com/getsentry/self-hosted](https://github.com/getsentry/self-hosted)) or lighter **GlitchTip** (Sentry-SDK-compatible, smaller footprint) — both keep PII-bearing stack traces/breadcrumbs inside the network.
- **i18n QA:** (a) **pseudo-localization** — render the UI in a machine-expanded/accented fake locale in CI to catch hardcoded strings and layout breakage before real translation; (b) **missing-key detection** — diff extracted string keys against `ru.json`/`uz.json`, failing CI on any gap so a feature never silently falls back to English. Russian text runs ~15–35% longer than English for the same meaning — bake that into visual-regression fixtures too.
- **Security scanning:** **Semgrep** (diff-aware PR scans via `SEMGREP_BASELINE_REF`, full scans nightly — [docs.semgrep.dev/semgrep-ci/overview](https://docs.semgrep.dev/semgrep-ci/overview)) plus **Trivy** (Apache-2.0; containers, IaC, secrets, dependency CVEs in one tool — [trivy.dev](https://trivy.dev/)) plus `npm audit`/`pnpm audit`. All run inside your own CI runner; Semgrep sends only hashed findings externally.
- **Load testing:** **k6** as fast smoke tests in CI/CD, with stress/spike/soak tests run outside the PR pipeline — k6's own guidance: "not all performance tests are suited for CI/CD workflows," recommending smoke tests in CI, average/stress/spike pre-release multiple times daily, and weekly baseline + hourly synthetic checks in production ([grafana.com/docs/k6](https://grafana.com/docs/k6/latest/testing-guides/automated-performance-testing/)). At this platform's realistic scale, thresholds like "error rate < 1%, p90 < 600ms" should be a warning signal at first, not an automatic blocker.

---

## Part B — Agentic software delivery in 2026

### 1. Anthropic's own current guidance (primary source)

Anthropic's official Claude Code best-practices doc is unambiguous on the single highest-leverage practice: **"Give Claude a check it can run: tests, a build, a screenshot to compare. It's the difference between a session you watch and one you walk away from."** Without a runnable check, "looks done" is the only signal available and a human becomes the verification loop by necessity. The doc prescribes a four-phase workflow — **Explore → Plan → Implement → Commit** — using plan mode for anything you couldn't describe as a one-sentence diff.

Four mechanisms escalate a check from advisory to enforced, in increasing rigor: **(1) in one prompt** — ask Claude to run the check and iterate in the same turn; **(2) a `/goal` condition** — a separate evaluator re-checks after every turn, and Claude Code eventually stops an unmet, stalled goal on its own; **(3) a deterministic Stop hook** — blocks the turn from ending until it passes, though Claude Code overrides and force-ends after **8 consecutive blocks** (a concrete, citable bound against infinite loops); **(4) a second opinion** — a fresh-context verification subagent so the agent that wrote the code isn't the one grading it.

The doc names failure patterns explicitly: **"the kitchen sink session"** (unrelated tasks pollute context — fix: `/clear`), **"correcting over and over"** (fix: after two failed corrections, `/clear` and rewrite the prompt with what was learned), **"the over-specified CLAUDE.md"** (too-long files cause half of it to be ignored), **"the trust-then-verify gap"** ("a plausible-looking implementation that doesn't handle edge cases" — fix: never ship what you can't verify), and **"the infinite exploration"** (unscoped "investigate X" fills context — fix: scope narrowly or delegate).

On adversarial review, Anthropic's own counter-warning matters: **"A reviewer prompted to find gaps will usually report some, even when the work is sound... Chasing every finding leads to over-engineering... Tell the reviewer to flag only gaps that affect correctness or the stated requirements, and treat the rest as optional."** This is a direct, sourced answer to avoiding infinite approve/redo cycles — scope the reviewer's mandate, don't loop harder.

### 2. Subagents, hooks, and worktree isolation

**Subagents** are Markdown files with YAML frontmatter (`name`, `description`, `tools`/`disallowedTools`, `model`, `permissionMode`, `isolation: worktree`, `maxTurns`), stored in `.claude/agents/` (project, git-committed) or `~/.claude/agents/` (personal). Concrete limits: **max nesting depth 3**, **max 20 concurrent subagents**, **15,000-token** combined description budget. A "fork" subagent inherits full conversation history for background side-tasks, unlike a normal subagent's fresh context.

**Hooks** are the deterministic-gate mechanism: 30+ event types (`PreToolUse`, `PostToolUse`, `Stop`, `SubagentStop`, `WorktreeCreate`...), each with a `matcher` and a handler (`command`, `http`, `mcp_tool`, `prompt`). Exit code 2 from a command hook blocks the action — this is how a team encodes "never run a migration without review" or "always lint after every edit" as code, not as an instruction Claude might forget under context pressure.

**Worktree isolation** (`--worktree`, or `isolation: worktree` in subagent frontmatter) gives each parallel agent its own git checkout branched from the default branch; Claude Code enforces checks so an isolated session cannot edit files or run git against the main checkout — making parallel sessions on one repository safe rather than a collision risk.

### 3. Spec-driven development: Kiro and GitHub spec-kit

Two independent implementations of the same idea have converged on nearly the same three-to-six-phase shape:

- **AWS Kiro**: `requirements.md` (user stories + acceptance criteria) → `design.md` (architecture, sequence diagrams, error-handling strategy) → `tasks.md` (discrete, trackable implementation tasks). Kiro explicitly builds a **dependency graph and executes independent tasks in concurrent "waves"** rather than one task at a time — a pattern directly reusable for this project's own task breakdowns.
- **GitHub spec-kit**: `constitution` (project principles, once) → `specify` (what/why) → `plan` (tech stack/architecture) → `tasks` → `implement` → **`converge`** (a dedicated command that assesses the codebase against spec+plan+tasks and reports "Converged" or lists remaining gaps — repeating steps 4–5 until convergence). The `converge` step is the cleanest concrete answer found to "how do you know an agent loop is actually done": a separate, explicit verification pass with a binary output, not the implementing agent's own say-so.

**Applicability here:** for each of the platform's modules (People directory with privacy tiers, Projects register with the Friday-update ritual, Activities/RSVP), write a `requirements.md`-equivalent with acceptance criteria *before* any Claude Code session starts implementing — e.g., "a project missing a Friday update or marked Blocked must appear in the management review queue within one day; verified by a Playwright test that seeds a stale project and asserts its presence in the queue view." This single habit — acceptance criteria as a file, written first — is the practice most repeated across every primary source fetched for this report.

### 4. The "Ralph Wiggum" loop, and why it is a narrower tool than it sounds

Geoffrey Huntley's "Ralph" technique is, in his own words, "a Bash loop": `while :; do cat PROMPT.md | claude-code; done`, one discrete task per iteration ("only one thing" — his emphasis). His documented failure modes are worth designing against explicitly: the agent **assumes unimplemented when a search is merely inconclusive**; it **defaults to placeholder/stub implementations that merely compile** (fix: aggressive anti-placeholder prompt language plus a dedicated detection pass); **quality degrades well before the advertised context limit** (usability degrading around 147k–152k tokens of a nominal 200k, reinforcing Anthropic's own "manage context aggressively" guidance); and it sometimes **duplicates an implementation out of self-doubt** rather than searching first. His safety net is cheap and git-native: **commit/tag after every test pass, `git reset --hard` on breakage**. His key caveat: **"There is no way this is possible without senior expertise guiding Ralph,"** and he restricts the technique to **greenfield projects** at ~90% completion, not legacy codebases. For a ministry platform with compliance stakes, an unattended bare-loop pattern should stay scoped to mechanical work (migrations, CRUD scaffolding) and never touch privacy-tier logic or auth without human review at the end of every iteration, not just the loop's end.

### 5. Common failure modes to design against explicitly

Cross-referencing Anthropic's named patterns with Huntley's field notes, the recurring failure modes to assume will happen, not merely might:

- **Hallucinated APIs** — mitigated by real dependency versions in CLAUDE.md and "search the codebase for existing patterns first" prompts.
- **Tests that assert nothing, or agents editing tests to pass** — the single most dangerous failure mode, since it defeats the verification premise. Mitigation: instruct the fresh-context reviewer to specifically check that assertions are meaningful and that no test file was touched when the stated goal was fixing implementation code.
- **Scope creep** — Anthropic's reviewer-scoping callout ("flag only gaps that affect correctness... treat the rest as optional") is the direct antidote to an unbounded reviewer manufacturing work.
- **Silent skipping under pressure** — mitigated by requiring evidence, not assertions: "the test output, the command it ran and what it returned, or a screenshot of the result."
- **"Looks done" syndrome** — the named root failure a runnable check exists to close.
- **Infinite approve/redo cycles** — bounded three ways: a hard iteration cap (8-block Stop-hook override is Anthropic's shipped default), "clear context and rewrite the prompt" after two failed corrections rather than looping on polluted context, and escalating to a human only when the blocker is requirement ambiguity, not a merely-failing check.

### 6. Context management and evals

**CLAUDE.md** is loaded every session — keep it to what would cause mistakes if removed (bash commands, non-default style, testing instructions, repo etiquette, architectural decisions, environment quirks), excluding anything inferable from code or frequently-changing. Domain knowledge only sometimes relevant belongs in a **Skill**, loaded on demand. **ADRs and progress ledgers** aren't part of Claude Code's docs but complement them naturally: a `docs/adr/NNNN-title.md` per irreversible decision gives future sessions the *why* that CLAUDE.md's own pruning test would otherwise cut; a lightweight `PROGRESS.md`/`tasks.md` plays the same role across `/clear` boundaries. **Evals for agent output** weren't covered by any primary source fetched this session — the closest analogue found is spec-kit's binary `converge` check and the fresh-context-reviewer pattern, both process substitutes for a formal eval harness.

### 7. Metrics for agentic delivery

No primary source gave a canonical metrics list; the ones that are actually measurable and meaningful here: (1) share of merged PRs with a runnable check versus a bare "looks right" merge, (2) Stop-hook overrides per week (rising = checks miscalibrated, not agents improving), (3) reviewer-subagent finding density trending toward zero on repeat offenses, (4) time-to-first-runnable-check per task (near zero when specs are written first; high when retrofitted).

---

## Recommended QA gate list (concrete pipeline stages, cheapest/fastest first)

1. **Typecheck + lint** (blocking, seconds) — TypeScript strict mode, ESLint.
2. **Unit + component tests** (Vitest, blocking, tens of seconds).
3. **i18n key-completeness check** (blocking) — fails if any extracted string key is missing from `ru.json` or `uz.json`.
4. **Semgrep diff-aware SAST** (blocking on new findings only; full scan nightly).
5. **Trivy dependency/container/secret scan** (blocking on high/critical).
6. **`npm audit`/`pnpm audit`** (blocking on high/critical, informational otherwise).
7. **Axe accessibility scan** on Storybook stories and key Playwright pages (blocking).
8. **Lighthouse CI budget check** (blocking on budget regression beyond threshold).
9. **Playwright E2E** for the named rituals (weekly update → escalation, RSVP capacity, privacy-tier visibility) (blocking).
10. **Visual regression** (Playwright screenshot diff initially; Chromatic/Lost Pixel once the component count justifies it) (blocking on unreviewed diff).
11. **DB migration expand-contract checklist** (PR template, human-reviewed, not automatable) — required sign-off before any migration touching a live table with personal data.
12. **k6 smoke test** against the preview environment (blocking on gross regression; nightly full load test, non-blocking/advisory per k6's own guidance).
13. **Fresh-context reviewer subagent** (or human reviewer) against the spec's acceptance criteria — the final gate before merge, scoped explicitly to correctness/requirements, not style.

## Recommended agent-loop design with explicit stop conditions

For each unit of work on this platform:

1. **Before code:** a spec file (`requirements.md`-style) with acceptance criteria and at least one concrete example, written by a human or an interview-mode Claude session, committed to the repo.
2. **Implementation loop (single agent, single worktree):** Explore → Plan (plan mode) → Implement, running the applicable checks from the QA gate list above after every meaningful change, not just at the end.
3. **Stop condition 1 (success):** all applicable QA gates pass AND the fresh-context reviewer subagent reports no correctness-affecting gaps against the spec.
4. **Stop condition 2 (bounded failure):** after **3 failed iterations** against the same failing check (tighter than Anthropic's own 8-block hook default, appropriate for a small team that wants a human in the loop sooner), stop and surface the failure with evidence (test output/screenshot) rather than continuing to retry blindly.
5. **Stop condition 3 (ambiguity escalation):** if the agent identifies that the spec itself is contradictory or underspecified (not merely that a check fails), stop immediately and ask — do not guess and continue, per Anthropic's own "don't ship what you can't verify" principle extended to specs themselves.
6. **Parallel work:** independent modules/tasks run in separate `--worktree`-isolated sessions or `isolation: worktree` subagents (safe by Claude Code's own enforced checks against cross-worktree writes); dependent tasks run in waves as in Kiro's dependency-graph model, not all at once.
7. **Final human gate:** for anything touching personal data schemas, auth, or privacy-tier access control, a human reviews the diff regardless of how many automated gates passed — this is a policy decision for a government system handling citizen/employee PII, not an engineering nicety.

---

## What this means for us

1. **[ADOPT] Vitest + Playwright as the whole testing stack**, already implied by the Vite-based reference prototype. *Why:* smallest tool surface for a small team.
2. **[ADOPT] Runnable checks before any Claude Code task, written into a spec file first** — Anthropic's own top recommendation. *Why:* the only thing that lets unattended agent sessions be trusted at all.
3. **[ADOPT] Self-hosted Sentry/GlitchTip, Unleash/Flagsmith, GitLab CE or Gitea+Actions** — never the SaaS defaults. *Why:* data-localization law makes SaaS error-tracking/flags a legal risk.
4. **[AVOID] Chromatic/cloud visual-regression as a Phase-1 default** — start with Playwright's built-in screenshot diffing. *Why:* zero new vendor, zero data-egress question until the component count justifies it.
5. **[ADOPT] Axe and Lighthouse CI as blocking gates from day one.** *Why:* "no training" plus multi-language make accessibility and performance functional requirements, not polish.
6. **[ADAPT] Prisma's expand-contract discipline even if Drizzle is chosen** — impose the checklist manually. *Why:* migrations touching employee PII are a compliance incident if done carelessly.
7. **[ADOPT] Fresh-context reviewer subagent before every merge**, scoped strictly to spec correctness, never style nitpicking. *Why:* Anthropic's own antidote to infinite approve/redo cycles.
8. **[ADOPT] A 3-strikes bounded-retry rule for autonomous loops**, escalating to a human only on genuine spec ambiguity. *Why:* tighter than Anthropic's 8-block default, appropriate given the compliance stakes.
9. **[ADAPT] The Ralph Wiggum bare-loop only for narrow, greenfield, low-stakes tasks** — never privacy-tier logic or auth. *Why:* its own author restricts it to greenfield work under senior oversight.
10. **[ADOPT] Worktree-isolated parallel sessions for independent modules** (People, Projects, Activities in parallel). *Why:* Claude Code enforces cross-worktree write protection natively.
11. **[ADOPT] Pseudo-localization and missing-key CI checks from the first i18n feature**, not retrofitted. *Why:* Russian text runs longer than English; silent English fallback embarrasses the department in front of other ministries.
12. **[AVOID] LaunchDarkly/Split.io or any foreign-hosted flag SaaS as primary infrastructure.** *Why:* same data-localization logic as error tracking.
13. **[ADOPT] A demo-tenant seed script as a first-class CI/deploy artifact.** *Why:* doubles as Playwright fixtures and the "go viral" sales demo.
14. **[ADAPT] Spec-kit's `converge` idea without the tool itself** — a lightweight checklist asking "does the code match spec+plan+tasks, list gaps" after every pass. *Why:* cleanest sourced answer to "is the loop actually done," cheap to replicate.
15. **[AVOID] Trusting "tests pass" alone as proof of done for privacy/auth work** — require human diff review regardless of gate status. *Why:* agents editing tests to pass is the most-repeated failure mode found; human review is the field's current answer at the highest-stakes points.

---

## Open questions

- **Live pricing/version verification wasn't possible this session** (WebSearch quota exhausted) — re-verify Chromatic pricing (quoted here: Free 5,000 snapshots/mo, Starter $179/mo for 35,000, Pro $399/mo for 85,000), GitLab tier pricing, and Sentry self-hosted hardware requirements before procurement.
- **Prisma vs Drizzle** is left as an open tradeoff (migration-safety maturity vs. query control) — no source compared them head-to-head on expand-contract; needs a team decision.
- **GitLab CE vs Gitea+Actions vs self-hosted GitHub Enterprise** depends on Ministry procurement/vendor constraints this research couldn't access — needs a product-owner decision.
- **No canonical "evals for agentic coding output" framework exists in public guidance found this session** — likely a genuine gap, not just a search-budget artifact; the team may need to build its own rubric.
- **The four agentic-delivery metrics proposed above are this analyst's synthesis, not a cited standard** — treat as a hypothesis to validate against real usage data.
- **Data-residency of the Anthropic API itself (where prompts/code are processed) was out of scope here** — check against the data-localization law before any workflow that could put real citizen/employee PII into a prompt; the demo-tenant strategy sidesteps this for testing but production debugging needs an explicit policy.

---

## Sources

- [Claude Code best practices — code.claude.com](https://code.claude.com/docs/en/best-practices)
- [Building effective agents — Anthropic](https://www.anthropic.com/research/building-effective-agents)
- [Claude Code subagents — code.claude.com](https://code.claude.com/docs/en/sub-agents)
- [Claude Code hooks — code.claude.com](https://code.claude.com/docs/en/hooks)
- [Claude Code worktrees — code.claude.com](https://code.claude.com/docs/en/worktrees)
- [Kiro spec-driven development docs](https://kiro.dev/docs/specs/)
- [GitHub spec-kit](https://github.com/github/spec-kit)
- [Playwright best practices](https://playwright.dev/docs/best-practices)
- [Drizzle ORM migrations docs](https://orm.drizzle.team/docs/migrations)
- [Chromatic pricing](https://www.chromatic.com/pricing)
- [k6 automated performance testing guide (Grafana docs)](https://grafana.com/docs/k6/latest/testing-guides/automated-performance-testing/)
- [Semgrep CI overview](https://docs.semgrep.dev/semgrep-ci/overview)
- [Trivy](https://trivy.dev/)
- [Sentry self-hosted repository](https://github.com/getsentry/self-hosted)
- [Geoffrey Huntley — "Ralph Wiggum" agentic loop technique](https://ghuntley.com/ralph/)

**Added during the 2026-09-05 verification and gap-fill pass (see the two sections below):**

- [Claude Code skills — code.claude.com](https://code.claude.com/docs/en/skills)
- [Claude Code plugins — code.claude.com](https://code.claude.com/docs/en/plugins)
- [Playwright accessibility testing (axe integration)](https://playwright.dev/docs/accessibility-testing)
- [Playwright visual comparisons (test-snapshots)](https://playwright.dev/docs/test-snapshots)
- [ESLint flat config — configuration files](https://eslint.org/docs/latest/use/configure/configuration-files)
- [Turborepo configuration reference](https://turborepo.dev/repo/docs/reference/configuration)
- [Changesets — intro to using changesets](https://github.com/changesets/changesets/blob/main/docs/intro-to-using-changesets.md)
- [Lighthouse CI configuration docs](https://github.com/GoogleChrome/lighthouse-ci/blob/main/docs/configuration.md)
- [Unleash quickstart](https://docs.getunleash.io/quickstart)
- [Renovate self-hosted configuration](https://docs.renovatebot.com/self-hosted-configuration/)
- [Syft (Anchore) — SBOM generator](https://github.com/anchore/syft)
- [Gitea Actions overview](https://docs.gitea.com/usage/actions/overview)
- [GitHub Actions — adding self-hosted runners](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/add-runners)
- [GitLab Runner install docs](https://docs.gitlab.com/runner/install/)

---

## Editor's verification notes (engineering-quality-and-agentic-delivery)

**Verification pass date:** 2026-09-05. **Method:** 21 direct `WebFetch` reads of primary sources plus 10 completed `WebSearch` queries (6 further queries were issued but blocked once the session's search quota was exhausted mid-pass — an almost exact recurrence of the constraint this report's own methodology note flagged for the original session). Every quote below was re-fetched today; none is carried over from the original research pass.

### Claims checked and verdict

1. **"Give Claude a check it can run..." (Part B.1)** — **CONFIRMED VERBATIM.** `code.claude.com/docs/en/best-practices` still opens its verification section with this exact sentence.
2. **Four-phase Explore → Plan → Implement → Commit workflow** — **CONFIRMED**, including the `Shift+Tab` plan-mode toggle and the "if you could describe the diff in one sentence, skip the plan" callout.
3. **Stop hook "overrides after 8 consecutive blocks" (Part B.1)** — **CONFIRMED VERBATIM**: "Claude Code overrides the hook and ends the turn after 8 consecutive blocks." The doc frames this as one of four escalating mechanisms — in one prompt → a `/goal` condition → a Stop hook → a fresh-context verification subagent/dynamic workflow — matching the report's four-mechanism structure exactly.
4. **Five named failure patterns (kitchen sink session, correcting over and over, over-specified CLAUDE.md, trust-then-verify gap, infinite exploration)** — **CONFIRMED**, near-verbatim, under "Avoid common failure patterns."
5. **Adversarial-reviewer scoping quote (Part B.1)** — **CONFIRMED VERBATIM**: "A reviewer prompted to find gaps will usually report some, even when the work is sound... Tell the reviewer to flag only gaps that affect correctness or the stated requirements, and treat the rest as optional."
6. **Subagent numeric limits — max nesting depth 3, max 20 concurrent, 15,000-token description budget (Part B.2)** — **CONFIRMED EXACTLY**, and each is now independently tunable via `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` and `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS` env vars — worth pinning explicitly in `agentic/` config once `ship` starts running many wp-* subagents concurrently, rather than relying on the defaults.
7. **Hook handler types "(`command`, `http`, `mcp_tool`, `prompt`)" (Part B.2)** — **CORRECTED.** There are now **five** handler types, not four: `command`, `http`, `mcp_tool`, `prompt`, and **`agent`** (a hook that delegates to a full subagent). Update `agentic/PROTOCOL.md` or any hook-authoring guidance that enumerates handler types.
8. **"30+ hook event types" (Part B.2)** — **CONFIRMED AS A FLOOR, NOW LOW AS A CEILING.** Current docs list **33** distinct event types, including several not around when this report was written: `Setup`, `PermissionRequest`/`PermissionDenied`, `PostToolUseFailure`, `PostToolBatch`, `TaskCreated`/`TaskCompleted`, `TeammateIdle`, `ConfigChange`, `CwdChanged`, `DirectoryAdded`, `FileChanged`, `PreModelSwitch`/`PostModelSwitch`, `Elicitation`/`ElicitationResult`, `SessionEnd`. `PermissionRequest` and `PostToolUseFailure` in particular look useful for WorkPortal's "every write emits an audit event" and "never run a migration without review" invariants.
9. **Worktree isolation enforcement (Part B.2)** — **CONFIRMED**, with more precision than the report implied: Claude Code enforces four distinct, separately-named checks (file-edit path, command working directory, git redirect flags/env vars, and unparseable "command shape"), not one generic guard, and all four cover every subagent spawned from an isolated session, including background ones.
10. **Chromatic pricing — Free 5,000/mo, Starter $179/mo for 35,000, Pro $399/mo for 85,000 (Part A.4, flagged in Open Questions as unverified)** — **CONFIRMED EXACTLY**, current as of today. The report's own "re-verify before procurement" flag can be closed.
11. **k6 CI/CD cadence guidance (Part A.9)** — **PARTIALLY CORRECTED.** "Weekly baseline" is confirmed verbatim, but "hourly synthetic checks" overstates the interval: Grafana's current guide specifies **production synthetic smoke tests every five minutes**, not hourly. The "multiple times daily" pre-release framing could not be re-confirmed in those words either; current wording is "run pre-release [average/stress/spike] tests at least twice consecutively." Tighten any SLA language built on this — a 5-minute cadence is a materially bigger operational commitment than hourly.
12. **Drizzle ORM: no documented expand-contract pattern (Part A.5)** — **CONFIRMED.** Re-fetched today; the six migration strategies are unchanged and expand-contract/parallel-change terminology still does not appear anywhere on the page. The recommendation to impose it manually via PR checklist stands.
13. **Semgrep diff-aware scanning via `SEMGREP_BASELINE_REF` (Part A.9)** — **CONFIRMED VERBATIM**: "To run a diff-aware scan, use `SEMGREP_BASELINE_REF=REF semgrep ci`."
14. **Trivy: Apache-2.0, unified scanner (Part A.9)** — **CONFIRMED**, plus a detail relevant to the gap-fill below: Trivy can also emit SBOMs directly, which softens the case for adding Syft as a separate mandatory tool.

No claim checked this session came back flatly wrong; the two corrections found (hook handler-type count, k6 synthetic-check interval) are both the underlying product/guidance having moved since the original pass, not original research errors. Given how much Claude Code's own hooks/subagents surface changed in the interim (a new handler type, ~10+ new event categories, new env-var knobs), **treat any Claude-Code-specific numeric claim anywhere in this report as needing a fresh check before it's hard-coded into `agentic/PROTOCOL.md`, `agentic/gates.json`, or agent frontmatter** — this system is evolving faster than most of the third-party tooling discussed in Part A.

---

## Gap-fill addendum (2026-09-05)

Researched via the same pass (10 completed `WebSearch` queries + the `WebFetch` reads listed in Sources). Covers the concrete tool/version/config gaps against the brief that Part A only gestured at. Same `[ADOPT]`/`[ADAPT]`/`[AVOID]` convention as "What this means for us."

### 1. Testing pyramid — exact current tools and configs

- **Vitest** — version **5.0.0** shipped **2026-09-03**, two days before this pass. `[ADAPT]` Adopt Vitest per the original recommendation, but don't chase the major the week it lands — pin `^4` (the previous stable line) for the first phase and schedule a deliberate upgrade once v5's browser-mode/coverage changes (bundled deps, `@vitest/istanbuljs` coverage) have a week of community mileage.

  ```ts
  // vitest.config.ts
  import { defineConfig } from 'vitest/config';
  import react from '@vitejs/plugin-react';

  export default defineConfig({
    plugins: [react()],
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./vitest.setup.ts'],
      coverage: {
        provider: 'v8',
        reporter: ['text', 'html', 'lcov'],
        thresholds: { lines: 80, functions: 80, branches: 70, statements: 80 },
      },
    },
  });
  ```

- **Playwright** — `toHaveScreenshot()` now supports lossless/lossy **WebP** snapshots (give the snapshot a `.webp` name) alongside PNG, and `maxDiffPixelRatio`/`maxDiffPixels` remain the tunable tolerance knobs. `[ADOPT]` three fixed-width projects for the visual-regression surfaces called out in Part A.4 (org chart, KPI cards, sidebar):

  ```ts
  // playwright.config.ts
  import { defineConfig, devices } from '@playwright/test';

  export default defineConfig({
    testDir: './e2e',
    fullyParallel: true,
    retries: process.env.CI ? 2 : 0,
    reporter: [['html', { open: 'never' }], ['github']],
    use: { trace: 'on-first-retry', screenshot: 'only-on-failure' },
    projects: [
      { name: 'mobile-390', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } } },
      { name: 'tablet-768', use: { viewport: { width: 768, height: 1024 } } },
      { name: 'desktop-1440', use: { viewport: { width: 1440, height: 900 } } },
    ],
    expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.02 } },
  });
  ```

  Axe integration confirmed as a five-line pattern — scan **after** interaction, not just on load, per the docs' own emphasis to `waitFor()` the target state before `analyze()`:

  ```ts
  import { test, expect } from '@playwright/test';
  import AxeBuilder from '@axe-core/playwright';

  test('org chart has no WCAG AA violations', async ({ page }) => {
    await page.goto('/people/org-chart');
    await page.getByRole('button', { name: 'Expand all' }).click();
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(results.violations).toEqual([]);
  });
  ```

- **Storybook 9** — `[ADAPT]` the original "Storybook + one visual-regression tool" line: Storybook 9's `@storybook/addon-vitest` has **superseded** `@storybook/test-runner` for Vite-based projects (ours is Vite+React 19), running interaction tests, a11y checks, and coverage through Vitest's faster browser mode, all reportable in the Storybook sidebar. It is **not** a visual-regression replacement — keep Playwright `toHaveScreenshot()` (or Chromatic/Lost Pixel later) for pixel diffing; addon-vitest covers behavior/a11y/coverage, not layout regressions.

- **MSW** — current major is **2.x** (2.15.0 as of two months before this pass). `[ADOPT]`, but note the v1→v2 API break: the old `rest` namespace is gone, replaced by `http` + `HttpResponse`. Any copied tutorial snippet using `rest.get(...)` is stale.

  ```ts
  import { http, HttpResponse } from 'msw';
  export const handlers = [
    http.get('/api/projects', () => HttpResponse.json({ projects: [] })),
  ];
  ```

- **Testcontainers-node** — current major is **12.x**. `[ADOPT]` for `apps/api` integration tests that need a real Postgres 17 (matching the deployed version) rather than mocks — this is the layer that actually catches a bad migration, a missing `tenant_id` constraint, or an RLS policy gap that unit tests with a fake DB client cannot:

  ```ts
  import { PostgreSqlContainer } from '@testcontainers/postgresql';

  const container = await new PostgreSqlContainer('postgres:17').start();
  process.env.DATABASE_URL = container.getConnectionUri();
  ```

  This is a genuine addition to the original testing pyramid, not a restatement — Part A's table stopped at "Contract" and "E2E" and never named an integration-against-real-Postgres layer.

### 2. Lint/format — ESLint 9 flat config, typescript-eslint, Prettier vs Biome

ESLint 9 made **flat config (`eslint.config.js`) the default**; the old `.eslintrc` format is deprecated and won't get new features. `[ADOPT]` flat config from day one — there is no reason for a greenfield 2026 project to start on the legacy format.

```js
// eslint.config.js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', '.turbo/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { react, 'react-hooks': reactHooks },
    languageOptions: { parserOptions: { project: true, tsconfigRootDir: import.meta.dirname } },
    rules: { ...reactHooks.configs.recommended.rules },
  },
);
```

**Prettier 3 (currently 3.7) vs Biome (currently 2.x, Rust-based, single binary, ~10–25x faster, claims 97% Prettier compatibility, 450+ lint rules).** `[AVOID]` Biome for Phase 1: the speed gain (fractions of a second either way at this codebase's size) doesn't outweigh giving up typescript-eslint's larger, more battle-tested rule ecosystem and the ability to hand off ESLint config questions to any hire's prior experience. Revisit only if lint/format time becomes an actually-measured CI bottleneck.

### 3. Monorepo tooling — pnpm workspaces + Turborepo

Current stack observed together in the wild: Node 24.x, **pnpm ≈11.x**, **Turborepo ≈2.10.x**. Turborepo reads pnpm's workspace graph and layers task scheduling/caching on top — pnpm decides linking, Turborepo decides what runs, in what order, and whether it can be skipped. **Correction to watch for in any older tutorial or team memory:** the config key is now **`tasks`**, not the old `pipeline` key from Turborepo 1.x.

```json
// turbo.json
{
  "$schema": "https://turborepo.dev/schema.json",
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**"] },
    "typecheck": { "dependsOn": ["^build"], "outputs": [] },
    "lint": { "outputs": [] },
    "test": { "dependsOn": ["build"], "outputs": ["coverage/**"] },
    "test:e2e": { "dependsOn": ["build"], "outputs": ["playwright-report/**"], "cache": false }
  }
}
```

`[ADOPT]` — this is a straightforward fit for `apps/web`, `apps/api`, `packages/{db,contracts,ui,i18n}` and gives the `gate.mjs --profile fast` script real incremental caching almost for free.

### 4. Release/versioning strategy

`[ADOPT]` **Changesets** (not `release-please`, and not both). Confirmed three-step loop: a contributor runs `changeset` when their PR should ship a versioned change (picking semver bump + writing the changelog entry at contribution time, not release time); a maintainer/CI job runs `changeset version` to consume all pending changesets, bump versions, and update changelogs across the monorepo, including internal `packages/*` dependency bumps; then `changeset publish`. It explicitly does **not** require every commit to follow Conventional Commits — that matters for a "no training required" contribution culture where not every contributor will internalize commit-message conventions. `release-please`'s Conventional-Commits requirement makes it the worse fit here; don't run both.

```yaml
# .github/workflows/release.yml
name: Release
on:
  push: { branches: [main] }
jobs:
  release:
    runs-on: [self-hosted, linux]
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - run: pnpm install --frozen-lockfile
      - uses: changesets/action@v1
        with: { publish: pnpm changeset publish }
        env: { GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }} }
```

This directly backs the `wp-release` agent's existing job (bump version, write CHANGELOG, tag) rather than replacing it.

### 5. Lighthouse CI — concrete thresholds

```js
// lighthouserc.js
module.exports = {
  ci: {
    collect: { numberOfRuns: 3, settings: { throttlingMethod: 'simulate', formFactor: 'mobile' } },
    assert: {
      assertions: {
        'categories:performance': ['error', { minScore: 0.85 }],
        interactive: ['error', { maxNumericValue: 5000, aggregationMethod: 'optimistic' }],
        'cumulative-layout-shift': ['error', { maxNumericValue: 0.1 }],
        'resource-summary:script:size': ['error', { maxNumericValue: 350000 }],
      },
    },
    upload: { target: 'lhci', serverBaseUrl: process.env.LHCI_SERVER_URL },
  },
};
```

Use `formFactor: 'mobile'` per Part A.3's own "mobile/3G is the target profile" call. Point `upload.target` at a **self-hosted** LHCI server (not `temporary-public-storage`, which is Google-hosted) to stay consistent with the report's own data-localization stance.

### 6. k6 — corrected cadence and a concrete smoke config

Per the verification notes above, the accurate cadence is: **CI smoke test on every PR** (seconds, blocking only on gross regression), **pre-release average/stress/spike suite run at least twice consecutively** before a release, **production baseline at half of average traffic weekly**, and **production synthetic smoke checks every five minutes** (not hourly — correct this anywhere it was written down as hourly).

```js
// smoke.js
export const options = {
  vus: 5,
  duration: '30s',
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(90)<600'],
  },
};
```

### 7. Security/supply chain — Semgrep, Trivy, Syft, and the SBOM gap

Confirmed Part A's Semgrep/Trivy claims exactly (`SEMGREP_BASELINE_REF` diff-aware scans on PRs, nightly/weekly full scans on the default branch; Trivy Apache-2.0, covering CVEs/IaC misconfig/secrets/containers). **New finding:** Trivy can also generate SBOMs directly (`trivy image --format cyclonedx ...`), which the original report didn't mention and which changes the Syft recommendation:

- `[ADAPT]` Use Trivy's own SBOM output as the default — one fewer tool in the pipeline.
- `[ADOPT]` **Syft** only if a specific compliance/procurement requirement calls for SBOM generation to be a separate tool from the vulnerability scanner (common in some government audit regimes), or if its broader ecosystem-format coverage or Grype pairing is specifically needed:

  ```bash
  syft dir:. -o cyclonedx-json=sbom.json
  ```

**New gap the original report didn't cover at all: dependency-update automation.** `[ADOPT]` self-hosted **Renovate** (not the GitHub/GitLab-hosted app, per the same data-localization logic already applied to CI/error-tracking/flags) run as a scheduled job against the self-hosted git instance, configured with `platform`, `token`, `endpoint`, and `autodiscoverFilter`; group updates per workspace so `packages/db`/`packages/contracts`/`packages/ui`/`packages/i18n` don't all land in one daily lockfile-churn PR.

### 8. Feature flags — Unleash self-host, a licensing nuance

Confirmed self-hosted Unleash is the free/OSS path (`isEnabled('some-flag')` client pattern confirmed). **One nuance the original report didn't flag:** Unleash's own quickstart frames the "free" tier as a 14-day trial of **Unleash Enterprise Cloud**, with the actual perpetually-free option being the plain open-source GitHub release. `[ADOPT]` the OSS self-hosted edition specifically — verify directly with Unleash whether the on-prem "Enterprise" feature set (advanced RBAC, SSO, change-request approvals) requires a paid license before assuming full parity for free; this session's fetch could not settle that question.

### 9. Error tracking — Sentry self-host vs GlitchTip

Could not retrieve exact hardware-requirement numbers from `github.com/getsentry/self-hosted` this session (the README body wasn't returned by `WebFetch`; only the repo's tagline — "feature-complete and packaged up for low-volume deployments and proofs-of-concept" — was confirmed, matching Part A's quote). What's well known independent of that fetch: self-hosted Sentry's docker-compose stack includes Kafka, ClickHouse, Zookeeper, Postgres, Redis, and Symbolicator — a materially heavier operational footprint than GlitchTip's single-Postgres-backed stack. `[ADAPT]` GlitchTip as the **default**, not merely the lighter alternative, for a ~23-person team: treat self-hosted Sentry as a deliberate upgrade only if Sentry-specific features (session replay, profiling) become a hard requirement, since running an extra Kafka/ClickHouse cluster is a real, ongoing ops cost this platform's team size likely can't absorb casually. Re-fetch the actual README hardware table before deciding either way.

### 10. CI — GitLab CE / Gitea Actions / GitHub Actions self-hosted runner, with a job matrix

- **GitHub Actions self-hosted runners**: GitHub's own docs give an independent, security-not-just-localization reason to keep the WorkPortal repo private: *"only use self-hosted runners with private repositories,"* because a malicious pull request from a public fork could execute arbitrary code on the runner. This reinforces Part A.7's data-localization argument with a second, unrelated justification.
- **Gitea Actions**: confirmed "mostly compatible" with GitHub Actions YAML, powered by `act_runner` (a fork of `nektos/act`), and explicitly "stable enough for production usage" — Gitea uses it on gitea.com itself. Its docs carry a mutual-trust rule worth writing into our own runner policy once sub-departments get their own orgs: *"Don't use a runner you don't trust... Don't provide a runner to a repository/organization/instance you don't trust."*
- **GitLab Runner**: confirmed as a single, language-agnostic binary, with GitLab's own docs recommending it run **on a separate machine from the GitLab server**. This session's fetch could not confirm executor-type specifics (docker/shell/kubernetes) or air-gapped-install detail — still an open item, narrower than in the original report but not closed.

```yaml
# GitHub Actions
jobs:
  gate-fast:
    runs-on: [self-hosted, linux, x64]
    strategy:
      matrix: { task: [typecheck, lint, test, i18n-check] }
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - run: pnpm install --frozen-lockfile
      - run: pnpm turbo run ${{ matrix.task }}
```

```yaml
# GitLab CI — equivalent
gate-fast:
  tags: [self-managed]
  parallel:
    matrix:
      - TASK: [typecheck, lint, test, i18n-check]
  script:
    - pnpm install --frozen-lockfile
    - pnpm turbo run $TASK
```

### 11. Migration safety and seed/demo-tenant strategy

No correction to Part A.5/A.6 — re-confirmed Drizzle still has no documented expand-contract pattern (see verification notes item 12), so the recommendation to enforce it as a manual PR-checklist item stands unchanged. Nothing new found on demo-tenant seeding specifically; it remains a project-process decision rather than a tool-selection one.

### 12. Agentic-delivery practices — Skills and Plugins (the two extension points Part B didn't cover)

The original report covered subagents, hooks, and worktrees in depth but never mentioned **Skills** or **Plugins**, both directly relevant to how `agentic/` and `.claude/agents/` are organized:

- **Skills** (`SKILL.md` in `.claude/skills/`) load only when invoked — by name (`/skill-name`) or by Claude matching its `description` — versus CLAUDE.md's always-loaded cost. Frontmatter supports far more than a name/description pair: `disable-model-invocation` (human-only trigger), `context: fork` (run in an isolated subagent), `allowed-tools`/`disallowed-tools`, `arguments`, `model`, `effort`. `[ADOPT]` **`disable-model-invocation: true`** explicitly on WorkPortal's `ship`, `feature-cycle`, `review-sweep`, `polish-sweep`, and `research-sweep` workflow skills if not already set — the default is model-invocable, and an autonomous `ship` run triggering itself without an explicit `Workflow({...})` call would cut against CLAUDE.md's "scope enters only through backlog.json" discipline.
- **Plugins** bundle skills + agents + hooks + MCP/LSP servers behind a `.claude-plugin/plugin.json` manifest, distributed via marketplaces (official/community/private) with namespaced invocation (`/plugin-name:skill`). `[ADAPT]` — once the 16 `wp-*` agents and five workflows stabilize past Phase 1, package `agentic/` as an internal, privately-marketplaced plugin. This is the confirmed, sourced mechanism for "another ministry adopts WorkPortal's delivery system" to mean one `/plugin install` rather than copy-pasting `.claude/agents/` by hand — directly serving the stated goal of spreading this platform across ministries.

Everything else in Part B (spec-driven development / Kiro / spec-kit, the Ralph Wiggum loop, the bounded-retry design, reviewer separation) was not re-fetched this session — time/budget went to the higher-value corrections above and to the tooling gaps the brief named explicitly. Treat those sections as **not re-verified**, not as re-confirmed.
