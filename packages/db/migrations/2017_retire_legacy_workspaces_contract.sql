-- CONTRACT: safe because the application removes these retired features and deployment requires a restored backup proof with writes stopped.
-- Contract migration: deploy only after a verified, access-restricted full database backup.
-- Existing private to-dos and timer sessions remain. Historical audit events remain immutable.
-- No CASCADE: an unexpected dependency must fail the migration instead of deleting more data.
set role devon_migrator;

alter table app.personal_tasks drop column sprint_id;
alter table app.pomodoro_sessions drop column task_id;
drop table app.shared_canvases;
drop table app.personal_canvases;
drop table app.personal_notes;
drop table app.personal_sprints;
drop type app.shared_canvas_scope;
drop type app.personal_sprint_kind;
drop type app.personal_sprint_status;

drop table app.automation_runs;
drop table app.automation_rules;
drop type app.automation_trigger;
drop type app.automation_run_status;
drop table app.field_requests;
drop table app.field_values;
drop table app.field_defs;
drop table app.people_views;
drop table app.goals;
drop type app.goal_metric;
drop table app.work_capacity;
drop function app.focus_minutes_by_user(uuid, timestamptz);

drop table app.analytics_pinned_charts;
drop table app.analytics_saved_filters;
drop table app.analytics_daily;

set local app.actor_role='super_admin';
update app.departments
set features=features-'custom_fields'-'person_fields'-'workload'-'goals'-'automations';
reset role;
