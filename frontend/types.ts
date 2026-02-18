
export interface Avatar {
  id: string;
  imageUrl: string;
  hairColor: string;
  createdAt: number;
}

export interface HairOption {
  name: string;
  color: string;
  /** ID para la Edge Function generate-avatar (ej: short_black, curly_brown) */
  hairId: string;
}

export enum GenerationStatus {
  IDLE = 'IDLE',
  LOADING = 'LOADING',
  SUCCESS = 'SUCCESS',
  ERROR = 'ERROR'
}
