-- Consecutive ingest runs that stopped on a D1 error since the last run that advanced the cursor.
ALTER TABLE cursor ADD COLUMN error_streak INTEGER NOT NULL DEFAULT 0;
