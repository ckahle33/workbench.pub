-- /api/profiles/:did only serves DIDs that authored visible indexed content; these let the
-- update and reply existence checks seek instead of scanning.
CREATE INDEX idx_updates_did_visible ON updates (did) WHERE hidden = 0;
CREATE INDEX idx_replies_did_visible ON replies (did) WHERE hidden = 0;
