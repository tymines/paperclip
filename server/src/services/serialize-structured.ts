/**
 * Deterministic structured-data serializer for JSONB fields.
 *
 * Renders nested records/arrays as stable readable text instead of the literal
 * "[object Object]" that results from naive template-literal interpolation.
 *
 * Rules:
 *  - string  → returned as-is
 *  - null/undefined → empty string
 *  - array   → each element recursively serialized, joined by "\n"
 *  - object  → sorted key: value lines, values recursively serialized
 *  - primitive (number, boolean) → String(value)
 */
export function serializeStructured(value: unknown, indent = 0): string {
  const pad = "  ".repeat(indent);

  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => serializeStructured(item, indent))
      .filter(Boolean)
      .join("\n");
  }

  // It's a plain object — render as stable key: value lines
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const lines = keys.map((key) => {
    const val = obj[key];
    if (val === null || val === undefined) {
      return `${pad}${key}: `;
    }
    if (typeof val === "string") {
      return `${pad}${key}: ${val}`;
    }
    if (typeof val === "number" || typeof val === "boolean") {
      return `${pad}${key}: ${String(val)}`;
    }
    if (Array.isArray(val)) {
      const items = val
        .map((v) => serializeStructured(v, indent + 1))
        .filter(Boolean)
        .join("\n");
      return `${pad}${key}:\n${items}`;
    }
    // Nested object — recurse
    return `${pad}${key}:\n${serializeStructured(val, indent + 1)}`;
  });

  return lines.join("\n");
}
