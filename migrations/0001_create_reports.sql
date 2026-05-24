CREATE TABLE reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  status TEXT NOT NULL CHECK (status IN ('working', 'broken')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ip_hash TEXT,
  user_agent TEXT
);

CREATE INDEX reports_created_at_idx ON reports(created_at);
CREATE INDEX reports_status_idx ON reports(status);
