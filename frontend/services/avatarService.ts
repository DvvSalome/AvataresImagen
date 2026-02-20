import { supabase } from './supabaseClient';
import type { BaseOption } from '../types';

interface GenerateAvatarResponse {
  success: boolean;
  avatarUrl?: string;
  jobId?: string | null;
  meshyDebug?: string | null;
  imageBase64?: string;
  image?: string;
  mimeType?: string;
  mock?: boolean;
  error?: string;
}

export interface GenerateResult {
  imageUrl: string;
  jobId: string | null;
  meshyDebug: string | null;
}

export async function generateChibiAvatarViaEdgeFunction(
  hairDescription: string,
  base: BaseOption = 'female',
  userName: string,
  outfitDescription: string
): Promise<GenerateResult> {
  const { data, error: fnError } = await supabase.functions.invoke('generate-avatar', {
    body: { config: { base, hairDescription, userName: userName.trim(), outfitDescription } },
  });

  const response = data as GenerateAvatarResponse | null;
  const serverMessage = response?.error;
  if (fnError) {
    throw new Error(serverMessage || fnError.message);
  }
  if (response?.error) throw new Error(response.error);

  let imageUrl: string | undefined;

  if (response?.avatarUrl) {
    imageUrl = response.avatarUrl;
  } else {
    const base64 = response?.imageBase64 ?? response?.image;
    if (base64) {
      const mime = response?.mimeType || 'image/png';
      imageUrl = `data:${mime};base64,${base64}`;
    }
  }

  if (!imageUrl) {
    throw new Error('La función no devolvió imagen (ni URL ni base64).');
  }

  return {
    imageUrl,
    jobId: response?.jobId ?? null,
    meshyDebug: response?.meshyDebug ?? null,
  };
}
