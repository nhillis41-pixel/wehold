-- WeHold alert service storage (Cloudflare D1). Only anonymous push tokens and topic ids.
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,          -- SHA-256 of the push token
  token TEXT NOT NULL,          -- push token from Apple or Google (needed to deliver)
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
  updated TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS subs (
  device TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  topic TEXT NOT NULL,
  PRIMARY KEY (device, topic)
);
CREATE INDEX IF NOT EXISTS subs_topic ON subs(topic);
CREATE TABLE IF NOT EXISTS state (k TEXT PRIMARY KEY, v TEXT NOT NULL);
