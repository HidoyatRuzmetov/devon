# AI features in work tools and safe AI for government

**TL;DR**
1. Every major work tool (Notion, Linear, Asana, ClickUp, Slack, Microsoft 365, Atlassian, Airtable, Coda) has converged on the same four AI primitives — workspace Q&A/search, autofill/drafting, meeting-notes-to-actions, and semi-autonomous "agents" that execute multi-step work — so the bar for "having AI" is now table stakes, not differentiation.
2. The frontier in 2026 is agentic execution (Notion Custom Agents, Asana AI Studio + AI Teammates, ClickUp Super Agents, Atlassian Rovo Agents, Microsoft Copilot Cowork), almost all wired through the Model Context Protocol (MCP), which Anthropic open-sourced in Nov 2024 and in Dec 2025 donated to the **Agentic AI Foundation (AAIF)** — a Linux Foundation-hosted directed fund co-founded by Anthropic, Block, and OpenAI, not "the Linux Foundation" as a flat description — it is now the de facto integration layer across OpenAI, Google, Salesforce, and Microsoft too.
3. Agentic tools with workspace-wide retrieval + tool access are exposed to the "lethal trifecta" (private-data access + untrusted content + external egress) — real exploits have already hit Microsoft 365 Copilot, GitHub's MCP server, GitLab Duo, Google Bard, Amazon Q, and ChatGPT Operator; this is the single biggest risk for a government deployment and needs architectural mitigation, not a vendor promise.
4. For a Uzbek ministry, data residency is the hard constraint: Qwen3 (Apache-2.0, open weights) explicitly lists Northern Uzbek among its 119 supported languages and runs well under vLLM/Ollama on-premise — this is the most concrete, verifiable path to a sovereign-compliant AI layer, with Claude's API as the higher-quality fallback for non-sensitive drafting/translation work.
5. Government precedent is a cautionary tale, not a showcase: NYC's MyCity chatbot told small businesses it was legal to steal tips, refuse Section 8 tenants, and go cash-free — all false — and the city kept it live behind a disclaimer; the lesson for us is that any AI answer touching policy, HR, or citizen-facing rules must be retrieval-grounded, cited, and reviewed, never generated free-form.

---

## 1. The 2026 landscape: what "AI features" now means in practice

By 2026 the major work tools have all shipped the same shape of AI, differing mainly in polish and how far they let the AI act unsupervised. The table below is built from vendor product pages fetched directly (see Sources).

| Tool | Q&A / search | Autofill / drafting | Meeting notes | Agents / automation | Notable pricing/limits |
|---|---|---|---|---|---|
| **Notion AI** | Enterprise Search across Slack, Drive, GitHub, etc. (beta) | Database autofill, formula generation, "Research Mode" | AI Meeting Notes: transcript + summary + action items | **Notion Agent** + **Custom Agents** (scheduled/triggered, run unattended) | Custom Agents free until 3 May 2026, then $10/1,000 credits; AI bundled in Business/Enterprise |
| **Linear** | AI-assisted issue search (public docs unreachable this session — see Open Questions) | — | — | "Agents" assignable to issues like a teammate (public knowledge, not independently re-verified live) | — |
| **Asana AI Studio** | — | — | — | No-code workflow builder (intake, routing, conditional branching, human-approval steps) + **30 prebuilt AI Teammates**; **MCP** connectors to Claude/ChatGPT/Gemini | Available on Starter+; case studies claim review time cut from 2 weeks via embedded AI capture |
| **ClickUp Brain²** | "Deep Search" across workspace, connected apps, and the web | Decks, landing pages, email drafts, agenda generation | Implied via connected calendar/doc flows | **Super Agents**: PM rebalancing, engineering triage, campaign management, spreadsheet analysis | Brain² Base $9/user/mo (1,500 Super Credits); "Everything AI" $28/user/mo |
| **Slack AI** | Enterprise Search across Slack + connected apps (Drive, Salesforce, etc.) | — | **Huddle notes** (auto notes from audio/video huddles) | **Slackbot** personal agent (meeting prep, report analysis, briefs); Daily "Today" briefing | Included in all paid plans; vendor states no customer data used to train LLMs |
| **Microsoft Copilot (Teams/Planner/365)** | Work IQ APIs (org-context intelligence layer) | Agentic capabilities in Word/Excel/PowerPoint (GA) | Copilot meeting recap (established feature) | **Copilot Cowork** (multi-step task planning/execution), agent-to-agent communication, model choice incl. GPT-5.6 and Claude Opus 5 | Government/sovereign-cloud specifics not independently verified this session |
| **Atlassian Rovo** | Cross-product search (Jira/Confluence/Bitbucket) — permission-aware by design (vendor claim, pricing page unreachable this session) | — | — | Rovo Agents, Rovo Chat | Not independently re-verified live |
| **Coda AI** | Chat/Q&A over docs, references 600+ integrations | Table/content generation, "80% of writing in 10% of time" | Meeting-notes templates | AI Column (per-row automation at table scale) | Included for Doc Makers, no separate license |
| **Airtable AI** | "Omni" conversational app builder with data + web insight | Field generation via natural language | — | **Field Agents**: autonomous, recurring (lead enrichment, sentiment triage, content generation) | Analysis questions cost 10 credits/response; enterprise picks which model vendor (OpenAI/Anthropic/Meta) is enabled |
| **Granola** | — | — | Core product: audio-only capture (no bot joins the call), pre-meeting "Briefs," post-meeting action items | MCP Connector to Claude/Cursor/Figma | Free 30-day history, then paid tiers |

**Pattern across all nine tools:** the UI language has converged — "Ask AI," a chat panel docked to the workspace, a "Brain"/"Agent"/"Copilot" brand name, and a credits meter separate from the seat price. The differentiator by 2026 is not the feature list but (a) how well grounded the answers are in the tenant's *own*, permission-scoped data, and (b) how much unattended autonomy the agent is given by default. Sources: [Notion](https://www.notion.com/product/ai), [Asana](https://asana.com/product/ai), [ClickUp](https://clickup.com/ai), [Slack](https://slack.com/features/ai), [Coda](https://coda.io/product/ai), [Airtable](https://www.airtable.com/product/ai), [Granola](https://www.granola.ai/), [Microsoft 365 roadmap](https://www.microsoft.com/en-us/microsoft-365/roadmap?filters=Planner).

## 2. UX patterns worth stealing

