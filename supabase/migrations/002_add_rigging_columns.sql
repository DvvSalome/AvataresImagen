ALTER TABLE avatar_jobs
  ADD COLUMN IF NOT EXISTS meshy_rig_task_id TEXT,
  ADD COLUMN IF NOT EXISTS walking_url TEXT,
  ADD COLUMN IF NOT EXISTS running_url TEXT;
