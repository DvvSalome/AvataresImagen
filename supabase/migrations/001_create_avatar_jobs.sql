CREATE TABLE IF NOT EXISTS avatar_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_name TEXT NOT NULL,
  folder_name TEXT NOT NULL,
  front_url TEXT,
  -- Meshy pipeline tracking
  meshy_task_id TEXT,
  meshy_remesh_task_id TEXT,
  meshy_texture_task_id TEXT,
  status TEXT NOT NULL DEFAULT 'creating_3d',
  -- Final model URL in Storage
  model_url TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_avatar_jobs_folder ON avatar_jobs (folder_name);
CREATE INDEX idx_avatar_jobs_status ON avatar_jobs (status);

ALTER TABLE avatar_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read" ON avatar_jobs
  FOR SELECT USING (true);

CREATE POLICY "Allow service role all" ON avatar_jobs
  FOR ALL USING (auth.role() = 'service_role');
