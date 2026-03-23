export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  action_id TEXT,
  watch_id TEXT,
  source TEXT NOT NULL,
  event_type TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  summary TEXT NOT NULL,
  detail TEXT NOT NULL,
  severity TEXT NOT NULL,
  resolved INTEGER DEFAULT 0,
  notified INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_events_action_id ON events (action_id);
CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_events_watch_id ON events (watch_id);

CREATE TABLE IF NOT EXISTS watches (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  config TEXT NOT NULL,
  action_id TEXT,
  created_at TEXT NOT NULL,
  active INTEGER DEFAULT 1,
  last_poll_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_watches_active ON watches (active);
CREATE INDEX IF NOT EXISTS idx_watches_action_id ON watches (action_id);
`;
