# Supabase Capture Snooze

## Goal

Persist Capture Inbox snooze state in Supabase so captured items stay snoozed across reloads, devices, and sessions.

## Shape

- Add nullable `capture_queue.snoozed_until TIMESTAMPTZ`.
- Keep the existing capture lifecycle unchanged: snoozing does not change `status`.
- Fetch active queue rows normally and filter visibility in the client so expired snoozes reappear without needing a database update.
- Keep the one-minute client timer that already refreshes snooze visibility.

## Validation

- Type tests cover `snoozed_until` on capture rows.
- Unit tests cover unsnoozed, active snooze, and expired snooze visibility.
- Supabase docs include the new column and lifecycle note.
