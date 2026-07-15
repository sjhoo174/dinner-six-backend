-- Consolidates the old dual feedback system — a separate "rate your table"
-- (1-5 stars + comment, any completed group, gated by a post-event time
-- window) and "up/down vote tablemates" (credit-gated binary vote, latest
-- completed group only) — into one: a single 1-5 star rating per tablemate,
-- open on the diner's latest successfully matched group. Reporting is
-- unaffected and keeps using its own `reports` table.
DROP TABLE IF EXISTS ratings;
DROP TABLE IF EXISTS votes;

CREATE TABLE ratings (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  rater_email TEXT NOT NULL,
  ratee_email TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  created_at TEXT NOT NULL,
  FOREIGN KEY (group_id) REFERENCES match_groups(id) ON DELETE CASCADE,
  FOREIGN KEY (rater_email) REFERENCES users(email) ON DELETE CASCADE,
  FOREIGN KEY (ratee_email) REFERENCES users(email) ON DELETE CASCADE,
  UNIQUE (group_id, rater_email, ratee_email),
  CHECK (rater_email <> ratee_email)
);

CREATE INDEX IF NOT EXISTS idx_ratings_ratee_email ON ratings(ratee_email);

-- Diners get a persistent, short public identifier assigned once at their
-- first registration, so tablemates can identify/refer to each other (in
-- the guest list and on the rating panel) without exposing email or phone.
ALTER TABLE users ADD COLUMN diner_code TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_diner_code ON users(diner_code);

-- Phone must be globally unique across accounts, mirroring the
-- already-guaranteed one-account-per-email rule (email is the Google OAuth
-- identity and users.email's primary key), so a banned/reported diner can't
-- trivially re-register under a second Google account with the same number.
ALTER TABLE users ADD COLUMN phone TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
