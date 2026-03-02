export type BaseOption = 'female' | 'male';

export interface Avatar {
  id: string;
  imageUrl: string;
  hairColor: string;
  createdAt: number;
  jobId?: string;
  meshyDebug?: string;
}

export interface HairColor {
  name: string;
  color: string;
  colorId: string;
}

export interface HairLength {
  name: string;
  lengthId: string;
}

export interface OutfitOption {
  name: string;
  outfitId: string;
}

export enum GenerationStatus {
  IDLE = 'IDLE',
  LOADING = 'LOADING',
  SUCCESS = 'SUCCESS',
  ERROR = 'ERROR',
}

export type Job3DStatus =
  | 'creating_3d'
  | 'remeshing'
  | 'texturing'
  | 'rigging'
  | 'completed'
  | 'error';

export interface AvatarJob {
  id: string;
  user_name: string;
  folder_name: string;
  front_url: string | null;
  status: Job3DStatus;
  model_url: string | null;
  error_message: string | null;
  /** Escala para 1.7m: 1.0 = modelo a 1.7m, 0.85 = aplicar en cliente (modelo ~2u). */
  escala?: number | null;
  walking_url?: string | null;
  running_url?: string | null;
  idle_url?: string | null;
  created_at: string;
}
