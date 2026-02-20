import { supabase } from './supabaseClient';
import type { Job3DStatus } from '../types';

export interface Check3DResponse {
  status: Job3DStatus;
  progress: number | null;
  model_url: string | null;
  error_message: string | null;
}

export async function check3DStatus(jobId: string): Promise<Check3DResponse> {
  const { data, error } = await supabase.functions.invoke('check-3d-status', {
    body: { jobId },
  });

  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);

  return data as Check3DResponse;
}
