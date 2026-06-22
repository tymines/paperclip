import { describe, it, expect } from "vitest";
import {
  readPaperclipSkillSyncPreference,
  writePaperclipSkillSyncPreference,
} from "@paperclipai/adapter-utils/server-utils";

/**
 * Regression guard for the company-skills grant storage convention.
 *
 * setAgentGrant() must persist grants under
 * adapterConfig.paperclipSkillSync.desiredSkills — the single source of truth
 * that the catalog/usage read paths and the runtime materializer both consume.
 * A previous bug wrote a bare top-level `desiredSkills` field, which no read
 * path consulted, so grants silently vanished and every skill stayed at 0/N.
 *
 * This test exercises the exact merge logic setAgentGrant now uses.
 */
function applyGrant(
  adapterConfig: Record<string, unknown>,
  skillKey: string,
  granted: boolean,
): Record<string, unknown> {
  const preference = readPaperclipSkillSyncPreference(adapterConfig);
  const desiredKeys = new Set<string>(preference.desiredSkills);
  if (granted) desiredKeys.add(skillKey);
  else desiredKeys.delete(skillKey);
  return writePaperclipSkillSyncPreference(adapterConfig, Array.from(desiredKeys));
}

const KEY = "local/896a55bb8c/ui-ux-pro-max";

describe("agent skill grant storage", () => {
  it("writes grants under paperclipSkillSync.desiredSkills, not top-level", () => {
    const cfg = applyGrant({ agent: "codex" }, KEY, true);
    expect((cfg.paperclipSkillSync as { desiredSkills: string[] }).desiredSkills).toEqual([KEY]);
    expect(cfg.desiredSkills).toBeUndefined();
    expect(cfg.agent).toBe("codex");
  });

  it("is visible to the read path used by the catalog/usage counts", () => {
    const cfg = applyGrant({}, KEY, true);
    expect(readPaperclipSkillSyncPreference(cfg).desiredSkills).toContain(KEY);
  });

  it("merges multiple grants and supports revoke without clobbering others", () => {
    let cfg = applyGrant({}, KEY, true);
    cfg = applyGrant(cfg, "paperclipai/paperclip/paperclip", true);
    expect((cfg.paperclipSkillSync as { desiredSkills: string[] }).desiredSkills).toHaveLength(2);
    cfg = applyGrant(cfg, KEY, false);
    const ds = (cfg.paperclipSkillSync as { desiredSkills: string[] }).desiredSkills;
    expect(ds).not.toContain(KEY);
    expect(ds).toContain("paperclipai/paperclip/paperclip");
  });
});
