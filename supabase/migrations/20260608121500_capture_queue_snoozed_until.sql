-- Capture Hub: persist snooze state server-side so triage state follows the user.
ALTER TABLE capture_queue
  ADD COLUMN IF NOT EXISTS snoozed_until TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_capture_queue_user_snoozed_until
  ON capture_queue(user_id, snoozed_until);