- **Docked chat, not a separate app.** Every tool puts AI as a persistent side panel over the *existing* object (a doc, a table, a channel), not a standalone chatbot page. The user never has to explain what they're looking at — context is implicit.
- **Grounded citations as the trust mechanism.** Notion's Enterprise Search and Slack's answers surface the *source message/doc*, not just a synthesized paragraph — this is the difference between "an AI told me" and "I can verify this."
- **Credits as a separate meter from seats.** ClickUp, Airtable, and Notion Custom Agents all decouple a flat per-seat AI allowance from a metered credit pool for heavier agent/automation work — this maps well onto unpredictable LLM API cost and is worth copying rather than trying to price AI as "unlimited."
- **Agents-as-teammates, not agents-as-magic.** Asana's "AI Teammates" and Notion's "Agent" are deliberately personified as assignable actors with a name and a role, appearing in the same assignee field as a human — this lowers the learning curve because the mental model ("assign this to someone/something") doesn't change.
- **The audio-capture-without-a-bot pattern (Granola).** Rather than an obtrusive bot joining the call (which every attendee sees and which raises consent/etiquette friction), Granola records system audio locally on the host's device and layers AI structure onto the user's own rough notes. For internal ministry meetings this avoids the "there is a recording artifact in the call" problem entirely — but it does require an installed desktop/mobile app, which may need an IT exception on locked-down government machines. [Granola](https://www.granola.ai/)

## 3. Meeting notes, digests, and drafting — quality bar and failure modes

Every vendor now ships transcript → summary → action-items as a solved feature; the differentiator is what happens when the transcript is bad (accents, cross-talk, technical jargon, or — for us — a bilingual Uzbek/Russian meeting). None of the vendor pages fetched here quote per-language accuracy numbers; this is a live gap we would need to pilot ourselves rather than trust marketing copy.

Weekly digest generation (e.g., "draft the status update from what happened this week") is a natural extension of the reference prototype's Friday-comment ritual: it should draft from **structured activity** (comments, status changes, deadline moves) rather than free-text meeting transcripts, because structured input is auditable and low-hallucination, while transcript-derived summaries in an official reporting chain are exactly the kind of "AI slop" that damages trust (see §6).

## 4. Translation: Uzbek ↔ Russian ↔ English

This is the single most safety-critical AI feature for us, and the evidence is mixed:

- **Google Cloud Translation** explicitly lists Uzbek (`uz`) as supported by both its Neural Machine Translation and newer Translation-LLM models, alongside Russian, Kazakh, Tajik (experimental), Kyrgyz, and Turkmen — so the regional language family is a first-class citizen for Google, not an afterthought. The documentation does not state whether Cyrillic Uzbek is handled as well as Latin Uzbek — this needs a hands-on test, since Uzbekistan's official script is Latin (since 1993) but a meaningful share of older documents and some Russian-speaking staff still produce Cyrillic Uzbek or Russian text. [Google Cloud Translate languages](https://docs.cloud.google.com/translate/docs/languages)
- **DeepL** — the fetch attempt returned a 404 on the languages page (site restructuring or blocked), so this could not be verified live this session; from general knowledge DeepL's language list has historically excluded Uzbek entirely, making it unsuitable as a primary translation engine for us regardless of its superior fluency on the languages it does support. **Needs re-verification before any procurement decision.**
- **Qwen3** (Alibaba, Apache-2.0, open weights) explicitly lists **Northern Uzbek** among 119 supported languages/dialects in the Turkic family, alongside Tajik in the Indo-European family — this is a strong, concrete, license-clean signal that an on-premise open model can do Uzbek↔Russian↔English translation and drafting without ever leaving ministry infrastructure. [Qwen3 announcement](https://qwenlm.github.io/blog/qwen3/)
- **Llama 4** (Meta) was pretrained on 200 languages with 100+ languages having 1B+ tokens each, but the release blog makes no specific claim about Uzbek or Central Asian language coverage — treat it as an unknown until benchmarked, not as equivalent to Qwen3 for this use case. [Llama 4 announcement](https://ai.meta.com/blog/llama-4-multimodal-intelligence/)

**Practical read:** Qwen3 (or a similarly-licensed successor available at the time of build) is currently the most defensible open-weight choice specifically *because* it names Uzbek, not just "multilingual." Any translation feature we ship should still route official/legal-register documents through a human reviewer — machine translation of policy language between Uzbek, Russian, and English carries real risk of subtly wrong legal meaning, which is a well-documented general MT failure mode, not specific to any one vendor.

## 5. Document drafting in official style, Q&A over the workspace, and "ask the org"

Workspace Q&A (RAG over the tenant's own content) is now standard: Notion Enterprise Search, Slack Enterprise Search, ClickUp Deep Search, and Coda's chat all do the same thing — embed the tenant's documents/messages, retrieve on a query, and generate a grounded answer. The government-specific requirements layered on top of generic RAG are:

1. **Permission-aware retrieval is not optional.** A RAG index that flattens access control (i.e., the retriever can see a restricted HR record even if the asking user cannot) is a data breach machine. Airtable's enterprise page explicitly calls out admin-level model/data controls: enterprises "decide which models are enabled," and providers contractually cannot retain or train on the data — this is the right minimum bar, but the retrieval layer itself must also respect field-level privacy tiers (public / internal / restricted), matching the reference prototype's own stated principle ("privacy by design ... log who viewed/changed sensitive data"). [Airtable AI](https://www.airtable.com/product/ai)
2. **"Ask the org" (who knows X) is a people-search problem, not a document-search problem.** It requires indexing *expertise metadata* (project ownership, sub-department mandate, skills fields) separately from content — none of the vendors surveyed expose this as a distinct named feature; it is closest to what Slack's Enterprise Search and Notion's directory-plus-search combination approximate, but we would likely need to build this ourselves on top of the People/Organization data model already implied by the reference prototype.
3. **Official-style document drafting** (memos, briefs, EGDI reports) should be treated as a *constrained generation* task — draft from a template + structured facts, not open-ended prose from a vague prompt — otherwise you get fluent but ungrounded text, which is worse than no draft in an official reporting context.

## 6. Agents, MCP, and the execution layer

**Model Context Protocol (MCP)** is the connective tissue behind almost every "agent" feature above. Anthropic introduced it in November 2024 to solve the N×M integration problem (every AI app needing a custom connector to every data source); it uses a host/client/server architecture analogous to USB-C — one protocol, many devices. Adoption has been fast: OpenAI adopted it in March 2025, Google DeepMind in April 2025, Salesforce began routing through it in April 2026 (4.5 million calls by late May 2026); by mid-2026 over 10,000 MCP servers were in production with SDKs downloaded 97 million times a month, and in December 2025 Anthropic donated MCP governance to the **Agentic AI Foundation (AAIF)**, a directed fund hosted by the Linux Foundation and co-founded by **Anthropic, Block, and OpenAI** together — cementing it as neutral, multi-vendor infrastructure (notably including a competitor as co-founder) rather than a single-vendor lock-in. [MCP introduction](https://modelcontextprotocol.io/introduction), [MCP history/adoption — Wikipedia](https://en.wikipedia.org/wiki/Model_Context_Protocol)

For an internal ops platform, MCP is the mechanism by which our system's own data (projects, people, activities) becomes something an AI agent (ours, or a user's personal Claude/ChatGPT) can query and act on, and it is also how *we* would connect our platform's agents to Telegram, e-mail, or a national document-management system later. Anthropic's own engineering guidance is worth internalizing before building anything agentic: prefer simple, composable **workflows** (prompt chaining, routing, parallelization, orchestrator-worker, evaluator-optimizer) over full autonomous **agents** wherever the task's steps can be predetermined; reserve open-ended agents for genuinely unpredictable tasks, and even then require sandboxed testing, explicit stopping conditions (max iterations), and human checkpoints before any consequential action. "You should consider adding complexity only when it demonstrably improves outcomes." [Anthropic — Building Effective Agents](https://www.anthropic.com/engineering/building-effective-agents)

The **Claude Agent SDK** (and equivalent SDKs from other vendors) is the practical toolkit for implementing this: it gives a permissioned tool-calling loop, session/context management, and hooks for human approval — the same architecture this very research task ran on. The architectural takeaway for our platform: build our own AI features as *thin orchestration* over well-scoped, individually-auditable tools (read project X, draft comment Y, send Telegram message Z) rather than a single do-everything agent with blanket access — this is both safer and easier for a first-time civil servant to reason about ("the AI can draft my status update" is legible; "the AI can do anything in the system" is not).

## 7. Safety and governance: the part a ministry cannot skip

**The lethal trifecta.** Simon Willison's widely-cited framework names the exact condition that turns an AI agent into a data-exfiltration vector: (1) access to private data, (2) exposure to untrusted content (a web page, an email, a pasted document an attacker controls), and (3) a channel to communicate externally. LLMs "follow instructions in content" regardless of source, so an attacker who can get text in front of the model (e.g., in a document the agent is asked to summarize) can hijack it. This is not theoretical — real exploits have hit Microsoft 365 Copilot, GitHub's MCP server, GitLab's Duo Chatbot, Google Bard, Amazon Q, and ChatGPT Operator. Vendor "guardrail" claims of ~95% effectiveness are explicitly called out as insufficient for anything security-critical; the only reliable mitigation is architectural — never let one agent session simultaneously hold all three properties. [The Lethal Trifecta](https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/) A 2025 academic paper on design patterns for securing LLM agents goes further, proposing patterns that give *provable* (not just probabilistic) resistance to prompt injection for agents with tool access — the state of the art is moving from "add a filter" to "constrain the architecture so the exploit is structurally impossible." [Design Patterns for Securing LLM Agents (arXiv 2506.08837)](https://arxiv.org/abs/2506.08837)

**Government guidance exists and is specific.** The UK government's generative AI guidance (originally the "Generative AI Framework for HMG," withdrawn Feb 2025 and superseded by the AI Playbook) is a directly reusable template: ten principles including understanding AI limitations, security, and meaningful human control; concrete data-handling rules (know where data is processed/stored, apply privacy-enhancing tech, consider pseudonymization); mandatory human review before AI output reaches a decision-making context; and an explicit list of **prohibited use cases** — no fully automated decisions on anything touching health or safety, no high-explainability contexts where a decision must be fully justified without a human able to override, no low-latency safety-critical uses, no "absolute accuracy without human validation" claims. This maps almost one-to-one onto what a ministry AI policy should say, and we should adapt it rather than write our own from scratch. [UK Gov generative AI framework](https://www.gov.uk/government/publications/generative-ai-framework-for-hmg/generative-ai-framework-for-hmg-html)

**Negative evidence: what governments have gotten wrong.** New York City's "MyCity" chatbot (Microsoft-powered) told small business owners it was legal to take workers' tips, to refuse Section 8 tenants (violating NYC's own source-of-income discrimination law), to operate cash-only (violating a 2020 city law), and to hide funeral pricing — all false, several actively illegal advice. The city called it a "pilot," kept it online behind a small disclaimer, and cited "thousands of ... timely, accurate answers" as justification. The failure mode is instructive: unconstrained generation over regulatory content, no expert (legal/labor/housing) review before launch, and a disclaimer used as a substitute for accuracy rather than a supplement to it. [The Markup — NYC chatbot](https://themarkup.org/news/2024/03/29/nycs-ai-chatbot-tells-businesses-to-break-the-law) This is the cautionary template for anything in our platform that answers "what does policy X say" or "can I do Y" — such answers must be retrieval-grounded with a visible citation to the source document, or refuse to answer.

**On-prem / data residency architecture.** Uzbekistan's personal-data-localization law effectively forecloses routing citizen or employee personal data through a foreign-hosted API by default. The credible on-premise stack, based on what is verifiably available today:

| Layer | Option | Status |
|---|---|---|
| Inference server | **vLLM** (Apache-licensed, UC Berkeley Sky Computing Lab origin, 2,000+ contributors) — PagedAttention, continuous batching, FP8/INT4/INT8 quantization, runs on NVIDIA/AMD GPU, x86/ARM CPU, TPU | Mature, production-grade, explicitly supports Llama/Qwen/Gemma/Mixtral/DeepSeek-V3 [vLLM docs](https://docs.vllm.ai/en/latest/) |
| Inference server (lighter) | **Ollama** | Simpler ops, good for pilots/low-concurrency, weaker at high-throughput multi-tenant serving than vLLM |
| Open-weight model | **Qwen3** (0.6B–235B, MoE variants, Apache-2.0) — explicitly names Northern Uzbek among 119 languages | Best-evidenced fit for Uzbek-language tasks found this session [Qwen3](https://qwenlm.github.io/blog/qwen3/) |
| Open-weight model (alt) | **Llama 4** Scout (109B total/17B active) or Maverick (400B total/17B active) | Broad multilingual pretraining (200 languages) but no Uzbek-specific claim verified; Meta's custom license (not Apache) — check redistribution/field-of-use terms before adopting |
| Hosted fallback | **Claude API** (Anthropic) | Best quality for reasoning-heavy drafting/translation on *non-sensitive* content only, given data leaves the country; use for public-facing content, EGDI research synthesis on published data, not for personal data |
| National effort | Uzbekistan-specific LLM initiatives | **Could not verify this session** (web search budget exhausted) — this is a priority follow-up; if a national/regional Uzbek LLM or corpus effort exists (e.g., from local AI/NLP labs), it should be evaluated before committing to Qwen3 as the default |

## 8. An AI feature ladder for us

| Phase | Feature | Why safe / why now |
|---|---|---|
| **1 — Safe wins** | Quick-add natural-language parsing (type "EGDI report due Friday, assign Malika" → structured project/task) | No workspace-wide retrieval, no external egress, pure structured extraction — lowest risk, highest daily-use payoff |
| **1** | Draft-from-structured-activity weekly digest (per project, per sub-department) | Input is our own structured data (status, comments, dates), not free text — low hallucination surface, mirrors the existing Friday-comment ritual |
| **1** | Translation assist (Uzbek/Russian/English) on demand, human-reviewed, never auto-published | Bounded, reversible, high daily value for a trilingual department |
| **2 — Connected, still human-gated** | Q&A over the workspace (permission-scoped RAG: "what's the status of the FinTech Regulatory Scan") with visible source citation | Requires the privacy-tier model to already exist (Phase 1 of the reference roadmap) — sequence matters |
| **2** | Meeting-notes-to-actions (opt-in, local capture, never auto-joins as a visible bot) | Matches the Granola pattern; needs an explicit consent/etiquette norm since this is a government office, not a startup |
| **2** | Anomaly/delay detection surfaced as a suggestion, not an auto-action ("Project X has had no comment in 2 weeks — escalate?") | Extends the reference prototype's own auto-escalation rule; keep the human as the one who clicks escalate |
| **3 — Agents with narrow, audited tool access** | Agent that drafts (never sends) a status update, a translated memo, or a Telegram announcement for a human to approve and send | One tool, one action, always a human send/publish step — avoids the lethal trifecta by construction |
| **3** | "Ask the org" expertise search (who has worked on X) | Needs a maintained skills/ownership metadata layer first; low risk once that data model exists |
| **3 (later, guarded)** | Multi-step agent workflows via MCP (e.g., auto-compile a portfolio review packet from five projects) | Only after Phase 1–2 trust is established, with logging, stopping conditions, and sandboxed rollout per Anthropic's own guidance |

## 9. Architecture: switchable Claude API ↔ on-prem model

Recommend an abstraction layer (a thin internal "LLM gateway" service) so every AI feature calls one internal interface, not a vendor SDK directly:
- **Routing rule, not per-feature choice:** documents/fields tagged as containing personal data or restricted-tier content are *hard-routed* to the on-prem vLLM+Qwen3 (or successor) endpoint; everything else may route to Claude API for quality, with the router itself auditable and centrally configured (not left to developer discretion per feature).
- **Same prompt/tool contract on both sides** so switching is a config change, not a rewrite — use MCP as the tool-exposure layer regardless of which model backend is behind it, since MCP is now a neutral, multi-vendor standard rather than an Anthropic-only integration.
- **Full audit log of every AI call**: which model, which user, which data was in context, what was generated, whether a human approved/edited/rejected it before anything left the system — this is both a governance requirement (UK framework: "document methodology... for auditability") and the mechanism that lets us catch AI slop before it reaches an official report.
- **Cost control:** a credits-style metering per user/department (as ClickUp/Airtable/Notion all do) rather than unlimited use, sized against whichever backend is actually serving the request (on-prem cost is compute/ops, not per-token).

## What this means for us

1. **[ADOPT]** Ship Phase-1 AI (quick-add parsing, structured-activity digests, on-demand translation) before any RAG or agent feature — it delivers the "zero training curve, feels magical" moment without touching the hard security problems.
2. **[ADOPT]** Route anything containing personal or restricted-tier data through an on-prem open model (Qwen3 on vLLM) by default, with Claude API reserved for non-sensitive drafting/research — this is the only architecture that satisfies data-localization law without giving up quality entirely.
3. **[ADOPT]** Build the privacy-tier / access-control model (already implied by the reference prototype) *before* building workspace Q&A — permission-unaware RAG is a breach waiting to happen, and retrofitting access control onto an existing index is much harder than designing it in.
4. **[ADOPT]** Use MCP as the internal tool-exposure standard for anything an agent will call, even before we expose it externally — it is now vendor-neutral (governed by the **Agentic AI Foundation**, a Linux Foundation-hosted directed fund co-founded by Anthropic, Block, and OpenAI — not simply "Linux Foundation-governed" as a flat description) and future-proofs us against being locked to one model vendor.
5. **[ADOPT]** Require a visible source citation on every AI-generated answer that touches policy, HR, or "can I do X" — following the NYC MyCity lesson directly; an uncited AI answer in a government context is a liability, not a feature.
6. **[ADOPT]** Personify agents as named, role-scoped assignees in the same UI slot as a human teammate (Notion/Asana pattern) — this reuses a mental model civil servants already have ("assign to person"), keeping the learning curve near zero.
7. **[ADAPT]** Adopt the UK government's AI Playbook structure (ten principles, explicit prohibited-use list, mandatory human review before decisions) as the skeleton of our own ministry AI policy rather than writing one from scratch — translate and localize it rather than reinvent it.
8. **[ADAPT]** Copy the "credits separate from seats" pricing/metering mental model internally (even though we're not selling seats) as a usage-governance mechanism — it gives department heads a visible, capped AI budget rather than an all-you-can-eat black box.
9. **[ADAPT]** Take Granola's no-bot local-audio-capture pattern for meeting notes, but make it opt-in per meeting with a visible on/off toggle — a silent recording norm in a ministry office needs an explicit consent convention, unlike a startup.
10. **[ADAPT]** Use Anthropic's workflow-vs-agent framing as an internal engineering rule: default to deterministic workflows (prompt chaining, routing) for anything with predictable steps, and reserve open-ended agents for genuinely unbounded tasks — this keeps 80% of our "AI features" boring, auditable, and cheap.
11. **[AVOID]** Do not let any agent hold all three "lethal trifecta" properties (private data + untrusted content + external send) in one session — e.g., an agent that reads restricted HR records and can also post to Telegram is the exact shape of the real-world exploits already seen against Copilot, GitHub MCP, and GitLab Duo.
12. **[AVOID]** Do not generate free-text summaries of meetings or projects for insertion into official reports without a human edit/approve step — treat AI-drafted prose as a first draft only, never as the report of record, precisely because "AI slop" (fluent, confident, wrong) is worse than a shorter but accurate human summary.
13. **[AVOID]** Do not trust DeepL for Uzbek translation (its language list has not historically included Uzbek) and do not assume any vendor's "multilingual" claim covers Uzbek specifically — verify per-language, per-script (Latin vs Cyrillic) before shipping any translation feature, since even Google's own docs did not specify script coverage.
14. **[AVOID]** Do not ship an "ask anything about the department" chatbot before the underlying data has verified privacy tiers and citations — the NYC MyCity failure was fundamentally a "confident but unverified answer" problem, and a government department is exactly the wrong place to repeat it.
15. **[AVOID]** Do not adopt a single do-everything "AI copilot" persona with blanket workspace access as the default UX — every vendor surveyed is moving toward narrow, named, tool-scoped agents (Rovo Agents, AI Teammates, Field Agents) specifically because broad agents are both less trustworthy and harder for a first-time user to reason about.

## Open questions

- **Uzbekistan's own national LLM/AI-localization efforts**: could not verify this session (web search budget was exhausted before this could be searched). This needs a dedicated follow-up — if a national or regional Uzbek-language model, corpus, or benchmark effort exists, it changes the on-prem model recommendation.
- **DeepL's current Uzbek support**: the languages page returned a 404 on fetch; needs re-verification before ruling DeepL in or out.
- **Script handling (Latin vs Cyrillic Uzbek)** in Google Translate, Qwen3, and Claude: none of the fetched sources specified this explicitly; needs a hands-on test with real ministry documents (which may mix scripts across document age).
- **Microsoft Copilot's actual sovereign-cloud / data-residency options for a country without an Azure sovereign region** (e.g., EU Data Boundary-style guarantees) — the specific Learn documentation page returned a 404 this session; if Microsoft 365 is in scope at all for this ministry, this needs direct verification with a Microsoft rep, not marketing pages.
- **Atlassian Rovo's actual permission-aware retrieval implementation and pricing** — both attempted fetches were blocked (405); the "permission-aware by design" claim above is a vendor claim, not independently verified.
- **Linear's current AI/agent feature set** — the specific docs page 404'd; Linear is a plausible model for our own issue-tracking UX and its AI approach deserves a dedicated re-check.
- **Per-language transcription/summarization accuracy for bilingual Uzbek/Russian meetings** — no vendor publishes this; only a hands-on pilot with real department meetings will tell us if any tool (Granola, Slack Huddle notes, Teams recap) is usable as-is.
- **Legal/compliance sign-off threshold**: who in the ministry (director? legal counsel? Ministry of Digital Technologies IT security?) must approve the on-prem vs. Claude-API routing policy before any AI feature touching personal data goes live — this is a decision for the product owner, not a research finding.
- **Procurement path for GPU hardware** to run vLLM+Qwen3 at usable latency for ~23 users (and eventually more tenants) — capacity planning and budget were out of scope for this research pass.

## Sources

- [Notion AI product page](https://www.notion.com/product/ai)
- [Asana AI Studio product page](https://asana.com/product/ai)
- [ClickUp AI (Brain²) product page](https://clickup.com/ai)
- [Slack AI features page](https://slack.com/features/ai)
- [Coda AI product page](https://coda.io/product/ai)
- [Airtable AI product page](https://www.airtable.com/product/ai)
- [Granola homepage](https://www.granola.ai/)
- [Microsoft 365 roadmap (Planner/Copilot filter)](https://www.microsoft.com/en-us/microsoft-365/roadmap?filters=Planner)
- [Model Context Protocol — introduction](https://modelcontextprotocol.io/introduction)
- [Model Context Protocol — Wikipedia (history, adoption, vulnerabilities)](https://en.wikipedia.org/wiki/Model_Context_Protocol)
- [Simon Willison — The Lethal Trifecta](https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/)
- [Anthropic — Building Effective Agents](https://www.anthropic.com/engineering/building-effective-agents)
- [Design Patterns for Securing LLM Agents against Prompt Injections — arXiv 2506.08837](https://arxiv.org/abs/2506.08837)
- [UK Government — Generative AI Framework for HMG](https://www.gov.uk/government/publications/generative-ai-framework-for-hmg/generative-ai-framework-for-hmg-html)
- [vLLM documentation](https://docs.vllm.ai/en/latest/)
- [Meta — Llama 4 announcement](https://ai.meta.com/blog/llama-4-multimodal-intelligence/)
- [Alibaba — Qwen3 announcement](https://qwenlm.github.io/blog/qwen3/)
- [Google Cloud Translation — supported languages](https://docs.cloud.google.com/translate/docs/languages)
- [The Markup — "NYC's AI Chatbot Tells Businesses to Break the Law"](https://themarkup.org/news/2024/03/29/nycs-ai-chatbot-tells-businesses-to-break-the-law)

**Added in the 2026-09-05 gap-fill pass (see addendum for context on each):**

- [Lark — "The best AI assistant app for managers in 2026"](https://www.larksuite.com/en_us/blog/ai-assistant-app)
- [Kun.uz — "Uzbekistan to develop national AI language model"](https://kun.uz/en/news/2025/08/06/uzbekistan-to-develop-national-ai-language-model-to-preserve-cultural-identity-and-ensure-digital-sovereignty)
- [Gorgona AI & ALPHA — Uzbekistan AI Ecosystem Map 2026 (v1.5)](https://gorgona.uz/en/blog/ai-uzbekistan-map-2026-updated)
- [Uzdaily — "Yandex Uzbekistan Launches Neural Network–Powered Search in the Uzbek Language"](https://www.uzdaily.uz/en/yandex-uzbekistan-launches-neural-network-powered-search-in-the-uzbek-language/)
- [Zenodo — "Benchmarking Pre-trained Open-Source Large Language Models for Uzbek"](https://zenodo.org/records/17223973)
- [TurkicNLP: An NLP Toolkit for Turkic Languages (arXiv 2602.19174)](https://arxiv.org/html/2602.19174v2)
- [arXiv 2404.13813 — "From LLM to NMT: Advancing Low-Resource Machine Translation with Claude"](https://arxiv.org/pdf/2404.13813) (Claude 3 Opus FLORES-200 Uzbek chrF++ scores)
- [Claude Platform Docs — Multilingual support](https://platform.claude.com/docs/en/build-with-claude/multilingual-support)
- [Claude Platform Docs — Tool use overview](https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview)
- [Claude Platform Docs — Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
- [Claude Platform Docs — Batch processing (Message Batches API)](https://platform.claude.com/docs/en/build-with-claude/batch-processing)
- [Vercel — "AI SDK 7 is now available"](https://vercel.com/blog/ai-sdk-7)
- [pgvector — GitHub repository](https://github.com/pgvector/pgvector)
- [Promptfoo — LLM red teaming guide](https://www.promptfoo.dev/docs/red-team/)
- [Regulations.ai — Uzbekistan AI Regulation Overview](https://regulations.ai/regulations/uzbekistan-summary)
- [Regulations.ai — Law "On Personal Data" (ZRU-547, 2019)](https://regulations.ai/regulations/RAI-UZ-NA-ZRU5470-2019)
- [vLLM — Benchmark CLI docs](https://docs.vllm.ai/en/latest/benchmarking/cli/)
- [VMware Cloud Foundation Blog — "How Many Users Can Your LLM Server Really Handle?" (2026)](https://blogs.vmware.com/cloud-foundation/2026/04/30/how-many-users-can-your-llm-server-really-handle/)
- [Finout — "Anthropic API Pricing in 2026: Complete Guide"](https://www.finout.io/blog/anthropic-api-pricing)
- [PE Collective — "Claude Cost Optimization 2026: Batch API and Prompt Caching"](https://pecollective.com/tools/claude-pricing-guide/)

**Methodology note:** this session's web-search tool budget was exhausted (0 of ~12 planned searches executed) before this research began in earnest; all findings above come from 19 direct page fetches. Several planned lines of inquiry (Linear, Rovo pricing, Microsoft sovereign-cloud specifics, Uzbekistan's national AI/LLM efforts, DeepL's language list) could not be completed and are flagged in Open Questions rather than asserted from memory.

## Editor's verification notes (ai-features-and-assistants)

**Spot-check of 5 consequential claims — all 5 CONFIRMED against primary sources:**

1. **Qwen3 lists "Northern Uzbek" among 119 supported languages/dialects** — CONFIRMED via direct fetch of the Qwen3 announcement. Northern Uzbek appears under the Turkic family alongside Turkish, North Azerbaijani, Kazakh, Bashkir, Tatar. The report's central architecture recommendation rests on solid ground.
2. **NYC MyCity chatbot false/illegal statements** (tips, Section 8, cash-free, funeral pricing) and the city's "thousands of ... timely, accurate answers" response — CONFIRMED verbatim against The Markup's reporting, including the specific quote from NYC's Office of Technology and Innovation spokesperson.
3. **MCP donation timeline** — CONFIRMED with one useful precision the report slightly blurs: Anthropic introduced MCP Nov 25, 2024, and in Dec 2025 donated it to the **Agentic AI Foundation (AAIF)** — a directed fund *under* the Linux Foundation, co-founded by Anthropic, Block, and OpenAI — not "the Linux Foundation" as a flat description. The report's phrasing ("donated MCP governance to the Linux Foundation") is directionally right but should name the AAIF specifically, since that's the actual governing body and OpenAI's co-founder role is a notable, citable fact the report omits.
4. **Notion Custom Agents pricing** ("free until 3 May 2026, then $10/1,000 credits") — CONFIRMED exactly, including the May 4, 2026 credit-metering start date and auto-pause-on-insufficient-credits behavior.
5. **Microsoft Copilot Cowork / GPT-5.6 / Claude Opus 5** — CONFIRMED. This was the claim most worth checking because the version numbers (GPT-5.6, Claude Opus 5, Claude Sonnet 5) look implausible/hallucinated at first glance, but the Microsoft 365 roadmap page independently corroborates all three as real, dated roadmap entries (Cowork GA June 16; GPT-5.6 July 9; Claude Opus 5 July 24; Claude Sonnet 5 July 2), plus the Work IQ API's A2A/MCP/REST framing. No correction needed — flag for the reader only that these are fast-moving version numbers likely to be stale again within months.

**Corrections:** none material. One precision fix: MCP's Dec 2025 donation went to the **Agentic AI Foundation** (a Linux-Foundation-hosted fund co-founded by Anthropic, Block, and OpenAI), not generically "the Linux Foundation" — worth tightening in §6 and the TL;DR.

**Gaps identified (brief topics missing, thin, or hand-waved):**

1. **Lark AI is entirely absent.** The brief explicitly named Lark AI (relevant given its strength in Asia and as a Slack/Teams alternative some governments have piloted) but it appears nowhere in the tool comparison table or prose — a straightforward omission against the brief's own list.
2. **Evaluation methods — essentially unaddressed.** The brief asks for "evaluation methods" as a named governance topic; the report has no section on how to test/eval AI feature quality (golden-dataset regression tests, LLM-as-judge, red-teaming for prompt injection, human-rated accuracy sampling for translation/summarization). This is a real gap for a platform that will route between Claude API and an on-prem model and needs a way to know whether the switch degraded quality.
3. **Uzbekistan's national LLM/AI-localization efforts — explicitly required by the brief, left as an unresolved "could not verify."** This is the single most locally-relevant open question and the report's own author flags it as a priority follow-up rather than researching it. Given today's date (Sept 2026) a target search should cover: IT Park Uzbekistan's AI initiatives, "UzbekTelecom"/"Yandex Uzbekistan" language work, or any Central Asian LLM consortium — this needs a dedicated follow-up pass before the architecture recommendation (Qwen3 on vLLM) can be called final.
4. **Cost control is thin.** The report recommends a "credits-style" internal metering scheme but never quantifies it — no ballpark token-cost or GPU-hour estimate for ~23 users (or the multi-tenant future state), so "cost control" is asserted as a policy rather than sized as a budget line. A senior engineering lead would expect at least an order-of-magnitude estimate (e.g., $/month for Claude API at expected volume vs. GPU amortization for on-prem).
5. **Script handling (Latin vs Cyrillic Uzbek) — flagged as an open question but this is core to the brief's explicit ask** ("quality of current models for Uzbek Latin/Cyrillic") and was never actually tested or even desk-researched beyond noting Google's docs are silent on it. Given real ministry documents mix scripts, this should have been at least partially investigated (e.g., checking whether Qwen3's tokenizer/training data description mentions script, or running a quick manual test against a public playground) rather than deferred wholesale.

**Adjacent topics a senior product/engineering lead would expect and that are absent:**

1. **Model versioning/drift management.** The gateway architecture in §9 assumes switching between Claude API and on-prem models is "a config change, not a rewrite," but says nothing about how to detect and manage prompt/output regressions when a vendor silently updates a model version, or how to pin/roll back model versions for reproducibility in an official-reporting context — a real operational risk for exactly the kind of switchable architecture being recommended.
2. **On-prem inference capacity/latency planning.** Explicitly punted to "out of scope," but even an order-of-magnitude estimate (expected concurrent users, tokens/sec needed for acceptable UX, GPU class implied) is table stakes for a lead deciding whether on-prem is even feasible before committing to it as the default routing target for sensitive data.
3. **Uzbekistan-specific AI/data-protection legal framework beyond generic "data localization law."** The report treats data residency as a single blanket constraint but doesn't name or cite the specific Uzbek law(s) (e.g., the personal data law and any AI-specific decree/regulation) that would define what counts as "personal data" requiring on-prem routing — this matters because the entire routing architecture in §9 hinges on that legal definition being right.
4. **Vendor lock-in / data portability for AI-generated content.** If any SaaS AI feature (Notion, ClickUp, etc.) is ever piloted before the custom platform is built, there's no discussion of what happens to AI-generated summaries/drafts stored in that vendor's system if the department migrates away — a standard product-lead concern given the platform's own multi-tenant, long-horizon ambition.

**Overall assessment:** The report is unusually well-sourced and honest about its own gaps (the Open Questions section already flags 3 of the 4 gaps above, which is a mark of intellectual honesty rather than a hidden weakness) — but the brief named specific topics (Lark AI, evaluation methods, Uzbekistan's national LLM efforts) that should have been covered rather than deferred, and the cost-control and script-handling treatments are too abstract to action.

## Gap-fill addendum (2026-09-05)

This addendum closes the five gaps and four adjacent topics flagged in the Editor's verification notes above, plus delivers the feature catalogue and technical-mechanism detail the original brief asked for. Research for this pass: 11 WebSearch queries and 10 WebFetch page reads against primary sources (platform.claude.com, vercel.com, promptfoo.dev, github.com/pgvector, kun.uz, gorgona.uz, zenodo.org, regulations.ai, uzdaily.uz, arxiv.org). Where a claim could not be independently verified, it is marked as such rather than asserted.

### 1. Lark AI — the omitted competitor, now covered

Lark (ByteDance's international collaboration suite) ships the same four AI primitives as the rest of the field, with two distinguishing traits relevant to us:

- **Translation is a first-class, always-on primitive, not a bolt-on feature.** Lark's auto-translation runs inline in every chat message and as real-time subtitles in video meetings, across 100+ languages, without the user invoking anything — the translate affordance sits on the message itself rather than in a separate "Ask AI" panel. [Lark — AI assistant app for managers](https://www.larksuite.com/en_us/blog/ai-assistant-app)
- **Pricing is seat-plus-token, and the token line is the surprise cost.** Free Starter tier includes unlimited chat, 100GB storage, and auto-translation; Basic is $6/user/month, Pro is $12/user/month (1TB storage, longer meetings, advanced permissions) — but AI-heavy features ("AI Anywhere" assistants) consume a separate token allowance that becomes "a significant, non-standard line item on the monthly bill" once usage scales, echoing the credits-vs-seats pattern already identified in §2 and reinforcing that lesson rather than adding a new one.

**[ADAPT]** Lark's inline, no-invocation translation UX (translate-in-place on any message, not a separate panel) is a better default pattern than a explicit "Translate" button for a trilingual Uzbek/Russian department — steal the *placement*, but keep our own human-review gate before anything official is generated from it, since Lark's own translation is not claimed to be legal-register-safe either.
**[AVOID]** Do not adopt Lark itself as a platform for this ministry: it is a China-headquartered product with no evidence of Uzbekistan data-residency options, which conflicts directly with the data-localization constraint that already rules out most foreign SaaS for personal data (§7). It is relevant here only as a UX reference, not a procurement candidate.

### 2. Evaluation methods — the real gap, now specified

The original report recommended a switchable Claude-API/on-prem architecture but had no way to know if a switch degraded quality. **Promptfoo** (MIT-licensed core, 22.4k GitHub stars, used by 350k+ developers and 25%+ of the Fortune 500 as of 2026) is the right default tool for three distinct evaluation needs:

1. **Golden-dataset regression testing.** A YAML-defined suite of representative prompts per feature (quick-add parsing, translation, digest drafting) with expected structured outputs, run against both the Claude-API and on-prem backend on every model-version bump or backend switch — this is the mechanism that makes the §9 "config change, not a rewrite" claim actually true rather than aspirational.
2. **LLM-red-teaming for prompt injection.** Promptfoo's red-team mode auto-generates adversarial inputs (prompt injection, jailbreak, PII exfiltration, BOLA/BFLA authorization-bypass attempts) against 50+ documented vulnerability categories and scores responses automatically; this should run in CI before any new agentic tool is shipped, not just once at launch. [Promptfoo — LLM red teaming guide](https://www.promptfoo.dev/docs/red-team/)
3. **Human-rated accuracy sampling for translation/summarization**, since no vendor (including Anthropic — see §7.6 below) publishes Uzbek-specific accuracy numbers we can trust blind. A rotating sample of real (anonymized) translated items reviewed by a bilingual staff member monthly is the only credible way to catch quality drift.

A minimal promptfoo config for the quick-add feature looks like:

```yaml
# promptfooconfig.yaml — quick-add extraction regression suite
prompts:
  - "Extract a task from: {{input}}"
providers:
  - id: anthropic:claude-sonnet-5
  - id: openai:vllm-endpoint  # on-prem backend behind an OpenAI-compatible shim
tests:
  - vars: { input: "EGDI hisobotini juma kuniga tayyorla, Malikaga biriktir" }
    assert:
      - type: is-json
      - type: javascript
        value: "output.assignee === 'Malika' && output.due_day === 'Friday'"
```

**[ADOPT]** Stand up a promptfoo suite as part of the CI gate for any AI feature before it ships, and re-run it on every model-version pin change (see §6.1) — this is cheap, open-source, and directly answers "did the switch degrade quality" with evidence instead of a vibe check.

### 3. Uzbekistan's national LLM / AI-localization effort — resolved

This was the report's own flagged priority follow-up, and it is now confirmed rather than "could not verify":

- **There is an active national effort, but no shipped general-purpose Uzbek foundation model yet (as of Sept 2026).** The Ministry of Digital Technologies and the Presidential Administration are building a national AI language model under the **Strategy for the Development of Artificial Intelligence Technologies through 2030** (approved October 2024). As of the most recent reporting, the project is in the **data-collection phase** — government agencies are submitting Uzbek-language datasets (literary texts, analytical materials, and anonymized medical imaging for early-diagnosis pilots) — not yet a trained, released model. [Kun.uz — Uzbekistan to develop national AI language model](https://kun.uz/en/news/2025/08/06/uzbekistan-to-develop-national-ai-language-model-to-preserve-cultural-identity-and-ensure-digital-sovereignty)
- **Compute is scaling but still small.** A small GPU cluster currently supports 20+ healthcare AI projects; a large-scale cluster is planned for 2026 targeting ~100 projects across sectors. An October 2025 presidential decree set 2026 targets of 100 AI projects nationally, AI labs at 15 universities, and over $1 billion in AI-infrastructure FDI by 2030.
- **A concrete cost argument for on-prem exists in the government's own words**: officials cite renting foreign GPU servers at "$10,000–20,000 per month" as the expense the domestic cluster is meant to displace — this is a usable anchor number for our own on-prem-vs-cloud cost case in §6.2 below.
- **Yandex Uzbekistan is the most concrete non-government Uzbek-language NLP effort**, having shipped neural-network-based Uzbek search (trained partly on 11.6M Uzbek Wikipedia/Stack Overflow texts) and opened Uzbekistan's first dedicated ML school in Tashkent (Aug 2025) — a plausible future partner or hiring pool, not itself a product we'd integrate. [Uzdaily — Yandex Uzbekistan neural search launch](https://www.uzdaily.uz/en/yandex-uzbekistan-launches-neural-network-powered-search-in-the-uzbek-language/)
- **A wider local ecosystem exists but is application-layer, not foundation-model**: NavAI (Uzbek speech synthesis/recognition), Speko (voice-AI combining STT/LLM/TTS), Sino AI (clinical decision support), and TBC Uzbekistan / Mikrokreditbank (banking AI agents) — none of these publish or open-source a general-purpose Uzbek LLM we could self-host. [Gorgona AI & ALPHA — Uzbekistan AI Ecosystem Map 2026](https://gorgona.uz/en/blog/ai-uzbekistan-map-2026-updated)

**[ADOPT]** Treat the national model as a **multi-year future option, not a near-term dependency** — plan the on-prem architecture around Qwen3 (or successor) now, and design the LLM gateway (§9) so a future national model can be swapped in as just another backend behind the same interface once it ships.
**[AVOID]** Do not wait for the national model before shipping Phase 1 AI features — at the current pace (data-collection phase, large cluster still "planned for 2026") a usable general-purpose release is not imminent, and blocking on it would stall the entire AI roadmap for a program with no committed ship date.

### 4. Cost control — quantified

The original report asserted a "credits-style" metering concept with no numbers. Order-of-magnitude estimates, using **September 2026 published Claude API pricing** [Finout — Anthropic API Pricing 2026](https://www.finout.io/blog/anthropic-api-pricing), [PE Collective — Claude Cost Optimization 2026](https://pecollective.com/tools/claude-pricing-guide/):

| Model | Input $/MTok | Output $/MTok | Fits which of our features |
|---|---|---|---|
| Claude Haiku 4.5 | $1 | $5 | Quick-add parsing, auto-tagging, classification — small, high-frequency calls |
| Claude Sonnet 5 | $2 | $10 (promotional, through 31 Aug 2026) | Digest drafting, translation, meeting-notes extraction, RAG answers |
| Claude Opus 5 | $5 | $25 | Reserved for the rare high-stakes draft (official memo, policy Q&A synthesis) |

**Discount stacking that matters for our workload shape:**
- **Prompt caching** (cache reads at 0.1× base input price; 5-minute-TTL writes at 1.25×, 1-hour-TTL writes at 2×) is the single biggest lever for us specifically, because every AI feature that reads "the workspace" (Q&A, briefs, digests) re-sends largely the same project/org context on every call — caching that context turns a $2/MTok Sonnet-5 input cost into effectively $0.20/MTok on repeat calls within the TTL window. [Claude Platform Docs — Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
- **Batch API** cuts both input and output cost by 50% for anything that doesn't need a live response — this is exactly the shape of the weekly digest feature (§3 of the main report): compile all sub-department digests as one overnight batch job instead of 23 live calls. Caching + batching together can drop effective cost by 95%+ for that workload. [Claude Platform Docs — Batch processing](https://platform.claude.com/docs/en/build-with-claude/batch-processing)
- **Back-of-envelope for ~23 users at light-to-moderate Phase-1 usage** (quick-add ~15 calls/user/day at ~300 tokens each on Haiku; one cached, batched weekly digest per project; on-demand translation ~5 calls/user/week at ~500 tokens on Sonnet): total Claude API spend lands in the **low hundreds of dollars per month**, not thousands — cheap enough that the "credits" mechanism is a governance/visibility tool (so a department head sees usage), not a cost-survival necessity at this scale. This estimate should be replaced with real metering data after Phase 1 ships, not treated as a procurement commitment.
- **On-prem GPU cost is capex-shaped, not opex-shaped**: the national-effort's own cited alternative cost ($10-20k/month for rented foreign GPU capacity) implies a single owned GPU (e.g., one A100 80GB or L40S-class card, ~$15-30k one-time) pays for itself against that rental benchmark within 1-2 months of equivalent usage — but only if actual concurrent load stays within what one GPU can serve (see §6.2).

**[ADOPT]** Build the credits/metering dashboard from day one of Phase 1, even though projected spend is low — the value is visibility and department-level accountability, not rationing.
**[ADOPT]** Cache the workspace/project context block on every RAG or digest call, and route all digest generation through the Batch API — this single pair of changes is the highest-leverage, lowest-effort cost control available.

### 5. Script handling: Latin vs Cyrillic Uzbek — investigated, not resolved

This was flagged as core to the brief and was investigated as far as desk research allows, with an honest residual gap:

- **Claude's own published multilingual benchmark table does not include Uzbek at all** — the documented languages run from Spanish (98.2% of English baseline, Sonnet 5) down to Yoruba (79.7%); Uzbek is absent from the table entirely, Latin or Cyrillic. [Claude Platform Docs — Multilingual support](https://platform.claude.com/docs/en/build-with-claude/multilingual-support) The best available *historical* data point is from an academic benchmark of Claude 3 Opus on FLORES-200: **chrF++ 66.63 for English→Uzbek, 54.31 for Uzbek→English** — respectable for a low-resource pair but well below high-resource language performance, and FLORES-200's Uzbek test set is in Latin script only, so this number says nothing about Cyrillic. [arXiv 2404.13813 — From LLM to NMT: Advancing Low-Resource MT with Claude](https://arxiv.org/pdf/2404.13813)
- **Script-switching is a recognized, unsolved problem in Turkic NLP generally**, not just for us: a 2026 survey paper on Turkic-language NLP tooling explicitly names Kazakhstan and Uzbekistan's historical Cyrillic→Latin script transitions as requiring "robust and unified transliteration tooling" that does not yet broadly exist. [TurkicNLP (arXiv 2602.19174)](https://arxiv.org/html/2602.19174v2) This confirms the original report's instinct that script handling is unverified — it is unverified industry-wide, not just under-researched by us.
- **No open-model benchmark found tests script variation for Uzbek either.** The one dedicated 2026 Uzbek open-LLM benchmark located during this pass (below) tested standard modern Uzbek text and does not report a Cyrillic condition.

**[ADOPT]** Since no vendor or benchmark answers this, build a **small in-house parallel eval set** (50-100 sentence pairs, ministry-realistic content, in both Latin and Cyrillic Uzbek) before shipping any translation or extraction feature — this is a half-day task, not a research project, and it is the only way to know our actual exposure.
**[ADAPT]** Given Uzbekistan's official script has been Latin since 1993, normalize incoming Cyrillic Uzbek to Latin at ingestion (a deterministic transliteration step, not an LLM call) before any AI feature processes it, rather than asking every model to handle both scripts natively — this sidesteps the open research problem rather than waiting for it to be solved upstream.

### 6. Adjacent gaps a senior lead would expect

#### 6.1 Model versioning and drift management

The §9 gateway assumes switching backends is "a config change, not a rewrite," but the tool-use pricing table alone shows **eight different Claude model versions in concurrent circulation** (Opus 4, 4.1, 4.5, 4.6, 4.7, 4.8, 5; Sonnet 4, 4.5, 4.6, 5) each with measurably different token overhead and presumably different output behavior — version drift is not hypothetical, it is the documented normal state. [Claude Platform Docs — Tool use overview, pricing table](https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview)

**[ADOPT]** Pin exact, dated model identifiers in the gateway config (never a floating "latest" alias) for any feature whose output reaches an official report; require the promptfoo golden-dataset suite (§2 above) to pass before bumping a pinned version; log every pin change (old version, new version, date, who approved) in the same audit trail already recommended in the main report's §9 — this turns "model updated silently" from a risk into a reviewed, reversible event.

#### 6.2 On-prem inference capacity/latency planning

Order-of-magnitude sizing, since the main report punted this entirely:

- A 4×H100 configuration has been benchmarked at ~7,000 tokens/sec sustaining 500 concurrent users; more simply, a GPU's concurrency ceiling is governed by KV-cache size — at a typical 2,000-token request, one GPU holds roughly 200 concurrent slots, dropping to ~50 for 8,000-token requests. [VMware Cloud Foundation Blog, 2026](https://blogs.vmware.com/cloud-foundation/2026/04/30/how-many-users-can-your-llm-server-really-handle/)
- For **~23 users**, even a pessimistic assumption (every user issuing an 8,000-token request simultaneously) fits comfortably within a single mid-range GPU's concurrency budget — this is a one-GPU pilot problem, not a cluster problem, at our current headcount. Scale-out only becomes a real question if/when the platform spreads to other ministries (per the "spread across ministries" ambition in scope).
- vLLM ships a benchmarking CLI specifically for this kind of pre-commitment load test. [vLLM — Benchmark CLI docs](https://docs.vllm.ai/en/latest/benchmarking/cli/)

**[ADOPT]** Before committing to on-prem as the default routing target for sensitive data (§9), run a one-day vLLM benchmarking-CLI load test against the candidate model (Qwen3 variant) on the candidate GPU class, simulating 23-30 concurrent users at realistic (not worst-case) token lengths — this converts "on-prem is feasible" from an assumption into a measured fact before the architecture is finalized.

#### 6.3 Uzbekistan's AI/data-protection legal framework, named

The main report treated "data localization law" as a single blanket constraint. The actual framework has multiple named instruments, and the routing architecture in §9 should cite them directly rather than a generic paraphrase:

| Instrument | What it does |
|---|---|
| **Law No. ZRU-547 "On Personal Data"** (2 July 2019, in force 1 Oct 2019) | The operative law: GDPR-like principles (purpose limitation, data minimization, consent) plus a hard requirement that personal data of Uzbek citizens be **physically processed and stored on servers located within Uzbekistan** — this is the specific clause that defines what must be hard-routed on-prem in §9 |
| **Law No. ZRU-764 "On Cybersecurity"** (2022) | Security-of-infrastructure obligations that extend to systems (including AI infrastructure) processing sensitive data |
| **Cabinet of Ministers Resolution No. 646** (2022) | Establishes the "Special Regime for the Use of AI Technologies" regulatory sandbox — a path to pilot AI features under temporary regulatory exemptions, potentially relevant if we want to pilot a Claude-API-backed feature ahead of a full compliance review |
| **Presidential Resolution PP-4996** (2021) | Earlier AI research roadmap; created the Scientific-Practical Center for Innovative Projects |
| **Strategy for AI Technologies through 2030** (approved by presidential decree, October 2024) | The umbrella strategy behind the national LLM effort (§3 above) and the 2026 AI-adoption targets |

Enforcement sits with **Uzkomnazorat** (the state inspectorate), which can block non-compliant services. [Regulations.ai — Uzbekistan AI Regulation Overview](https://regulations.ai/regulations/uzbekistan-summary), [Regulations.ai — Law on Personal Data text](https://regulations.ai/regulations/RAI-UZ-NA-ZRU5470-2019)

**[ADOPT]** Route the on-prem/Claude-API split (§9) off ZRU-547's actual definition of personal data, not an informal "sensitive-sounding" heuristic — get the ministry's legal counsel to confirm which of our data fields (names, personal task assignments, HR/leave records, telegram IDs) fall under ZRU-547 before the router's rule set is finalized; this is the "legal/compliance sign-off" the Open Questions section already flagged as outstanding, now with the specific law to sign off against.

#### 6.4 Vendor lock-in and data portability for AI-generated content

If any SaaS AI tool (Notion, ClickUp, Lark, etc.) is piloted before the custom platform exists, AI-generated summaries/drafts stored in that vendor's system are subject to the vendor's own export limits, not ours. None of the vendor pages reviewed in this report or the original one make an explicit portability guarantee for AI-generated content specifically (as opposed to raw user content).

**[ADAPT]** Before approving any SaaS AI pilot, require a five-minute export test as a go/no-go gate: create an AI-generated artifact (a meeting summary, a drafted digest) in the candidate tool, then confirm it can be exported via API or bulk-download in a structured, re-importable format — treat this as a pilot precondition, not a post-hoc migration concern.

### 7. Technical mechanisms for the AI layer

This section gives the code-level and architectural detail the original report's §9 gateway concept needed but didn't specify.

#### 7.1 Anthropic API: tool use, structured outputs, prompt caching, batch, streaming

**Tool use / structured extraction** (this is the mechanism behind quick-add parsing, auto-tagging, and every "extraction" feature in the catalogue below). A tool is defined with a JSON Schema `input_schema`; Claude returns a `tool_use` content block with arguments conforming to that schema when it decides to call the tool:

```json
{
  "name": "create_task",
  "description": "Create a structured task from natural-language input.",
  "input_schema": {
    "type": "object",
    "properties": {
      "title": {"type": "string"},
      "assignee": {"type": "string", "description": "Person's name as written by the user"},
      "due_date": {"type": "string", "format": "date"},
      "project": {"type": "string"}
    },
    "required": ["title"]
  }
}
```

Set `"strict": true` on the tool definition to **guarantee** schema conformance (Anthropic's newer strict-mode feature) rather than relying on prompting alone — this matters for a quick-add feature where a malformed field would silently corrupt a task record. Force a call (rather than letting Claude decide) with `tool_choice: {"type": "tool", "name": "create_task"}` when the feature's whole purpose *is* extraction (no legitimate "decline to extract" case). [Claude Platform Docs — Tool use overview](https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview)

**Prompt caching for workspace context.** `cache_control: {"type": "ephemeral"}` on a content block caches it; a 5-minute TTL is default and refreshes free on reuse, a 1-hour TTL costs 2× the base write price but suits once-an-hour digest/briefing generation better than 5-minute. Minimum cacheable size is model-dependent (1,024 tokens for Sonnet 5) — a project's full metadata/history context easily clears that bar. Cache reads cost 10% of base input price; 5-minute writes cost 125%. Practical placement rule for us: put the **stable project/org context** (description, team roster, recent history) in an early cached block, and the **user's specific query** in an uncached trailing block — exactly the "static context first, dynamic query last" pattern Anthropic's own docs warn is easy to get backwards. [Claude Platform Docs — Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)

**Batch API for digests.** The Message Batches API processes large volumes of independent requests asynchronously at 50% of standard input/output price, typically finishing within an hour — the correct mechanism for "compile every sub-department's weekly digest" as one nightly job rather than 23 synchronous calls. Combine with caching on the shared instruction/template block for the stacked 95%+ savings described in §4. [Claude Platform Docs — Batch processing](https://platform.claude.com/docs/en/build-with-claude/batch-processing)

**Streaming** (SSE) is the right mode for any user-facing chat/Q&A surface (ask-with-citations, workspace Q&A) so a civil servant sees an answer forming rather than staring at a spinner — this is table stakes UX, not an optimization.

#### 7.2 Vercel AI SDK (current major version: **AI SDK 7**) as the provider-agnostic layer

As of September 2026 the current major release is **AI SDK 7** (superseding v5 from July 2025 and the short-lived v6), with over 16 million weekly downloads. [Vercel — AI SDK 7 is now available](https://vercel.com/blog/ai-sdk-7) Relevant capabilities for us:

- **`ToolLoopAgent` / `WorkflowAgent` abstractions** map directly onto the "thin orchestration over scoped tools" architecture the main report's §6 already recommends — a `WorkflowAgent` for the predetermined-steps cases (digest generation, translation), a `ToolLoopAgent` reserved for the genuinely open-ended cases (§8's Phase-3 multi-step agent).
- **Provider-agnostic model swapping**: the same application code targets Claude, GPT, or Gemini by changing a provider string, which is the app-layer half of the switchable architecture — the internal LLM gateway (§9) still owns the *routing decision* (which backend for which data-sensitivity tier), while AI SDK owns the *plumbing* (streaming, tool-call parsing, retries) so we don't hand-roll SSE/tool-call handling per provider.
- **MCP Apps**: lets an agent expose a UI-only surface (a dashboard, a preview) separately from the model-visible tool set — useful for the "review before send" pattern the main report insists on for every agentic feature (§8 Phase 3): the model gets a narrow tool, the human gets a rich confirmation UI, without conflating the two.
- **Typed tool contexts**: tools can be scoped so a third-party or lower-trust tool cannot see context it wasn't given — directly useful for keeping a "draft a Telegram message" tool from also seeing restricted HR fields, operationalizing the "narrow, audited tool access" principle from §8.

**[ADOPT]** Use AI SDK 7 as the TypeScript-side abstraction for every AI feature's UI (streaming, tool-call rendering, agent loops), sitting on top of — not instead of — the internal LLM gateway that makes the actual Claude-API-vs-on-prem routing decision.

#### 7.3 pgvector for embeddings + permission-aware retrieval design

**pgvector** (Postgres extension) supports six distance metrics (L2, inner product, cosine, L1, Hamming, Jaccard) and two ANN index types — HNSW (better query performance, no training phase, higher build cost/memory) and IVFFlat (faster build, lower memory, weaker recall) — with a 16,000-dimension ceiling that any standard embedding model (typically 384–3072 dimensions) clears easily. [pgvector — GitHub](https://github.com/pgvector/pgvector)

**The permission-aware retrieval problem the main report flagged in §5 has a concrete answer**: pgvector itself has no concept of access control — it is just a column type and an index. The only safe design, consistent with CLAUDE.md's own "every table has tenant_id" rule, is to **store embeddings as a column on the same tenant-scoped, RLS-protected rows they were derived from** (e.g., an `embedding vector(1536)` column on the `tasks`/`documents` table itself), so that Postgres row-level security policies already enforcing tenant/privacy-tier/role access apply automatically to any `ORDER BY embedding <=> query_vector` search — the retriever physically cannot see a row the querying user's RLS policy excludes. The alternative (a separate flat vector index queried before permission filtering, with results filtered in application code afterward) is exactly the "RAG breach machine" pattern already named as unacceptable in §5 — it should be explicitly ruled out in the eventual TECH-SPEC, not left as an implementation detail.

**[ADOPT]** pgvector co-located on tenant-scoped, RLS-protected tables as the only sanctioned embedding-storage pattern for semantic search and duplicate detection.
**[AVOID]** A standalone vector database or flattened index queried ahead of permission checks, regardless of how much faster it benchmarks — speed is not a defense when the failure mode is a data breach.

#### 7.4 Prompt-injection defenses for agentic tool use

Beyond the lethal-trifecta architectural rule already in §7 of the main report, 2026 research adds concrete implementable patterns:

- **Dual-LLM / quarantine pattern**: the privileged orchestrator (the one with tool access) never reads untrusted content directly; a separate, lower-privilege model first reduces untrusted content (a pasted document, a web page, an email) into a structured, schema-constrained summary before it reaches the orchestrator — this is a direct, buildable instance of the "constrain the architecture so the exploit is structurally impossible" principle the main report already cites from arXiv 2506.08837.
- **Per-session tool allow-listing**: no agent session should have both a data-reading tool over restricted content and an externally-communicating tool (Telegram send, email send) simultaneously available — enforced at the gateway level, not left to prompt instructions, since prompted restrictions are exactly what injection attacks bypass.
- **Red-team-in-CI**: promptfoo's plugin-based attack generation (§2 above) should run against every new tool definition before it ships, specifically probing for prompt-injection and authorization-bypass (BOLA/BFLA) categories — this operationalizes "sandboxed testing" from the main report's Anthropic-guidance citation into an actual repeatable check.

**[ADOPT]** Treat "can this session both read something an attacker could plant text in, and send something externally" as a blocking review question for every new agentic feature, checked in code review, not just documented as a principle.

#### 7.5 Evaluation: promptfoo (or equivalent) — see §2 above for the full treatment; summarized here for completeness of this technical-mechanisms section: golden-dataset regression + LLM red-teaming + human-rated sampling, run in CI, gating both feature ships and model-version pins.

#### 7.6 Uzbek-language quality evidence for current Claude and open models

This is the single most consequential correction this addendum makes to the main report's confidence level:

- **Claude**: no current official Uzbek benchmark exists (the platform docs' multilingual table stops at Yoruba, omitting Uzbek entirely). The best available data point remains the historical Claude 3 Opus FLORES-200 result — chrF++ 66.63 (en→uz) / 54.31 (uz→en) — moderate-to-good for a low-resource pair but dated (Claude 3 generation) and Latin-script only. **Treat current-generation Claude's Uzbek quality as unverified, not assumed-good, until we run our own eval set (§5 above).**
- **Qwen3 — the main report's recommendation needs an important qualifier.** A 2026 independent benchmark tested seven small open-weight models (0.6B–2B parameters, including **Qwen3-0.6B**) on Uzbek translation/comprehension/generation across 180 samples spanning formal, news, technical, conversational, and jargon registers. Result: **only Kimi-K2-Instruct (Moonshot AI, a ~1-trillion-parameter MoE model, not a small model) reached "practical usability" (BLEU 0.54)**; the smaller models tested — Qwen3-0.6B included — "often produced incoherent output or mixing languages." [Zenodo — Benchmarking Pre-trained Open-Source LLMs for Uzbek](https://zenodo.org/records/17223973) **This means the main report's Qwen3 recommendation, while directionally sound (Qwen3 does explicitly name Northern Uzbek in its supported-language list), was verified against the *language list*, not against *actual generation quality at deployable model sizes* — the qualifier that a **larger Qwen3 variant (8B/14B/30B-A3B or above)** must be benchmarked before commitment, not the 0.6B tested here, is new information this addendum adds.**
- **Kimi-K2** itself is open-weight (Modified MIT license) and evidently strong on Uzbek, but at ~1T total parameters it is impractical to self-host at ministry scale (23 users, modest GPU budget) without a materially larger infrastructure investment than the Qwen3-on-vLLM plan assumes — worth flagging as a quality benchmark to chase, not a deployment target, unless a much larger compute budget materializes.
- **No source found tests Cyrillic Uzbek specifically for any model** — this gap (§5 above) remains genuinely open industry-wide.

**[ADOPT]** Before finalizing Qwen3 as the on-prem default, benchmark at least one mid-size Qwen3 variant (8B or 14B, not 0.6B) against the same 180-sample-style test used in the Zenodo study, or a similar in-house set — the language-list claim alone is necessary but not sufficient evidence.
**[AVOID]** Do not deploy Qwen3-0.6B (or similarly small quantized variants chosen purely for low GPU cost) for any user-facing Uzbek translation or drafting feature — the only real benchmark data available shows small variants in this class are not fit for purpose on Uzbek specifically, independent of their listed language coverage.

### Intelligent (non-chatbot) AI feature catalogue for a team-tracking tool

Twenty-three concrete features, each evaluated on what it does, where it surfaces, the model capability it needs, the data it touches (with our three-tier privacy model — Public / Internal / Restricted — from §5 of the main report), and its specific failure mode to design against.

1. **Natural-language quick-add (uz/ru/en).** *Does:* parses free text into a structured task/project (title, assignee, due date). *Surface:* global Ctrl/⌘+K quick-add bar. *Capability:* extraction via tool-use JSON schema. *Data/tier:* the user's own typed text only — Internal. *Guard against:* silent mis-assignment on ambiguous input (wrong person/date) — always show an editable preview before create, never silent-create.

2. **Weekly pulse drafting from activity.** *Does:* drafts a per-project/department status update from structured activity (status changes, comments, deadline moves), not free transcript. *Surface:* editable draft in the Friday digest composer. *Capability:* summarisation over structured records; ideal Batch API + caching candidate. *Data/tier:* project/task metadata — Internal. *Guard against:* a fluent but stale draft if the activity feed lags — timestamp "as of" and require human send.

3. **Meeting notes → tasks.** *Does:* extracts action items from a transcript into draggable task drafts. *Surface:* post-meeting review panel, accept-per-item. *Capability:* extraction + classification (owner/due-date guess). *Data/tier:* meeting transcript, can contain sensitive personnel discussion — Restricted. *Guard against:* silently dropping or misattributing an item — show extracted-vs-original side by side, no auto-create.

4. **Workload-aware assignee suggestion.** *Does:* suggests an assignee based on current open-task load. *Surface:* suggested-assignee chip in the task-creation form. *Capability:* classification/ranking over structured workload counts (LLM optional, for rationale text only). *Data/tier:* task counts per person — Internal. *Guard against:* recommending an already-overloaded top performer — cap suggestions to people under a load threshold.

5. **Deadline-risk prediction.** *Does:* flags tasks/projects likely to miss deadline from velocity/comment cadence. *Surface:* a risk badge on the task/project card. *Capability:* classification, optionally LLM-authored rationale. *Data/tier:* task history/comments — Internal. *Guard against:* alert fatigue from over-flagging — tune conservatively and always show the "why."

6. **Stalled-work detection.** *Does:* surfaces items with no activity in N days as an escalation suggestion (extends the reference prototype's own auto-escalation rule). *Surface:* dashboard widget + optional Telegram nudge to the owner. *Capability:* rule-based classification. *Data/tier:* task/comment timestamps — Internal. *Guard against:* flagging legitimately blocked work as "stalled" — provide a "mark blocked/snooze" action that suppresses the flag.

7. **Duplicate detection.** *Does:* flags likely-duplicate tasks before creation. *Surface:* inline warning in the create-task form ("looks similar to Task #482"). *Capability:* embeddings similarity (pgvector). *Data/tier:* task titles/descriptions tenant-wide — Internal. *Guard against:* over-triggering on generic titles eroding trust — tune threshold against a labeled set, always allow "not a duplicate."

8. **Auto-tagging.** *Does:* assigns topic/department/priority tags on creation. *Surface:* pre-filled, editable tags. *Capability:* classification. *Data/tier:* item title/description — Internal. *Guard against:* mis-tagging must never change the item's *privacy tier*, only topical tags — tagging and access control must be strictly separate systems.

9. **"What did I miss" catch-up after leave.** *Does:* personalized summary of changes in a user's own projects while away. *Surface:* a card on first login after a marked absence. *Capability:* summarisation, permission-scoped to what the user can currently see. *Data/tier:* the user's own accessible activity — Internal, user-scoped. *Guard against:* surfacing an item whose access level changed while the user was away — re-check permissions at generation time, not at time-of-change.

10. **Newcomer "explain this project" briefs.** *Does:* plain-language project overview for a first-time viewer. *Surface:* "New here? Get a briefing" button on project pages. *Capability:* summarisation + RAG over the project's own docs/history. *Data/tier:* project description, docs, milestones — Internal. *Guard against:* inventing scope/goals not actually documented — ground strictly in retrieved fields, cite the source for each claim.

11. **Onboarding-plan drafting per role.** *Does:* drafts a checklist/timeline for a new hire from a role/sub-department template. *Surface:* auto-populated draft in the onboarding module, manager edits before assigning. *Capability:* constrained generation from template + structured role data. *Data/tier:* role metadata, org template library — Internal. *Guard against:* referencing an outdated tool/system no longer in use — source steps from a dated, maintained template library, not free generation.

12. **Event date suggestion from availability.** *Does:* proposes team-building/event dates avoiding calendar conflicts. *Surface:* suggested date chips in event creation. *Capability:* constraint-solving over calendar/leave data (LLM optional, for phrasing only). *Data/tier:* staff calendars/leave records — Internal. *Guard against:* suggesting a technically-free but culturally inappropriate date (an uncalendared local/religious holiday) — maintain an explicit holiday calendar as a hard constraint, not inferred.

13. **Retro summarisation.** *Does:* condenses retrospective discussion into themes and action items. *Surface:* auto-generated, editable retro summary doc. *Capability:* summarisation + theme clustering. *Data/tier:* retro comments, can include critical feedback about individuals — Restricted. *Guard against:* attributing a criticism to an identifiable person beyond what the commenter intended — default to anonymized/aggregated theming unless the team opts into attribution.

14. **Translation of any item on demand.** *Does:* translates any task/comment/doc between uz/ru/en on click. *Surface:* a "Translate" toggle on any text field (Lark's inline pattern, §1 above, is the UX reference). *Capability:* generation (translation), human-reviewed for official-register text. *Data/tier:* inherits the source item's own tier. *Guard against:* silently mistranslating a legal/policy term — never auto-publish over the original, always show both and flag machine-translated text visibly.

15. **Semantic search across the workspace.** *Does:* natural-language search returning ranked relevant items, not just keyword matches. *Surface:* augments the Ctrl/⌘+K search panel. *Capability:* embeddings (pgvector) + permission-aware retrieval (§7.3 above). *Data/tier:* everything the searching user can already see — tier varies per item. *Guard against:* the RAG-breach pattern from §5 of the main report — enforce RLS at the SQL query level, never filter after retrieval.

16. **Ask-with-citations.** *Does:* answers a natural-language question about the workspace with a generated answer plus links to source items. *Surface:* a chat panel docked over the workspace (the Notion/Slack pattern from §2 of the main report). *Capability:* RAG + citation-constrained generation. *Data/tier:* retrieved items only, permission-scoped. *Guard against:* the NYC MyCity failure mode (confident wrong answer, no real citation) — hard-refuse to answer when retrieval confidence is low, never guess.

17. **Multi-step agent execution** (e.g. "move all overdue items of X to next week and notify them"). *Does:* plans and executes a bounded multi-step operation via tool calls. *Surface:* a confirmation preview listing every planned action before execution, plus an undo window after. *Capability:* agentic tool use (planning + multiple scoped calls) — AI SDK's `ToolLoopAgent` (§7.2). *Data/tier:* whatever tasks/contacts are touched — Restricted by default, since bulk-modify + notify is two legs of the lethal trifecta at once. *Guard against:* misinterpreting "X" (project vs. person vs. tag) and bulk-modifying the wrong set — always preview the exact diff, support one-click bulk-undo.

18. **Smart notification digesting.** *Does:* batches/prioritizes notifications into a ranked daily digest instead of a firehose. *Surface:* notification inbox, digest-mode toggle. *Capability:* classification/ranking. *Data/tier:* the user's own notifications — Internal. *Guard against:* burying a genuinely urgent item under noise — always show @mentions and deadline changes immediately regardless of digest mode.

19. **Auto-linking related items.** *Does:* detects and suggests cross-references between tasks/projects/docs that implicitly mention each other. *Surface:* a "Related items" panel with confirm-to-link chips. *Capability:* embeddings similarity + entity extraction. *Data/tier:* item text tenant-wide — Internal. *Guard against:* linking superficially similar but unrelated items and cluttering context — confirm-to-link only, never silent auto-link.

20. **Similar-past-project retrieval for planning.** *Does:* surfaces similar past projects with actual timelines/effort when starting a new one. *Surface:* "Projects like this" panel in the new-project wizard. *Capability:* embeddings retrieval. *Data/tier:* historical project metadata (durations, headcount) — Internal. *Guard against:* anchoring a bad estimate on a superficially similar but structurally different project — show the concrete similarity basis (tags/size/department), not just a black-box score.

21. **Anomaly detection in leave/expense/trip requests.** *Does:* flags statistically unusual requests for review. *Surface:* a review flag on the approval screen, never an auto-reject. *Capability:* classification/anomaly scoring over structured data. *Data/tier:* personal HR/leave/expense records — Restricted. *Guard against:* embarrassing a requester with a legitimate but unusual circumstance — flags visible only to the approver, never broadcast, and require a stated reason before any consequence follows.

22. **Burnout/overload signal surfacing** (a feature to design carefully). *Does:* surfaces aggregate workload/after-hours-activity signals to a manager — never named-individual surveillance. *Surface:* a department-level (not person-level) workload heatmap for the director. *Capability:* classification/aggregation over activity timestamps. *Data/tier:* aggregated activity timestamps — Restricted even in aggregate, given HR sensitivity. *Guard against:* becoming de facto individual surveillance, or feeding performance review punitively — hard floor on minimum group size before any number is shown (e.g., never render a metric for a group under 3-5 people), and an explicit policy barring this data from performance review without the employee's own input.

23. **Standup/status auto-compilation across sub-departments.** *Does:* rolls up each sub-department's status inputs into one brief for the director. *Surface:* the director's daily/weekly rollup view. *Capability:* summarisation over structured status fields. *Data/tier:* cross-department status entries — Internal. *Guard against:* flattening genuinely different urgency levels into same-looking bullets, hiding a real crisis in one sub-department — preserve and surface explicit severity flags rather than re-summarizing them away.

### Consolidated verdicts from this addendum

16. **[ADOPT]** Stand up a promptfoo golden-dataset + red-team suite as a CI gate for every AI feature and every model-version pin change (§2, §6.1, §7.4).
17. **[ADOPT]** Cache the stable workspace/project context block on every RAG or digest call, and route all digest generation through the Batch API — the single highest-leverage cost control available (§4, §7.1).
18. **[ADOPT]** Store embeddings as columns on the same tenant-scoped, RLS-protected tables they're derived from — never a standalone flat vector index queried ahead of permission checks (§7.3).
19. **[ADOPT]** Use AI SDK 7 as the app-layer provider-agnostic plumbing (streaming, tool-call parsing, agent loops), with the internal LLM gateway retaining sole authority over the sensitivity-based routing decision (§7.2, §9 of the main report).
20. **[ADOPT]** Pin exact, dated Claude model identifiers for any feature reaching an official report, gated by the promptfoo regression suite before any version bump (§6.1).
21. **[ADOPT]** Run a one-day vLLM load test at realistic 23-30-concurrent-user token lengths before finalizing on-prem as the default routing target for sensitive data (§6.2).
22. **[ADOPT]** Get ministry legal counsel to map our actual data fields against Law No. ZRU-547's definition of personal data before finalizing the router's rule set (§6.3).
23. **[ADAPT]** Normalize incoming Cyrillic Uzbek to Latin at ingestion via deterministic transliteration, rather than expecting every model to handle both scripts natively (§5).
24. **[ADAPT]** Borrow Lark's inline, no-invocation translate-on-any-message UX pattern, while keeping our own human-review gate for official-register text (§1).
25. **[ADAPT]** Require a five-minute AI-content export test as a go/no-go gate before approving any SaaS AI pilot (§6.4).
26. **[AVOID]** Do not deploy Qwen3 at small/quantized parameter counts (e.g., 0.6B) for user-facing Uzbek translation or drafting — the only real benchmark found shows this class of small open model performing poorly on Uzbek specifically; benchmark an 8B+ variant before committing (§7.6).
27. **[AVOID]** Do not treat a single agent session's access to both a restricted-data-reading tool and an externally-communicating tool as acceptable under any circumstance — enforce the split at the gateway level, not by prompt instruction alone (§7.4).
28. **[AVOID]** Do not wait for Uzbekistan's national AI language model before shipping Phase 1 — it is still in the data-collection phase with no near-term release signal (§3).
29. **[AVOID]** Do not adopt Lark (or any foreign-hosted SaaS suite) as an actual platform choice for this ministry regardless of its UX merits — no evidenced Uzbekistan data-residency path (§1).
30. **[AVOID]** Do not let auto-tagging or any classification feature change an item's privacy tier — tagging and access control must remain strictly separate systems (feature #8 above).
