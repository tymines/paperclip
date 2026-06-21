/**
 * Scene Director — LLM call to break a one-line idea into 4-8 cinematic beats.
 *
 * Uses the existing OpenClaw bridge LLM (DeepSeek V4 Flash, ~$0.001/call).
 * Output is a structured scene plan stored in reel_scenes rows.
 *
 * See spec section 8 (Scene Director prompt template) for the full prompt.
 */
import type { Db } from "@paperclipai/db";
import type { Reel } from "@paperclipai/db";
import { reels, reelScenes, personaGroups } from "@paperclipai/db";
import { eq } from "drizzle-orm";

type SceneSpec = {
  index: number;
  description: string;
  camera_framing: string;
  emotion: string;
  duration_seconds: number;
  keyframe_prompt: string;
  motion_hint: string;
};

type DirectorOutput = {
  title: string;
  scenes: SceneSpec[];
  music_mood: string;
  estimated_cost_usd: number;
};

const SCENE_DIRECTOR_PROMPT = `You are a viral short-film director. Take a one-line idea and a persona profile,
break it into 4-8 cinematic beats for a {DURATION}s vertical reel.

PERSONA:
{PERSONA_VOICE}
Visual anchor: {PERSONA_VISUAL_ANCHOR}
Camera lean: {PERSONA_CAMERA_LEAN}

IDEA: {IDEA}

STYLE PRESET: {STYLE_PRESET}

CONSTRAINTS:
- Total duration must sum to {DURATION}s ± 2s
- Each beat is 2-5 seconds
- Specify camera framing (wide / medium / close-up / POV)
- Specify character emotion per beat
- Each keyframe_prompt must be self-contained and include the persona visual anchor
  (so character stays consistent across scenes)
- motion_hint describes what changes during the clip (subject motion, camera move, lighting shift)

Output JSON ONLY (no prose, no markdown fences). Schema:
{
  "title": "<3-5 word reel title>",
  "scenes": [
    {
      "index": 1,
      "description": "<brief beat description>",
      "camera_framing": "wide|medium|close-up|POV",
      "emotion": "<word or short phrase>",
      "duration_seconds": 3.0,
      "keyframe_prompt": "<full image prompt with persona anchor>",
      "motion_hint": "<what changes during the 3s clip>"
    }
  ],
  "music_mood": "<e.g. dark synthwave, lo-fi melancholic, upbeat pop>",
  "estimated_cost_usd": 0.0
}`;

/**
 * Run the scene director for a reel and insert reel_scenes rows.
 *
 * Assumes reel.status is 'directing'. On success, scenes are written and
 * the orchestrator advances to generating_keyframes.
 */
export async function directScenes(db: Db, reel: Reel): Promise<void> {
  // Load persona profile
  const [persona] = await db
    .select()
    .from(personaGroups)
    .where(eq(personaGroups.id, reel.personaId))
    .limit(1);
  if (!persona) {
    throw new Error(`persona ${reel.personaId} not found`);
  }

  const prompt = SCENE_DIRECTOR_PROMPT.replace(/{DURATION}/g, String(reel.durationSeconds))
    .replace(/{IDEA}/g, reel.prompt)
    .replace(/{STYLE_PRESET}/g, reel.stylePreset ?? "cinematic")
    .replace(/{PERSONA_VOICE}/g, (persona as any).brandVoice ?? "")
    .replace(/{PERSONA_VISUAL_ANCHOR}/g, (persona as any).visualAnchor ?? "")
    .replace(/{PERSONA_CAMERA_LEAN}/g, (persona as any).cameraLean ?? "moody, intimate framing");

  // Call the LLM via the existing OpenClaw bridge.
  // TODO: wire to the actual LLM call. For now, throw to surface the integration point.
  const llmOutput = await callLLM(prompt);
  const parsed: DirectorOutput = JSON.parse(llmOutput);

  // Validate structure
  if (!Array.isArray(parsed.scenes) || parsed.scenes.length < 2) {
    throw new Error(`scene director returned ${parsed.scenes?.length ?? 0} scenes (need 2+)`);
  }

  // Update reel with director outputs
  await db
    .update(reels)
    .set({
      directorTitle: parsed.title,
      musicMood: parsed.music_mood,
    })
    .where(eq(reels.id, reel.id));

  // Insert scene rows
  for (const scene of parsed.scenes) {
    await db.insert(reelScenes).values({
      reelId: reel.id,
      sceneIndex: scene.index,
      description: scene.description,
      cameraFraming: scene.camera_framing,
      emotion: scene.emotion,
      sceneDurationSeconds: scene.duration_seconds.toString(),
      keyframePrompt: scene.keyframe_prompt,
      motionHint: scene.motion_hint,
      status: "pending",
    });
  }
}

/**
 * Placeholder for the LLM call.
 *
 * Real implementation should hit the OpenClaw bridge gateway at
 * http://127.0.0.1:18789 with the configured main agent's model
 * (DeepSeek V4 Flash per agents.defaults).
 *
 * Alternative: call DeepSeek API directly via the same key already in
 * models.providers.custom-api-deepseek-com.apiKey from openclaw config.
 */
async function callLLM(_prompt: string): Promise<string> {
  throw new Error("scene-director.callLLM not yet wired — implement OpenClaw bridge call");
}
