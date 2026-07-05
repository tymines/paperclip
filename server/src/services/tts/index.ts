import { getRawKey } from "../provider-api-keys/index.js";
import type { TTSProvider } from "./types.js";
import { elevenlabsProvider } from "./elevenlabs.js";

const stubProvider: TTSProvider = {
  id: "stub",
  name: "Not Configured",
  async isConfigured() {
    const key = await getRawKey("elevenlabs");
    const envProvider = process.env.TTS_PROVIDER;
    return !!(key && envProvider);
  },
  async generateNarration(_text: string, _title: string) {
    return { audioBuffer: Buffer.alloc(0), audioUrl: "", durationSec: 0 };
  },
};

export function getTTSProvider(): TTSProvider {
  if (process.env.TTS_PROVIDER) return elevenlabsProvider;
  return stubProvider;
}
