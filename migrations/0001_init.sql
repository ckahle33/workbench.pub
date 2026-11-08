CREATE TABLE topics (
  uri TEXT PRIMARY KEY,
  did TEXT NOT NULL,
  rkey TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  indexed_at INTEGER NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE projects (
  uri TEXT PRIMARY KEY,
  did TEXT NOT NULL,
  rkey TEXT NOT NULL,
  topic_slug TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  status TEXT NOT NULL,
  cover TEXT,
  created_at TEXT NOT NULL,
  indexed_at INTEGER NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_projects_topic ON projects (topic_slug, created_at);
CREATE INDEX idx_projects_did ON projects (did, created_at);

CREATE TABLE updates (
  uri TEXT PRIMARY KEY,
  did TEXT NOT NULL,
  rkey TEXT NOT NULL,
  project_uri TEXT NOT NULL,
  heading TEXT NOT NULL,
  body TEXT NOT NULL,
  images TEXT,
  links TEXT,
  parts TEXT,
  created_at TEXT NOT NULL,
  indexed_at INTEGER NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_updates_project ON updates (project_uri, created_at);

CREATE TABLE replies (
  uri TEXT PRIMARY KEY,
  did TEXT NOT NULL,
  rkey TEXT NOT NULL,
  subject_uri TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  indexed_at INTEGER NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_replies_subject ON replies (subject_uri, created_at);

CREATE TABLE follows (
  uri TEXT PRIMARY KEY,
  did TEXT NOT NULL,
  rkey TEXT NOT NULL,
  subject_uri TEXT NOT NULL,
  created_at TEXT NOT NULL,
  indexed_at INTEGER NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_follows_subject ON follows (subject_uri, created_at);
CREATE INDEX idx_follows_did ON follows (did, created_at);

CREATE TABLE profiles (
  did TEXT PRIMARY KEY,
  handle TEXT,
  display_name TEXT,
  avatar TEXT,
  fetched_at INTEGER NOT NULL
);

CREATE TABLE cursor (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  time_us INTEGER NOT NULL
);

CREATE TABLE blocked_dids (
  did TEXT PRIMARY KEY,
  blocked_at INTEGER NOT NULL
);

CREATE TABLE reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_uri TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  reporter_did TEXT,
  ip_hash TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_reports_ip ON reports (ip_hash, created_at);

CREATE TABLE link_cache (
  url TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE ingest_counts (
  did TEXT NOT NULL,
  hour INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (did, hour)
);
