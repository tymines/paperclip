import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { zipSync } from "fflate";

const TRAINING_IMAGE_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".bmp",
  ".heic",
  ".tiff",
]);

export async function createTrainingImagesArchive(dir: string, slug: string): Promise<string> {
  const files = (await fs.readdir(dir, { withFileTypes: true }))
    .filter(
      (entry) =>
        entry.isFile() &&
        !entry.name.startsWith(".") &&
        TRAINING_IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()),
    )
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
  if (files.length === 0) {
    throw new Error("No training images found in the selected directory.");
  }

  const entries = Object.fromEntries(
    await Promise.all(
      files.map(async (name) => [name, new Uint8Array(await fs.readFile(path.join(dir, name)))]),
    ),
  );
  const zipPath = path.join(os.tmpdir(), `${slug}-training-${process.pid}.zip`);
  await fs.rm(zipPath, { force: true });
  await fs.writeFile(zipPath, zipSync(entries));
  return zipPath;
}
