export function beatToText(beats: Record<string, unknown>[]): string {
  return beats.map((beat, i) => {
    const parts: string[] = [];
    if (beat.description) parts.push(String(beat.description));
    if (beat.beat_type || beat.sceneType) parts.push(`(${beat.beat_type ?? beat.sceneType})`);
    if (beat.dialogue) parts.push(`"${beat.dialogue}"`);
    if (beat.conflict) parts.push(`Conflict: ${beat.conflict}`);
    return parts.length > 0 ? parts.join(' ') : `[Beat ${i + 1}]`;
  }).join('\n\n');
}
