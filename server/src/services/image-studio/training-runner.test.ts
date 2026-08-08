import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { unzipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";
import { createTrainingImagesArchive } from "./training-archive.js";

const cleanupPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanupPaths.splice(0).map((target) => fs.rm(target, { recursive: true, force: true })),
  );
});

describe("createTrainingImagesArchive", () => {
  it("writes flat image entries in-process and excludes dotfiles", async () => {
    const photosDir = await fs.mkdtemp(path.join(os.tmpdir(), "training-archive-test-"));
    cleanupPaths.push(photosDir);
    await fs.writeFile(path.join(photosDir, "portrait.JPG"), "portrait");
    await fs.writeFile(path.join(photosDir, "pose.png"), "pose");
    await fs.writeFile(path.join(photosDir, ".hidden.jpg"), "hidden");
    await fs.writeFile(path.join(photosDir, ".DS_Store"), "metadata");
    await fs.writeFile(path.join(photosDir, "notes.txt"), "notes");
    await fs.mkdir(path.join(photosDir, "nested"));
    await fs.writeFile(path.join(photosDir, "nested", "nested.webp"), "nested");

    const archivePath = await createTrainingImagesArchive(
      photosDir,
      `test-${randomUUID()}`,
    );
    cleanupPaths.push(archivePath);

    const entries = unzipSync(new Uint8Array(await fs.readFile(archivePath)));
    expect(Object.keys(entries)).toEqual(["portrait.JPG", "pose.png"]);
    expect(Object.keys(entries).every((name) => !name.includes("/") && !name.includes("\\")))
      .toBe(true);
    expect(Buffer.from(entries["portrait.JPG"]!).toString("utf8")).toBe("portrait");
    expect(Buffer.from(entries["pose.png"]!).toString("utf8")).toBe("pose");
  });
});
