# Devon — feature plan, version 3 (final for build)

2026-09-05. Supersedes v2. The technical contract is `TECH-SPEC.md`; the visual contract is
`DESIGN.md`; the task list is `TASKS.md`; the hardening checklist is `agentic/HARDENING.md`.

## The plan in four paragraphs

**What it is.** Devon is a self-hosted place where a department runs its week, made to be repeated
for any department that wants it. A person registers with a name, a photo and, if they like, a
title; then they either create a department, which the super admin approves once and which makes
them its head, or join one with a key and a password from an invitation that copies itself in their
language. Inside, the structure belongs to everyone: bo'limlar and sub-bo'limlar can be added,
renamed and removed by any member, and people assign themselves as bo'lim boshlig'i or simply as
members, unless the head turns that freedom off. The product looks finished whether a department
has five unit heads or none. There is no ministry layer, no HR module, no document registry and no
chat; there is one super admin who can see and change everything and whose every action is written
to a log that nobody, including them, can erase.

**The work.** The department board is a column for every person, grouped under colour-coded
bo'lim sections. Each card says who gave the work, to whom, by when, with links rather than files,
a nested checklist, a description, and a comment timeline that reads like Jira's activity without
Jira's ceremony. Done cards leave the board into the person's archive, which the whole department
can read. Group projects appear as one card in every member's column, with objective tasks that
move together and subjective tasks each member owns. Table, timeline, calendar and "mine" are views
of the same cards; a filter line is a shareable URL; quick-add reads "Nodira: EGDI paketi, juma".
Analytics belongs to everyone: throughput, on-time rate, load per person and unit, overdue trends,
project progress, event participation, filtered by anything and exportable. Each person also has a
private workspace: sprints of three hours, a day or a week, nested checklists, notes, a sticky-note
canvas, and a Pomodoro timer with sensible defaults that they can change.

**The life.** Events are made in a minute: title, time, place, an illustration, RSVP with guests,
a deadline and a waitlist, comments, a "who brings what" list, carpooling where drivers offer seats
and colleagues claim them, polls for dates and choices (anonymous if wanted), reminders a day and an
hour before, change notices with the diff, cancellation that tells everyone, photos and feedback
afterwards. Telegram carries all of it: a person links the bot in Settings and picks what to
receive; a department connects the bot to its group with the join key and chooses which updates the
group sees. The AI helpers are small and specific, each with a preview before anything is saved:
parse a quick-add in any of the four languages, break a card into subtasks, plan a sprint, explain a
deadline risk, draft a weekly summary, draft an event with its checklist and poll options, summarise
a long comment thread, turn "overdue cards of Data bo'limi this month" into a filter and a chart,
translate anything, and tell you what you missed while away. They run on the government's own GLM
model, cost is visible per department, and a golden test set guards every one.

**The rules and the switches.** Calm by default, dense on demand; one primary action per screen;
plain Uzbek; Palette B with the ministry navy used once; motion that explains in three durations;
undo instead of confirm; autosave that says "Saqlandi"; numbers only where someone acts on them.
Every epic is verified against a thirty-section production-hardening checklist and the last epic
executes it end to end with before/after measurements. The super admin has two switches: pause,
which shows a message written in four languages while nothing else works, and wipe, which through a
small host-side sentinel removes everything about this project from the server and nothing else,
after a password, a second factor, a typed phrase and a sixty-second countdown.

## What we refuse
Ministry views, HR (leave balances, trips, attestation, birth dates, IDs), document editing or
registries, chat, custom workflow engines, per-person productivity scores or leaderboards,
attendance tracking, product tours, more than one way to create a department, deletion of audit
history, a default chatbot, secrets in the repo, and any animation that performs instead of explains.

## Decisions
See `TECH-SPEC.md` §19 (18 frozen decisions). Nothing blocks the build.
