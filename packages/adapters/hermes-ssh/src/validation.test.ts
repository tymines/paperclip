import { describe, expect, it } from "vitest";
import { PROFILE_ALLOWLIST } from "./constants.js";
import { validateConfig, validateRemoteCwd } from "./validation.js";

const root = "/Users/augi/shared-agent-workspace";

describe("hermes_ssh allowlist validation", () => {
  it("enforces the exact profile/role/model/wrapper map", () => {
    expect(PROFILE_ALLOWLIST).toEqual({
      atlas: { role: "builder", model: "SOL", wrapper: "/Users/augi/.local/bin/atlas" },
      artemis: { role: "builder", model: "Kimi K3", wrapper: "/Users/augi/.local/bin/artemis" },
      chronos: { role: "reviewer", model: "SOL", wrapper: "/Users/augi/.local/bin/chronos" },
      achlys: { role: "reviewer", model: "Kimi K3", wrapper: "/Users/augi/.local/bin/achlys" },
    });
    expect(validateConfig({ profile: "atlas", role: "builder", model: "SOL", sshAlias: "augi-mac-1", remoteCwd: root })).toMatchObject({ profile: "atlas", role: "builder", model: "SOL" });
    expect(() => validateConfig({ profile: "atlas", role: "reviewer", model: "SOL", remoteCwd: root })).toThrow(/requires role builder/);
    expect(() => validateConfig({ profile: "artemis", role: "builder", model: "SOL", remoteCwd: root })).toThrow(/Kimi K3/);
    expect(() => validateConfig({ profile: "hermes", remoteCwd: root })).toThrow(/not allowlisted/);
  });

  it.each(["host", "command", "args", "cwd", "env", "shell", "path", "flags", "sessionId"])("rejects forbidden %s configuration", (key) => {
    expect(() => validateConfig({ profile: "atlas", remoteCwd: root, [key]: "unsafe" })).toThrow(/unsupported config fields/);
  });

  it("permits only the fixed alias and bounded settings", () => {
    expect(() => validateConfig({ profile: "atlas", remoteCwd: root, sshAlias: "other" })).toThrow(/only permits/);
    expect(() => validateConfig({ profile: "atlas", remoteCwd: root, timeoutSec: 4 })).toThrow(/between 5 and 1800/);
    expect(() => validateConfig({ profile: "atlas", remoteCwd: root, maxTurns: 26 })).toThrow(/between 1 and 25/);
  });

  it("accepts only normalized paths under the approved root", () => {
    expect(validateRemoteCwd(root)).toBe(root);
    expect(validateRemoteCwd(`${root}/project-a`)).toBe(`${root}/project-a`);
    for (const cwd of ["/Users/augi", `${root}/../escape`, `${root}//project`, `${root}/project/./src`, "relative", `${root}\\escape`]) {
      expect(() => validateRemoteCwd(cwd)).toThrow();
    }
  });
});
