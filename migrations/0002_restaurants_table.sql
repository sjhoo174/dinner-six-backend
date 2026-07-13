CREATE TABLE IF NOT EXISTS restaurants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  area TEXT NOT NULL,
  cuisine TEXT NOT NULL,
  perk TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_restaurants_area ON restaurants(area);

INSERT INTO restaurants (id, name, area, cuisine, perk, active, created_at, updated_at) VALUES
  ('r1', 'Neighbourhood Table', 'Central', 'Modern Asian sharing plates', 'Complimentary welcome drink for each guest', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('r2', 'The Long Bar Table', 'East', 'Mediterranean tapas', 'Shared appetiser platter on the house', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('r3', 'Supper Club Social', 'CBD', 'Casual bistro and cocktails', 'Extended happy-hour pricing for the group', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('r4', 'Westside Noodle Room', 'West', 'Modern noodles and small plates', 'Dessert platter for the table', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('r5', 'North Garden Social', 'North', 'Casual garden bistro', 'Free zero-proof welcome spritz', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('r6', 'NEX Table Club', 'North-East', 'Asian-European comfort plates', 'Chef snack to share', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
