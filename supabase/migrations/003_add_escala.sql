-- Escala del modelo 3D: 1.0 = modelo ya a 1.7m (Meshy resize/height_meters);
-- 0.85 = modelo ~2 unidades de alto, aplicar escala 1.7/2 en cliente para 1.7m.
ALTER TABLE avatar_jobs
  ADD COLUMN IF NOT EXISTS escala NUMERIC NOT NULL DEFAULT 1.0;

COMMENT ON COLUMN avatar_jobs.escala IS 'Escala para mostrar avatar a 1.7m: 1.0 si Meshy exportó a 1.7m, 0.85 si modelo viene ~2 unidades (sin resize).';
