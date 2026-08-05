import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { loadExternalAdapterPackage } from "./plugin-loader.js";

const temporaryDirectories: string[] = [];
const execFileAsync = promisify(execFile);

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

  it("reloads fresh local ESM adapter code from an absolute platform path", async () => {
    const testDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-external-adapter-reload-"));
    temporaryDirectories.push(testDirectory);
    const packageDirectory = path.join(testDirectory, "adapter package");
    const paperclipHome = path.join(testDirectory, "paperclip home");
    await fs.mkdir(packageDirectory, { recursive: true });

    await fs.writeFile(
      path.join(packageDirectory, "package.json"),
      JSON.stringify({
        name: "paperclip-test-reload-adapter",
        version: "1.0.0",
        type: "module",
        exports: { ".": "./index.js" },
      }),
    );
    const entryPath = path.join(packageDirectory, "index.js");
    await fs.writeFile(
      entryPath,
      'export function createServerAdapter() { return { type: "reload_marker_initial" }; }\n',
    );

    const scriptPath = path.join(testDirectory, "verify-reload.mjs");
    const loaderUrl = pathToFileURL(path.resolve("server/src/adapters/plugin-loader.ts")).href;
    const storeUrl = pathToFileURL(path.resolve("server/src/services/adapter-plugin-store.ts")).href;
    const tsxLoaderUrl = pathToFileURL(path.resolve("server/node_modules/tsx/dist/loader.mjs")).href;
    await fs.writeFile(scriptPath, `
      import fs from "node:fs/promises";
      process.env.PAPERCLIP_HOME = ${JSON.stringify(paperclipHome)};
      const { addAdapterPlugin } = await import(${JSON.stringify(storeUrl)});
      const { reloadExternalAdapter } = await import(${JSON.stringify(loaderUrl)});
      addAdapterPlugin({
        packageName: "paperclip-test-reload-adapter",
        localPath: ${JSON.stringify(packageDirectory)},
        type: "reload_test",
        installedAt: new Date(0).toISOString(),
      });
      const initial = await reloadExternalAdapter("reload_test");
      if (initial?.type !== "reload_marker_initial") throw new Error("initial reload did not load initial module");
      await new Promise((resolve) => setTimeout(resolve, 10));
      await fs.writeFile(
        ${JSON.stringify(entryPath)},
        'export function createServerAdapter() { return { type: "reload_marker_fresh" }; }\\n',
      );
      const reloaded = await reloadExternalAdapter("reload_test");
      if (reloaded?.type !== "reload_marker_fresh") throw new Error("reload returned stale module");
    `);

    await expect(execFileAsync(process.execPath, ["--import", tsxLoaderUrl, scriptPath], {
      cwd: process.cwd(),
      env: { ...process.env, PAPERCLIP_HOME: paperclipHome },
    })).resolves.toMatchObject({ stderr: "" });
  });
});
