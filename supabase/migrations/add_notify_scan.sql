-- Add phone number and scan notification flag to users table
-- Run this in Supabase SQL Editor

ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS notify_scan BOOLEAN DEFAULT false;

COMMENT ON COLUMN users.phone IS 'WhatsApp number with country code, e.g. 919876543210';
COMMENT ON COLUMN users.notify_scan IS 'When true, this user receives WhatsApp PDF when a supervisor scans a production report';
