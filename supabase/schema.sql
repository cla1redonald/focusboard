-- FocusBoard Supabase Schema
-- Run this in your Supabase SQL Editor

CREATE TABLE IF NOT EXISTS app_state (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  state JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS metrics (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  metrics JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE app_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE metrics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own state" ON app_state;
DROP POLICY IF EXISTS "Users can insert own state" ON app_state;
DROP POLICY IF EXISTS "Users can update own state" ON app_state;
DROP POLICY IF EXISTS "Users can view own app_state" ON app_state;
DROP POLICY IF EXISTS "Users can insert own app_state" ON app_state;
DROP POLICY IF EXISTS "Users can update own app_state" ON app_state;
DROP POLICY IF EXISTS "Users can delete own app_state" ON app_state;
DROP POLICY IF EXISTS "Users can view own metrics" ON metrics;
DROP POLICY IF EXISTS "Users can insert own metrics" ON metrics;
DROP POLICY IF EXISTS "Users can update own metrics" ON metrics;
DROP POLICY IF EXISTS "Users can delete own metrics" ON metrics;

CREATE POLICY "Users can view own app_state" ON app_state FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own app_state" ON app_state FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own app_state" ON app_state FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own app_state" ON app_state FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Users can view own metrics" ON metrics FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own metrics" ON metrics FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own metrics" ON metrics FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own metrics" ON metrics FOR DELETE USING (auth.uid() = user_id);
