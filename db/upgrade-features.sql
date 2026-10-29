USE student_portal;
-- Run once against an existing database. If any column/index already exists, skip that statement.
ALTER TABLE registrations ADD COLUMN checkin_token CHAR(32) NULL;
ALTER TABLE registrations ADD COLUMN checked_in_at DATETIME NULL;
ALTER TABLE registrations ADD COLUMN reminder_sent_at DATETIME NULL;
ALTER TABLE registrations ADD UNIQUE KEY uq_checkin_token (checkin_token);
CREATE INDEX idx_reg_registered ON registrations (registered_at);
CREATE INDEX idx_reg_event_status ON registrations (event_id, status);
