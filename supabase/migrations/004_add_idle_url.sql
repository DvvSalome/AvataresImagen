-- URL pública de la animación idle generada con Meshy Animation API (action_id = 244).
ALTER TABLE avatar_jobs
  ADD COLUMN IF NOT EXISTS idle_url TEXT;

