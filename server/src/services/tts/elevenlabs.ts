/**
 * ElevenLabs TTS provider — real API-backed narration generation.
 *
 * Calls the ElevenLabs text-to-speech REST API (/v1/text-to-speech/:voice_id)
 * with the turbo v2.5 model. Splits long text at sentence boundaries to stay
 * under the 5000-char-per-request limit, retries on 429 with exponential
 * backoff, and returns per-chapter audio buffers that the /narrate route
 * concatenates (via ffmpeg or raw Buffer.concat) into a combined mp3.
 */
import { getRawKey } from "../provider-api-keys/index.js";
import type { TTSProvider } from "./types.js";

// ── Constants ─────────────────────────────────────────────────────────

const DEFAULT_VOICE_ID = "pNInz6obpgDQGcFmaJgB"; // Adam
const TURBO_MODEL = "eleven_turbo_v2_5";
const API_BASE = "https://api.elevenlabs.io/v1";
const MAX_CHARS_PER_REQUEST = 5000;
const MAX_RETRIES = 3;

// ── Helpers ───────────────────────────────────────────────────────────

function sanitizeFilename(title: string): string {
  return title.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 200);
}

/**
 * Split text into chunks at sentence boundaries, each ≤ MAX_CHARS_PER_REQUEST.
 * Falls back to character-boundary splitting if no sentence split is found
 * within the limit.
 */
function splitText(text: string): string[] {
  if (text.length <= MAX_CHARS_PER_REQUEST) return [text];

  const chunks: string[] = [];
  const sentences = text.match(/[^.!?]+[.!?]+/g) ?? [text];

  let buffer = "";
  for (const sentence of sentences) {
    if ((buffer + sentence).length > MAX_CHARS_PER_REQUEST) {
      if (buffer.length > 0) {
        chunks.push(buffer.trim());
        buffer = "";
      }
      // If a single sentence exceeds the limit, split it mid-text
      if (sentence.length > MAX_CHARS_PER_REQUEST) {
        let remaining = sentence;
        while (remaining.length > MAX_CHARS_PER_REQUEST) {
          chunks.push(remaining.slice(0, MAX_CHARS_PER_REQUEST).trim());
          remaining = remaining.slice(MAX_CHARS_PER_REQUEST);
        }
        buffer = remaining;
      } else {
        buffer = sentence;
      }
    } else {
      buffer += sentence;
    }
  }
  if (buffer.trim().length > 0) chunks.push(buffer.trim());

  return chunks;
}

/**
 * Call the ElevenLabs TTS API for a single text segment.
 * Implements retry with exponential backoff on 429 rate-limit responses.
 */
async function callElevenLabs(text: string, apiKey: string): Promise<Buffer> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        const delay = Math.pow(2, attempt - 1) * 1000; // 1s, 2s, 4s
        await new Promise((r) => setTimeout(r, delay));
      }

      const response = await fetch(
        `${API_BASE}/text-to-speech/${DEFAULT_VOICE_ID}?output_format=mp3_44100_128`,
        {
          method: "POST",
          headers: {
            "xi-api-key": apiKey,
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

      if (response.status === 429) {
        lastError = new Error(`Rate limited (429), attempt ${attempt + 1}/${MAX_RETRIES}`);
        continue;
      }

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(
          `ElevenLabs API error ${response.status}: ${body || response.statusText}`,
        );
      }

      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < MAX_RETRIES - 1) {
        // Only retry on network/429 errors; don't retry 4xx
        if (err instanceof Error && err.message.includes("429")) continue;
        if (
          err instanceof TypeError ||
          (err instanceof Error && err.message.includes("fetch"))
        ) {
          continue;
        }
      }
    }
  }

  throw lastError ?? new Error("ElevenLabs API call failed after retries");
}

// ── Provider ──────────────────────────────────────────────────────────

export const elevenlabsProvider: TTSProvider = {
  id: "elevenlabs",
  name: "ElevenLabs",

  async isConfigured() {
    const key = await getRawKey("elevenlabs");
    return key !== null;
  },

  async generateNarration(text: string, title: string) {
    const apiKey = await getRawKey("elevenlabs");
    if (!apiKey) throw new Error("ElevenLabs API key not configured");

    const segments = splitText(text);
    const buffers: Buffer[] = [];

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      if (segment.trim().length === 0) continue;
      const buf = await callElevenLabs(segment, apiKey);
      buffers.push(buf);
    }

    const audioBuffer = Buffer.concat(buffers);
    const safeName = sanitizeFilename(title);
    const audioUrl = `/api/book-studio/narration-audio/${safeName}`;

    return {
      audioBuffer,
      audioUrl,
      durationSec: 0, // Duration set by ffprobe in the route
    };
  },
};
