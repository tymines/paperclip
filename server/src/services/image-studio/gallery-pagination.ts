const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface GalleryCursor {
  createdAtMicros: string;
  id: string;
}

/** Encode the exact PostgreSQL `(created_at microseconds, id)` gallery position. */
export function encodeGalleryCursor(value: GalleryCursor): string {
  return Buffer.from(
    JSON.stringify(value),
    "utf8",
  ).toString("base64url");
}

/** Decode and validate an opaque gallery cursor supplied by a client. */
export function decodeGalleryCursor(raw: string): GalleryCursor {
  try {
    const value = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as {
      createdAtMicros?: unknown;
      id?: unknown;
    };
    if (typeof value.createdAtMicros !== "string" || typeof value.id !== "string") {
      throw new Error("missing fields");
    }
    if (!/^\d+$/.test(value.createdAtMicros) || !UUID_PATTERN.test(value.id)) {
      throw new Error("invalid fields");
    }
    return { createdAtMicros: value.createdAtMicros, id: value.id };
  } catch {
    throw new Error("Invalid gallery cursor");
  }
}
