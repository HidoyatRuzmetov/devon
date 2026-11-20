set role devon_migrator;

-- Retire published photos by changing the account pointer. Only a future explicit
-- erasure completion queues storage deletion. Administrative tombstones retain
-- historical identity and the last published photo. Existing requests are untouched.
alter table app.uploads add column avatar_erasure_token uuid;
create index uploads_avatar_erasure_queue on app.uploads(id)
  where avatar_erasure_token is not null;

create function app.queue_erased_account_avatars() returns trigger language plpgsql as $$
begin
  if new.completed_at is null or new.cancelled_at is not null then return new; end if;
  if tg_op='UPDATE' and old.completed_at is not null then return new; end if;
  perform id from app.users where id=new.user_id for update;
  -- A failed upload can still own bytes after a partial object-store write.
  update app.uploads set avatar_erasure_token=gen_random_uuid()
    where user_id=new.user_id and purpose='avatar';
  return new;
end $$;
create trigger queue_erased_account_avatars after insert or update of completed_at on app.account_deletion_requests
  for each row execute function app.queue_erased_account_avatars();

reset role;
