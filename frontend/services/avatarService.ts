import { supabase } from './supabaseClient';
import type { BaseOption } from '../types';

interface GenerateAvatarResponse {
  success: boolean;
  avatarUrl?: string;
  imageBase64?: string;
  image?: string;
  mimeType?: string;
  mock?: boolean;
  error?: string;
}

/**
 * Genera un avatar llamando a la Edge Function generate-avatar.
 * userName es obligatorio; la imagen se guarda en Storage como avatar_{nombre}_{timestamp}.
 */
export async function generateChibiAvatarViaEdgeFunction(
  hairDescription: string,
  base: BaseOption = 'female',
  userName: string,
  outfitDescription: string
): Promise<string> {
  const { data, error: fnError } = await supabase.functions.invoke('generate-avatar', {
    body: { config: { base, hairDescription, userName: userName.trim(), outfitDescription } },
  });

  const response = data as GenerateAvatarResponse | null;
  // Si la función devolvió 500, a veces el mensaje real está en data.error
  const serverMessage = response?.error;
  if (fnError) {
    throw new Error(serverMessage || fnError.message);
  }
  if (response?.error) throw new Error(response.error);

  if (response?.avatarUrl) return response.avatarUrl;
  const base64 = response?.imageBase64 ?? response?.image;
  if (base64) {
    const mime = response?.mimeType || 'image/png';
    return `data:${mime};base64,${base64}`;
  }

  throw new Error('La función no devolvió imagen (ni URL ni base64).');
}
