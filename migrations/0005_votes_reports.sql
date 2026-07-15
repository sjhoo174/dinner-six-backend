-- Apply after dinner-six-matcher-worker's 0003_reputation_economy.sql has
-- been applied to the same shared D1 database (that migration adds the
-- users.* reputation columns these tables' bookkeeping depends on).

-- One vote per (group, voter, votee): a diner may cast at most one up/down
-- vote per tablemate, and only within their latest successfully matched
-- group (enforced in application code, not schema, since "latest" is
-- relative to current state).
CREATE TABLE IF NOT EXISTS votes (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  voter_email TEXT NOT NULL,
  votee_email TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('up', 'down')),
  created_at TEXT NOT NULL,
  FOREIGN KEY (group_id) REFERENCES match_groups(id) ON DELETE CASCADE,
  FOREIGN KEY (voter_email) REFERENCES users(email) ON DELETE CASCADE,
  FOREIGN KEY (votee_email) REFERENCES users(email) ON DELETE CASCADE,
  UNIQUE (group_id, voter_email, votee_email),
  CHECK (voter_email <> votee_email)
);

CREATE INDEX IF NOT EXISTS idx_votes_votee_email ON votes(votee_email);

-- One report per (group, reporter): each successfully matched group grants
-- its members exactly one report chance, usable against any single
-- tablemate in that group. `reported_match_count_at_report` snapshots the
-- reported diner's successful_matches_count at filing time, so the report's
-- "still active" window (last 3 successful matches) can be computed later
-- purely by comparing against their current count — no separate expiry job.
CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  reporter_email TEXT NOT NULL,
  reported_email TEXT NOT NULL,
  reason TEXT,
  reported_match_count_at_report INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (group_id) REFERENCES match_groups(id) ON DELETE CASCADE,
  FOREIGN KEY (reporter_email) REFERENCES users(email) ON DELETE CASCADE,
  FOREIGN KEY (reported_email) REFERENCES users(email) ON DELETE CASCADE,
  UNIQUE (group_id, reporter_email),
  CHECK (reporter_email <> reported_email)
);

CREATE INDEX IF NOT EXISTS idx_reports_reported_email ON reports(reported_email);
