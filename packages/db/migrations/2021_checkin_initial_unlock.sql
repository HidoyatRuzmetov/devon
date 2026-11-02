-- One-time repair of the accidental locks in the first cycle, starting 2 November 2026.
-- The migration journal runs this once. No runtime unlock action or recurring reset is added.
-- Later cycles and their normal automatic deadlines are unaffected.
-- Run the data repair as the migration connection's superuser across all departments.
reset role;

update app.checkin_member_locks l set checkin_locked_at=null,checkout_locked_at=null
from app.checkin_cycles c where l.cycle_id=c.id and c.starts_on=date '2026-11-02';

update app.checkin_cycles set checkin_locked_at=null,checkout_locked_at=null
where starts_on=date '2026-11-02';
