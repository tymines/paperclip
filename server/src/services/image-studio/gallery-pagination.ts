const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface GalleryCursor {
  createdAt: Date;
  id: string;
}

/** Encode the stable `(created_at, id)` position used by gallery pagination. */
export function encodeGalleryCursor(value: { createdAt: Date; id: string }): string {
  return Buffer.from(
    JSON.stringify({ createdAt: value.createdAt.toISOString(), id: value.id }),
    "utf8",
  ).toString("base64url");
}

/** Decode and validate an opaque gallery cursor supplied by a client. */
export function decodeGalleryCursor(raw: string): GalleryCursor {
  try {
    const value = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as {
      createdAt?: unknown;
      id?: unknown;
    };
    if (typeof value.createdAt !== "string" || typeof value.id !== "string") {
      throw new Error("missing fields");
    }
    const createdAt = new Date(value.createdAt);
    if (!Number.isFinite(createdAt.getTime()) || !UUID_PATTERN.test(value.id)) {
      throw new Error("invalid fields");
    }
    return { createdAt, id: value.id };
  } catch {
    throw new Error("Invalid gallery cursor");
  }
}
