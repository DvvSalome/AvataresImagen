
import { GoogleGenAI } from "@google/genai";

const API_KEY = process.env.API_KEY || '';

export const generateChibiAvatar = async (hairColor: string): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey: API_KEY });
  
  // Refined prompt for consistent Chibi style
  const prompt = `A professional chibi-style coworker character avatar. 
    The character has ${hairColor} hair. 
    Style features: Large expressive eyes, small cute body, oversized head. 
    Vibrant flat colors, clean vector lines, soft shading. 
    White background, centered composition, high quality digital art. 
    The character is wearing a simple casual office outfit.`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: {
        parts: [{ text: prompt }],
      },
      config: {
        imageConfig: {
          aspectRatio: "1:1"
        }
      }
    });

    // Handle potential candidate response
    const candidate = response.candidates?.[0];
    if (!candidate) throw new Error("No candidates returned from AI");

    const imagePart = candidate.content.parts.find(part => part.inlineData);
    
    if (imagePart && imagePart.inlineData) {
      return `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}`;
    }

    throw new Error("Could not find image in AI response");
  } catch (error) {
    console.error("Error generating avatar:", error);
    throw error;
  }
};
