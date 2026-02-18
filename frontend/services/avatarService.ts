import { supabase } from './supabaseClient';

type BaseOption = 'female' | 'male';

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
 * La función puede devolver avatarUrl (imagen en Storage) o imageBase64 (Gemini 2.5 Flash).
 */
export async function generateChibiAvatarViaEdgeFunction(
  hairId: string,
  base: BaseOption = 'female'
): Promise<string> {
  const { data, error: fnError } = await supabase.functions.invoke('generate-avatar', {
    body: { config: { base, hairId } },
  });

  const response = data as GenerateAvatarResponse | null;
  // Si la función devolvió 500, a veces el mensaje real está en data.error
  const serverMessage = response?.error;
  if (fnError) {
    throw new Error(serverMessage || fnError.message);
  }
  if (response?.error) throw new Error(response.error);

  if (response.avatarUrl) return response.avatarUrl;
  const base64 = response.imageBase64 ?? response.image;
  if (base64) {
    const mime = response.mimeType || 'image/png';
    return `data:${mime};base64,${base64}`;
  }

  throw new Error('La función no devolvió imagen (ni URL ni base64).');
}
