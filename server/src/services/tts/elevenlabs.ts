import { getRawKey } from "../provider-api-keys/index.js";
import type { TTSProvider } from "./types.js";

const DEFAULT_VOICE_ID = "pNInz6obpgDQGcFmaJgB"; // Adam
const TURBO_MODEL = "eleven_turbo_v2_5";
const API_BASE = "https://api.elevenlabs.io/v1";
const MAX_CHARS_PER_REQUEST = 5_000;
const MAX_RETRIES = 3;

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 200);
}

function splitText(text: string): string[] {
  if (text.length <= MAX_CHARS_PER_REQUEST) return [text];
  const segments: string[] = [];
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  let current = "";
  for (const s of sentences) {
    if ((current + s).length > MAX_CHARS_PER_REQUEST) {
      if (current) segments.push(current.trim());
      current = s;
    } else {
      current += s;
    }
  }
  if (current.trim()) segments.push(current.trim());
  return segments;
}

async function callElevenLabs(text: string, key: string): Promise<Buffer> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const response = await fetch(
      `${API_BASE}/text-to-speech/${DEFAULT_VOICE_ID}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: {
          "xi-api-key": key,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text,
          model_id: TURBO_MODEL,
          voice_settings: {
            stability: 0.35,
            similarity_boost: 0.75,
            style: 0.0,
            use_speaker_boost: true,
          },
        }),
      },
    );
    if (response.ok) return Buffer.from(await response.arrayBuffer());
    if (response.status === 429 && attempt < MAX_RETRIES) {
      await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
      continue;
    }
    const body = await response.text().catch(() => "");
    throw new Error(`ElevenLabs TTS failed (${response.status}): ${body}`);
  }
  throw new Error("ElevenLabs TTS failed after max retries");
}

export const elevenlabsProvider: TTSProvider = {
  id: "elevenlabs",
  name: "ElevenLabs Turbo",

  async isConfigured(): Promise<boolean> {
    const key = await getRawKey("elevenlabs");
    return !!key;
  },

  async generateNarration(text: string, title: string): Promise<{
    audioBuffer: Buffer;
    audioUrl: string;
    durationSec: number;
  }> {
    const key = await getRawKey("elevenlabs");
    if (!key) throw new Error("ElevenLabs not configured");

    const segments = splitText(text);
    const buffers: Buffer[] = [];

    for (const segment of segments) {
      const buf = await callElevenLabs(segment, key);
      buffers.push(buf);
    }

    const audioBuffer = Buffer.concat(buffers);
    const safeTitle = sanitizeFilename(title || "narration");
    const audioUrl = `/api/book-studio/narration-audio/${safeTitle}.mp3`;

    return { audioBuffer, audioUrl, durationSec: 0 };
  },
};
