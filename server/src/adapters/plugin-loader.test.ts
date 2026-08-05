import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadExternalAdapterPackage } from "./plugin-loader.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe("external adapter plugin loader", () => {
  it("loads a local ESM adapter from an absolute platform path", async () => {
    const packageDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-external-adapter-"));
    temporaryDirectories.push(packageDirectory);

    await fs.writeFile(
      path.join(packageDirectory, "package.json"),
      JSON.stringify({
        name: "paperclip-test-external-adapter",
        version: "1.0.0",
        type: "module",
        exports: { ".": "./index.js" },
      }),
    );
    await fs.writeFile(
      path.join(packageDirectory, "index.js"),
      'export function createServerAdapter() { return { type: "test_external_adapter" }; }\n',
    );

    const adapter = await loadExternalAdapterPackage("paperclip-test-external-adapter", packageDirectory);

    expect(adapter.type).toBe("test_external_adapter");
  });
});
