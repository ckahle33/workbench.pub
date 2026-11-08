-- The ingest run prunes old hourly counters every minute; index the hour so that is a seek.
CREATE INDEX idx_ingest_counts_hour ON ingest_counts (hour);
