-- Promotes dinnerType from a profile_json field to a first-class column so a
-- user can have one active registration per dinner type concurrently
-- (mutually exclusive within a type, independent across types).
ALTER TABLE registrations ADD COLUMN dinner_type TEXT NOT NULL DEFAULT 'social';

CREATE INDEX IF NOT EXISTS idx_registrations_email_dinner_type ON registrations(email, dinner_type);
