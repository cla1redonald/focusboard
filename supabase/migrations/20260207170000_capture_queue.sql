-- Capture Hub: queue table for universal task ingestion
CREATE TABLE IF NOT EXISTS capture_queue (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'processing', 'ready', 'auto_added', 'dismissed')),
  confidence    FLOAT,
  source        TEXT NOT NULL
                CHECK (source IN ('email', 'slack', 'shortcut', 'browser', 'whatsapp', 'in_app')),
  raw_content   TEXT NOT NULL,
  raw_metadata  JSONB DEFAULT '{}',
  parsed_cards  JSONB,
  created_at    TIMESTAMPTZ DEFAULT now(),
  processed_at  TIMESTAMPTZ
);

-- RLS: users can only access their own captures
ALTER TABLE capture_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own captures" ON capture_queue
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own captures" ON capture_queue
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own captures" ON capture_queue
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own captures" ON capture_queue
  FOR DELETE USING (auth.uid() = user_id);

-- Note: Service role key bypasses RLS automatically — no permissive policy needed.

-- Index for faster queries
CREATE INDEX idx_capture_queue_user_status ON capture_queue(user_id, status, created_at DESC);

-- Enable real-time subscriptions
ALTER PUBLICATION supabase_realtime ADD TABLE capture_queue;
