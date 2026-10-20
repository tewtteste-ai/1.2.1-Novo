ALTER TABLE rooms
  ADD COLUMN IF NOT EXISTS duration_seconds INTEGER,
  ADD COLUMN IF NOT EXISTS duration_is_estimate BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE rooms
SET duration_seconds = GREATEST(
  FLOOR(EXTRACT(EPOCH FROM (ends_at - starts_at))::INTEGER - 600),
  60
),
duration_is_estimate = TRUE
WHERE duration_seconds IS NULL;

ALTER TABLE rooms
  ALTER COLUMN duration_seconds SET NOT NULL,
  ADD CONSTRAINT rooms_duration_seconds_positive CHECK (duration_seconds > 0);
