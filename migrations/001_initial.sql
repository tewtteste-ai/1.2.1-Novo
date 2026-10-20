CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  username TEXT NOT NULL,
  username_normalized TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS users_single_admin_idx
  ON users (role) WHERE role = 'admin';

CREATE TABLE IF NOT EXISTS rooms (
  id BIGSERIAL PRIMARY KEY,
  room_type TEXT NOT NULL CHECK (room_type IN ('public', 'private')),
  slot_number SMALLINT,
  schedule_date DATE,
  genre TEXT NOT NULL,
  movie_id INTEGER NOT NULL CHECK (movie_id > 0),
  movie_title TEXT NOT NULL,
  poster_path TEXT,
  creator_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  password_hash TEXT,
  capacity SMALLINT NOT NULL DEFAULT 42 CHECK (capacity = 42),
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'waiting', 'playing', 'ended', 'cancelled', 'failed')),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (room_type = 'public' AND slot_number IS NOT NULL AND schedule_date IS NOT NULL
      AND creator_id IS NULL AND password_hash IS NULL)
    OR
    (room_type = 'private' AND slot_number IS NULL AND schedule_date IS NULL
      AND password_hash IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS rooms_public_schedule_slot_idx
  ON rooms (schedule_date, slot_number) WHERE room_type = 'public';
CREATE INDEX IF NOT EXISTS rooms_status_start_idx ON rooms (status, starts_at);
CREATE INDEX IF NOT EXISTS rooms_creator_active_idx ON rooms (creator_id)
  WHERE room_type = 'private' AND status IN ('scheduled', 'waiting', 'playing');

CREATE TABLE IF NOT EXISTS room_participants (
  room_id BIGINT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (room_id, user_id)
);
CREATE INDEX IF NOT EXISTS room_participants_user_idx ON room_participants (user_id);

CREATE TABLE IF NOT EXISTS room_messages (
  id BIGSERIAL PRIMARY KEY,
  room_id BIGINT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  username TEXT NOT NULL,
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS room_messages_history_idx ON room_messages (room_id, id DESC);

CREATE TABLE IF NOT EXISTS audit_events (
  id BIGSERIAL PRIMARY KEY,
  actor_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS audit_events_created_idx ON audit_events (created_at DESC);

CREATE TABLE IF NOT EXISTS schema_migrations (
  filename TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
