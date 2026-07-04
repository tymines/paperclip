import { getRawKey } from "../provider-api-keys/index.js";
import type { TTSProvider } from "./types.js";

const stubProvider: TTSProvider = {
  id: "stub",
  name: "Not Configured",
  async isConfigured() {
    const key = await getRawKey("elevenlabs");
    const envProvider = process.env.TTS_PROVIDER;
    return !!(key && envProvider);
  },
  async generateNarration(text: string, title: string) {
    return { audioUrl: "", durationSec: 0 };
  },
};

export function getTTSProvider(): TTSProvider {
  return stubProvider;
}
