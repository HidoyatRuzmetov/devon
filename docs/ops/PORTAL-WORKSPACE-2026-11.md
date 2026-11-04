# Check-in workspace and professional records

## Check-in flow

```mermaid
flowchart TD
    A[Choose period and person] --> B{Checkout closed?}
    B -->|Yes| C[Read frozen results; open source card]
    B -->|No| D{Saved deliverables or recovered choices?}
    D -->|No deliverables| E[Selection view: all assigned tasks]
    D -->|Saved deliverables| F[Show selected rows, grouped by project]
    D -->|Recovered choices| E
    F -->|Floating pencil| E
    E --> G{Check-in agreed?}
    G -->|No| H[Choose or remove rows; edit permitted source content]
    G -->|Yes| I[Keep agreed rows; add more deliverables]
    H --> J[Tick: submit additions and removals atomically]
    I --> J
    J --> K{Current server rules permit every change?}
    K -->|Yes| F
    K -->|No| L[Show error; retain choices for correction]
    L --> E
    E -->|Cancel| F
    F --> M[Update Pending / Blocked / Done]
    M --> F
    F -->|Head: agree check-in| N[Confirmation unless personally opted out]
    N --> O[Lock this person in this period only]
    O --> F
    F -->|Head: agree checkout| P[Confirmation unless personally opted out]
    P --> C
    Q[Checklist plus in Cards drawer] --> R{Current period checkout open?}
    R -->|Yes| F
    R -->|No| S[Reject addition]
```

The same backend rules apply to the page, card drawer, assistant and direct API calls. The UI never grants permissions beyond the actor's ordinary task permissions. Agreement is per person and period. The Nov 2 unlock was a previous one-time migration; this release does not repeat it.

| Operation | Unagreed | Check-in agreed | Checkout closed |
| --- | --- | --- | --- |
| Choose deliverables | Add/remove | Add only | No |
| Change period progress | Yes | Yes | No |
| Change agreed checklist wording | Only if no other retained agreement protects it | No | No |
| Rename source task / change priority | Ordinary source permissions | Ordinary source permissions | Source card only; historical results stay frozen |
| Add new source checklist items | Yes | Yes | Source card only |
| Delete referenced task/checklist | Never while any retained check-in reference exists | Never | Never |
| Reorder period cards | Yes | Yes | No |

Priority order is urgent, high, medium, low, then no priority. Moving a group switches that person's period layout to manual. Project headings occur once; task headings retain their own priority. Blocked rows count toward total, never done. Selection is saved as an atomic delta; stale versions or newly locked content are rejected without partial writes. Unsaved choices survive navigation in the same browser session. Title/checklist edits use explicit edit controls and Enter/Escape.

The timer is at the right of the person header, left of the existing controls. It uses a deadline to stay accurate in background tabs. It offers start/resume, pause, stop/reset, optional sound, and 20/10-second/completion effects. Reduced motion is respected.

## Records and downloads

Professional settings has Résumé and Personnel record tabs. Draft typing is saved locally under the account and department; publishing/sharing requires Save. Optimistic revisions prevent overwriting a newer saved record. Device storage failures are shown.

Personnel records are available only to the owner and the department head, with database RLS and API authorization. They are not included in the public directory or the assistant's automatically collected context. The original supplied form's validation and document rules are retained. The editor uses two document pages with inline fields and examples; Preview shows the completed document, and clicking a value returns to editing. Latin/Cyrillic downloads use AI to identify names to preserve and show an editable document review without modifying saved data. Automatic transliteration cannot resolve every linguistic ambiguity; the review is deliberate.

People uses cards only. Search is followed by a multiselect unit dropdown. The head sees a small download row under education: résumé Word export and personnel record with Latin/Cyrillic downloads. The résumé contains the complete saved public professional profile, including all descriptions, education, experience, skills, languages, hobbies, certifications and links. Word paginates longer profiles naturally without truncation, fixed page limits or a footer referring to People. No private family information enters a résumé.

Profile photo controls include crop, pan, zoom, rotate, mirror and reset. The avatar is square and the personnel portrait is 3:4. People photos open in a separate lightbox; Escape closes the topmost overlay first.

## Calendar and assistant

Personal appointment attendees see the shared appointment and notes in their own calendar. Only the organizer edits/cancels it. Invitations, changes and removals generate deduplicated notifications. Private appointments without attendees remain private, including from the head.

Assistant actions use the ordinary domain routes and confirmation flow. The catalog includes check-in selection/layout, public/private profile updates, calendar attendees, task/project/checklist operations, focus, dependencies, reminders, time logs, templates and personal timers. The product-owned UI guide describes the actual navigation and controls separately from untrusted document content. Telegram group messaging is head-only, verifies group membership for mentions, and claims an operation receipt before sending. An ambiguous delivery is not automatically resent.

## One-time release operations

Migrations 2022–2027 add database protections, conservatively restore recoverable referenced sources, correct provable accidental archives, clear only the old free-text position/education values, and add private records/calendar invitations/group-message receipts. Explicitly archived cards remain archived. Physically deleted records cannot be reconstructed without source data.

The authorized education/position announcement was sent once with receipt `4826b8b2-8de7-4548-b4c0-d8e06ec99228`. Do not resend on retries, subsequent releases or application restarts.

## Validation

Local verification includes 1,116 database migration checks; check-in, calendar, private-record and Telegram authorization integration tests; 52 AI context/action integration tests; browser flows for grouped selections, timers, drawers, draft recovery, photo cropping/lightboxes, head downloads, unit filtering and attendee calendars; desktop/mobile accessibility checks; and rendered Latin/Cyrillic personnel documents plus one-/two-page résumé samples. Release CI and production readiness remain mandatory.

Terminology and crop references: [official higher education services](https://my.gov.uz/en/life-situations/069371c8-defc-41bf-ac89-eb01013bd7d1), [Uzbek academic degree regulation](https://lex.uz/uz/docs/3213407?otherlang=4), [official position terminology](https://nqaae.uz/en/structure/rahimboyev-sardor-qahramonovich), and [Telegram photo editor](https://translated.telegram.org/blog/photo-editor-and-passcodes).
