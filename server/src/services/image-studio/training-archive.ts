import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const TRAINING_IMAGE_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".bmp",
  ".heic",
  ".tiff",
]);

const ZIP_LOCAL_FILE_HEADER = 0x04034b50;
const ZIP_CENTRAL_DIRECTORY_HEADER = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const ZIP_UTF8_FLAG = 0x0800;
const ZIP_VERSION = 20;
const ZIP_DOS_EPOCH_DATE = 0x0021;

const CRC32_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = (crc & 1) === 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return crc >>> 0;
});

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

interface ZipEntry {
  name: Buffer;
  data: Buffer;
  checksum: number;
  localHeaderOffset: number;
}

function assertZip32(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) {
    throw new Error(`${label} exceeds the ZIP32 archive limit.`);
  }
}

function createStoredZip(files: Array<{ name: string; data: Buffer }>): Buffer {
  if (files.length > 0xffff) {
    throw new Error("Training archive contains too many files for ZIP32.");
  }

  const localParts: Buffer[] = [];
  const entries: ZipEntry[] = [];
  let localOffset = 0;

  for (const file of files) {
    const name = Buffer.from(file.name, "utf8");
    if (name.length === 0 || name.length > 0xffff) {
      throw new Error("Training image filename is invalid for a ZIP archive.");
    }
    assertZip32(file.data.length, `Training image ${file.name}`);
    assertZip32(localOffset, "Training archive offset");

    const checksum = crc32(file.data);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(ZIP_LOCAL_FILE_HEADER, 0);
    localHeader.writeUInt16LE(ZIP_VERSION, 4);
    localHeader.writeUInt16LE(ZIP_UTF8_FLAG, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(ZIP_DOS_EPOCH_DATE, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(file.data.length, 18);
    localHeader.writeUInt32LE(file.data.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, name, file.data);
    entries.push({ name, data: file.data, checksum, localHeaderOffset: localOffset });
    localOffset += localHeader.length + name.length + file.data.length;
  }

  const centralParts: Buffer[] = [];
  let centralSize = 0;
  for (const entry of entries) {
    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(ZIP_CENTRAL_DIRECTORY_HEADER, 0);
    centralHeader.writeUInt16LE(ZIP_VERSION, 4);
    centralHeader.writeUInt16LE(ZIP_VERSION, 6);
    centralHeader.writeUInt16LE(ZIP_UTF8_FLAG, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(ZIP_DOS_EPOCH_DATE, 14);
    centralHeader.writeUInt32LE(entry.checksum, 16);
    centralHeader.writeUInt32LE(entry.data.length, 20);
    centralHeader.writeUInt32LE(entry.data.length, 24);
    centralHeader.writeUInt16LE(entry.name.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(entry.localHeaderOffset, 42);
    centralParts.push(centralHeader, entry.name);
    centralSize += centralHeader.length + entry.name.length;
  }

  assertZip32(localOffset, "Training archive central directory offset");
  assertZip32(centralSize, "Training archive central directory");

  const end = Buffer.alloc(22);
  end.writeUInt32LE(ZIP_END_OF_CENTRAL_DIRECTORY, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(localOffset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, ...centralParts, end]);
}

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

  const entries = await Promise.all(
    files.map(async (name) => ({ name, data: await fs.readFile(path.join(dir, name)) })),
  );
  const zipPath = path.join(os.tmpdir(), `${slug}-training-${process.pid}.zip`);
  await fs.rm(zipPath, { force: true });
  await fs.writeFile(zipPath, createStoredZip(entries));
  return zipPath;
}
