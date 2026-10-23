# Home, assistant and detail-view refinement

## Information hierarchy

Home answers three different questions without turning them into competing screens: what is my current workload, what changed, and what is due next. Desktop keeps the personal inbox on the left and work/workforce above upcoming dates on the right. On phones, Inbox and Work overview are explicit destinations inside Home; their lists scroll within the available viewport. The background wash belongs to the main surface, including its padding.

Member work uses one origin/lifecycle selector: Individual tasks, Group projects, Done, Archived. Active-stage metric shortcuts show all matching assignments, grouped by origin, with a visible, clearable To do/In progress filter so that the results match the global metric count. Returning to an origin tab restores that category. The Completed total shows Done and Archived groups together; its subcounts select exactly one lifecycle across both origins. Active tasks sort by due date, then priority and stable task order. Projects follow their nearest assignment deadline, project deadline, assignment priority and name. Home rows open details; they never complete a task on a stray checkbox click.

Inbox category counts cover the full matching feed, not only loaded rows. Pagination preserves timestamp precision and a stable ID tie-breaker. Snoozed items leave the active feed until due. Existing read, archive, undo and keyboard behavior remain available inside Home.

The filled metric identifies the member's unit. Work counts use neutral surfaces. Color therefore establishes context without suggesting an undocumented status. Events retain an event icon and label alongside dates; deadline and event entries are not distinguished by color alone.

## Assistant workspace

Assistant sits directly below Home in navigation. Saved conversations remain alongside the conversation on desktop and in a history sheet on phones. History is a list of single-line titles, not cards: 36px rows for a fine pointer and 44px touch targets, no repeated timestamps or decorative message icons, and the complete title remains available on hover. Search covers titles and message text, paginates within that result set, and preserves owner and department isolation.

Existing conversation URLs redirect to the dedicated workspace. Cited records keep the conversation ID through card and board-view navigation so Back to assistant resumes the same saved thread. Existing queue persistence, confirmation proposals, attachments, cancellation, retries and reader-aware scroll following remain in use.

## Detail views and settings

The card drawer keeps identity, status and core actions stable while its body scrolls. Assignee, priority and due date form a compact essential-property group. Checklist, discussion and attachments remain easy to reach; less common properties use More details. Comment pencil/trash controls retain accessible names, keyboard tooltips and touch targets. Everyone/Mine transitions move the whole surface through the same fade; interrupted transitions continue from their current opacity, and reduced-motion users switch immediately.

The professional profile uses a compact horizontal identity without a cover image. Email, phone and location share one desktop row, adapting to missing location and narrow widths. Skills, languages and interests use consistent icon/label/content alignment. Settings panes share the Account layout and compact section headings instead of embedding a second page hero. Form fields use responsive related groups rather than unnecessary full-width rows.

Notification settings expose independent In-app and Telegram choices for each reason. In-app preferences apply when new notifications are created and control inbox, live notices and browser push; existing history stays visible. Telegram delivery and authorized calendar feeds remain independent of those settings.

## Design references

- [NN/g: Progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/) supports keeping frequent actions visible while deferring secondary properties.
- [NN/g: Icon usability](https://www.nngroup.com/articles/icon-usability/) supports familiar symbols with accessible labels and tooltips; icons do not replace ambiguous actions without a label.
- [Visa Product Design System: Chat](https://design.visa.com/patterns/chat/usage/) supports a dedicated workspace, persistent history navigation, clear new-chat controls and starter prompts.
- [W3C: Grouping controls](https://www.w3.org/WAI/tutorials/forms/grouping/) supports related settings fields and clear group headings.
- [W3C: Target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) informs compact desktop controls with usable touch targets.
- [W3C: Animation from interactions](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html) informs reduced-motion behavior and interruption-safe transitions.

These principles guide decisions; viewport, keyboard, persistence, permission and accessibility checks provide evidence for this implementation rather than a claim that a design is universally perfect.
