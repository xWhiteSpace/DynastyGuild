-- Multi-tenant SaaS schema for xWhiteSpace (Supabase PostgreSQL).
-- One Discord server = one tenant. Every operational row is stamped with tenant_id.

CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL DEFAULT '',
  owner_discord_id TEXT,
  plan TEXT NOT NULL DEFAULT 'free',
  is_platform_owner BOOLEAN NOT NULL DEFAULT FALSE,
  onboarded BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tenant_settings (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  configuration JSONB NOT NULL DEFAULT '{}'::jsonb,
  discord_channels JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS members (
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  discord_id TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (tenant_id, discord_id)
);
CREATE INDEX IF NOT EXISTS members_tenant_idx ON members (tenant_id);

CREATE TABLE IF NOT EXISTS auction_requests (
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS auction_requests_tenant_idx ON auction_requests (tenant_id);

CREATE TABLE IF NOT EXISTS past_auction_awards (
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS loot_history (
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS attendance_commitments (
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_key TEXT NOT NULL,
  member_id TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (tenant_id, event_key, member_id)
);
CREATE INDEX IF NOT EXISTS attendance_commitments_tenant_idx ON attendance_commitments (tenant_id);

CREATE TABLE IF NOT EXISTS schedule_instances (
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS special_events (
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (tenant_id, id)
);

-- Nested party grids, live raid, auction session, announce markers, etc.
CREATE TABLE IF NOT EXISTS json_docs (
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (tenant_id, path)
);

-- Bot-wide state (Discord IP circuit). Not per-guild.
CREATE TABLE IF NOT EXISTS platform_state (
  key TEXT PRIMARY KEY,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
