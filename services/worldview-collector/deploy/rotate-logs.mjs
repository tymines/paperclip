#!/usr/bin/env node
import { copyFile, stat, truncate } from "node:fs/promises";

const limit = Number(process.env.WORLDVIEW_LOG_MAX_BYTES || 10 * 1024 * 1024);
for (const file of process.argv.slice(2)) {
  try {
    if ((await stat(file)).size < limit) continue;
    await copyFile(file, `${file}.1`);
    await truncate(file, 0);
  } catch (error) {
    if (error?.code !== "ENOENT") console.error(`[worldview-log-rotate] ${file}: ${error.message}`);
  }
}
