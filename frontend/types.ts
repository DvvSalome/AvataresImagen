export type BaseOption = 'female' | 'male';

export interface Avatar {
  id: string;
  imageUrl: string;
  hairColor: string;
  createdAt: number;
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
