import { GoogleGenerativeAI } from '@google/generative-ai';
import { serviceUnavailable } from '../../errors.js';

export interface PersonaProfile {
  name: string;
  bio: string | null;
  attributes: Record<string, unknown>;
}

export interface ContentIdea {
  title: string;
  caption: string;
  suggestedHashtags: string[];
}

/**
 * Gemini-powered content idea generator for AI influencer personas.
 * Uses responseMimeType: 'application/json' + responseSchema for guaranteed structured output.
 * Throws on missing API key — caller should handle with 503.
 */
export async function generateContentIdeas(
  persona: PersonaProfile,
  topic: string,
  count: number = 5,
): Promise<ContentIdea[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw serviceUnavailable('Gemini API key not configured — set GEMINI_API_KEY in environment');
  }
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: process.env.GEMINI_MODEL ?? 'gemini-2.0-flash',
    generationConfig: {
      responseMimeType: 'application/json',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      responseSchema: {
        type: 'array' as any,
        items: {
          type: 'object' as any,
          properties: {
            title: { type: 'string' as any },
            caption: { type: 'string' as any },
            suggestedHashtags: {
              type: 'array' as any,
              items: { type: 'string' as any },
            },
          },
          required: ['title', 'caption', 'suggestedHashtags'],
        },
      },
    },
  });

  const voice = typeof persona.attributes?.voice === 'string' ? persona.attributes.voice : '';
  const pillars = Array.isArray(persona.attributes?.content_pillars) 
    ? (persona.attributes.content_pillars as string[]).join(', ') 
    : '';
  const audience = typeof persona.attributes?.target_audience === 'string' ? persona.attributes.target_audience : '';

  const systemPrompt = `You are a social media content strategist for an AI influencer persona.
Persona: "${persona.name}"
Bio: "${persona.bio ?? ''}"
Voice/Tone: "${voice}"
Content Pillars: "${pillars}"
Target Audience: "${audience}"

Generate ${count} social media post ideas about "${topic}" matching this persona's style.
Return a JSON array of objects with: title, caption (a complete engaging post caption), suggestedHashtags (array of strings).`;

  const result = await model.generateContent(systemPrompt);
  const text = result.response.text();
  return JSON.parse(text) as ContentIdea[];
}
