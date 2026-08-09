-- KEEP UP audit log actor snapshot migration (Supabase/PostgreSQL)
-- Adds historical actor snapshot columns for readability when users are deleted.
-- ON DELETE SET NULL is already configured on audit_logs.user_id in schema.sql.

ALTER TABLE audit_logs
  ADD COLUMN IF NOT EXISTS actor_name_snapshot VARCHAR(255),
  ADD COLUMN IF NOT EXISTS actor_role_snapshot VARCHAR(50);

-- Backfill snapshots from existing users where possible
UPDATE audit_logs al
SET
  actor_name_snapshot = COALESCE(al.actor_name_snapshot, u.full_name),
  actor_role_snapshot = COALESCE(al.actor_role_snapshot, u.role)
FROM users u
WHERE al.user_id = u.id
  AND (al.actor_name_snapshot IS NULL OR al.actor_role_snapshot IS NULL);

-- Rollback SQL (run manually if needed):
-- ALTER TABLE audit_logs DROP COLUMN IF EXISTS actor_name_snapshot;
-- ALTER TABLE audit_logs DROP COLUMN IF EXISTS actor_role_snapshot;
