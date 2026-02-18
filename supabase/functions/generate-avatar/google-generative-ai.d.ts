declare module "https://esm.sh/@google/generative-ai@0.21.0" {
  interface GenerationConfig {
    temperature?: number;
    topP?: number;
    topK?: number;
    responseModalities?: string[];
    maxOutputTokens?: number;
  }

  interface InlineData {
    mimeType?: string;
    data: string;
  }

  interface Part {
    text?: string;
    inlineData?: InlineData;
  }

  interface Candidate {
    content: {
      parts: Part[];
    };
  }

  interface GenerateContentResponse {
    response: {
      candidates?: Candidate[];
    };
  }

  interface GenerativeModel {
    generateContent(input: unknown): Promise<GenerateContentResponse>;
  }

  interface ModelConfig {
    model: string;
    generationConfig?: GenerationConfig;
  }

  export class GoogleGenerativeAI {
    constructor(apiKey: string);
    getGenerativeModel(config: ModelConfig): GenerativeModel;
  }
}
