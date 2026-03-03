import { supabase } from './supabaseClient';
import type { Job3DStatus } from '../types';

export interface Check3DResponse {
  status: Job3DStatus;
  progress: number | null;
  model_url: string | null;
  error_message: string | null;
  /** Escala para mostrar avatar a 1.7m: 1.0 = modelo ya a 1.7m, 0.85 = modelo ~2u (aplicar en cliente). */
  escala: number | null;
  /** URL pública de la animación idle (Meshy Animation API, action_id = 244). */
  idle_url: string | null;
  walking_url?: string | null;
  running_url?: string | null;
}

export async function check3DStatus(jobId: string): Promise<Check3DResponse> {
  const { data, error } = await supabase.functions.invoke('check-3d-status', {
    body: { jobId },
  });

  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);

  return data as Check3DResponse;
}
