ALTER TABLE jobbot.application_events
  ALTER COLUMN event_at DROP NOT NULL;

COMMENT ON COLUMN jobbot.application_events.event_at IS
  'Historical event time when known; NULL if unknown (do not substitute migration/insert time)';;
