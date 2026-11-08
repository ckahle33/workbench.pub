-- Read API sorts by the server-assigned indexed_at and always filters hidden = 0.
-- Partial indexes keep hidden rows out of the scan entirely.
CREATE INDEX idx_updates_feed ON updates (indexed_at DESC, uri DESC) WHERE hidden = 0;
CREATE INDEX idx_updates_project_visible ON updates (project_uri, indexed_at DESC) WHERE hidden = 0;
CREATE INDEX idx_projects_topic_visible ON projects (topic_slug, indexed_at DESC) WHERE hidden = 0;
CREATE INDEX idx_projects_did_visible ON projects (did, indexed_at DESC) WHERE hidden = 0;
CREATE INDEX idx_replies_subject_visible ON replies (subject_uri, created_at) WHERE hidden = 0;
