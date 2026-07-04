export interface TTSProvider {
  id: string;
  name: string;
  isConfigured(): Promise<boolean>;
  generateNarration(text: string, title: string): Promise<{ audioUrl: string; durationSec: number }>;
}
