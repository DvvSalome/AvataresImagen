
export interface Avatar {
  id: string;
  imageUrl: string;
  hairColor: string;
  createdAt: number;
}

export interface HairColor {
  name: string;
  color: string;
  /** Descripción del color en inglés para el prompt */
  colorId: string;
}

export interface HairLength {
  name: string;
  lengthId: string;
}

/** @deprecated Usar HairColor + HairLength */
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
