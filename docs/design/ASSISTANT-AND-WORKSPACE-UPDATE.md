# Workspace and assistant update

Implementation decisions for the October 2026 request. The existing product tokens and permission model remain the design foundation.

## Interaction model

- Home is personal for a member: own task states, unit, joined projects, upcoming deadlines and distinct event rows. The head retains department aggregates and a cached briefing. Both use the same persistent private assistant.
- Pages opens a reader with visible attachments. Editing is explicit, with visual formatting and Markdown input. Shared members can revise/delete/restore, with versions and audit records. Page AI drafts an editable body from the title; translation is separately labeled.
- Settings uses selected panes grouped into Profile, Workspace and Security. Account preferences stay together; the professional history has room of its own. Legacy settings links redirect into the correct pane.
- Comments can be revised/deleted by their permitted authors. Editing mentions retires stale inbox references and notifies newly mentioned people once. External messages already delivered cannot be reliably retracted; queued stale delivery is suppressed.
- Event logistics close when the event ends. Discussion and feedback remain available. Archived work is visible within completed work; the redundant archive destination and ineffective table density setting are removed.

## Assistant authority

The assistant selects from the fixed catalog in `apps/api/src/modules/ai/action-catalog.ts`. It cannot invent an endpoint, execute SQL, run an uploaded file, administer accounts, or wipe a database. Changes remain proposals until the user confirms the canonical argument preview. Editing a proposal creates a replacement review; it does not mutate an already approved request.

Execution re-enters ordinary domain routes with the current session and CSRF token, so role/ownership checks, optimistic conflicts, event locks and audit/outbox behavior apply equally to AI and direct edits. AI activity records identify the actor and the proposal. Confirmation is claimed durably before dispatch; duplicate requests cannot repeat creation. An interrupted dispatch asks the user to inspect the destination rather than blindly repeating an uncertain operation.

No title or model summary can replace the canonical payload in the preview. Unknown arguments are rejected rather than silently stripped. Uploaded-file IDs belong beside the resource body and must refer to clean, owned files in the same chat.

## Context and cache boundaries

- Each request reads current permitted department records and only the requesting user's private workspace. A head cannot read another member's private notes or conversations.
- A durable change journal re-indexes changed records. Department snapshot reuse is revision-aware; missing follow-up references force a fresh bounded selection. Account names/status are read fresh. Complete saved conversation turns and action states accompany the current records.
- Extracted attachment text is cached by immutable storage object key and parser version. Each use rechecks live file, parent, scan and owner permissions. A deleted or moved private file cannot survive merely because a cache exists.
- Office/PDF/HTML/text extraction runs in a bounded worker with OCR and embedded-file extraction disabled. HTML is parsed as inert text. Uploaded code is never executed. Media and unsupported formats remain attachable but are explicitly marked unreadable to the assistant.
- Text extraction is limited to 20 MiB per file, 160,000 characters per file and a shared per-request time/context budget. Bounded/partial context is reported, never presented as exhaustive. The provider receives authorized content only through the configured ministry endpoint.
- File uploads retain malware scanning and the existing superadmin approval requirement above 100 MiB. Large-file approval does not bypass parsing limits or scan checks.

## Reliability

Synthetic live tests reproduced the GLM empty-answer failure and verified `reasoning_effort: low` on the configured GLM-5 endpoint. The application distinguishes empty output, timeout, unavailable service, disabled feature and budget exhaustion. It preserves the question for retry. No provider reasoning text is shown or stored as chat content.

The live probes use synthetic records and never execute production changes. Deterministic provider fixtures and real PostgreSQL/API integration tests separately verify confirmed mutations, duplicate confirmation, stale versions, permissions, cache freshness and file privacy. Desktop/mobile browser journeys cover the visible flows and accessibility.

## Design and engineering sources

- [NN/g: Progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/) — reader/editor separation and focused settings panes.
- [Anthropic: Building effective agents](https://www.anthropic.com/engineering/building-effective-agents) — constrained workflows and clear action boundaries.
- [Anthropic: Writing effective tools](https://www.anthropic.com/engineering/writing-tools-for-agents) — explicit tool schemas, meaningful errors and actionable results.
- [Anthropic: Context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) — current evidence, durable history and bounded context.
- [Tiptap Markdown](https://tiptap.dev/docs/editor/markdown/getting-started/basic-usage) — Markdown and visual editing conventions.
- [officeParser](https://github.com/harshankur/officeParser) — parser configuration and extraction limits.
- [Z.ai thinking mode](https://docs.z.ai/guides/capabilities/thinking-mode) — provider behavior; supported settings were verified against the actual configured endpoint rather than assumed.

No claim of perfect intent recognition is made. Ambiguous people, targets or dates require clarification, and unsupported operations must be reported truthfully.
