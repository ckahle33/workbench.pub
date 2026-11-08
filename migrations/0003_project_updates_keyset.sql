-- Project updates paginate by (indexed_at, uri); include uri so the keyset seek needs no sort.
DROP INDEX idx_updates_project_visible;
CREATE INDEX idx_updates_project_visible ON updates (project_uri, indexed_at DESC, uri DESC) WHERE hidden = 0;
