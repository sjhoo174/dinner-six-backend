-- Tracks Twilio Verify state per (email, phone) pair. A phone must be
-- verified via SMS before it can be used on a registration. last_sent_at
-- powers a simple app-level cooldown between send-code attempts (on top of
-- whatever rate limiting Twilio Verify itself applies), independent of
-- whether the code was ever actually confirmed.
CREATE TABLE IF NOT EXISTS phone_verifications (
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  verified INTEGER NOT NULL DEFAULT 0,
  last_sent_at TEXT,
  verified_at TEXT,
  PRIMARY KEY (email, phone),
  FOREIGN KEY (email) REFERENCES users(email) ON DELETE CASCADE
);
