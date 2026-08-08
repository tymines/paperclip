import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createTrainingImagesArchive } from "./training-archive.js";

const cleanupPaths: string[] = [];

function readStoredZipEntries(archive: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>();
  let offset = 0;
  while (offset + 4 <= archive.length && archive.readUInt32LE(offset) === 0x04034b50) {
    const flags = archive.readUInt16LE(offset + 6);
    const method = archive.readUInt16LE(offset + 8);
    const compressedSize = archive.readUInt32LE(offset + 18);
    const nameLength = archive.readUInt16LE(offset + 26);
    const extraLength = archive.readUInt16LE(offset + 28);
    expect(flags & 0x0800).toBe(0x0800);
    expect(method).toBe(0);

    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const name = archive.subarray(nameStart, nameStart + nameLength).toString("utf8");
    entries.set(name, archive.subarray(dataStart, dataStart + compressedSize));
    offset = dataStart + compressedSize;
  }
  expect(archive.readUInt32LE(offset)).toBe(0x02014b50);
  return entries;
}

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

    const entries = readStoredZipEntries(await fs.readFile(archivePath));
    expect([...entries.keys()]).toEqual(["portrait.JPG", "pose.png"]);
    expect([...entries.keys()].every((name) => !name.includes("/") && !name.includes("\\")))
      .toBe(true);
    expect(entries.get("portrait.JPG")?.toString("utf8")).toBe("portrait");
    expect(entries.get("pose.png")?.toString("utf8")).toBe("pose");
  });
});
