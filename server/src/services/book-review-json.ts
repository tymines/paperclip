/**
 * Extract one unambiguous JSON object from a critic response.
 *
 * Hermes CLI output can prefix the requested payload with reasoning or
 * diagnostics. A first-"{"/last-"}" slice joins those unrelated blocks and
 * corrupts otherwise valid review JSON. Scan every balanced object candidate
 * instead, respecting quoted strings and escapes, then keep only valid,
 * outermost JSON objects. More than one valid outermost object is ambiguous
 * and therefore fails closed rather than guessing which review to trust.
 */
export function extractSingleJsonObject(raw: string): unknown {
  const candidates: Array<{ start: number; end: number; value: unknown }> = [];

  for (let start = 0; start < raw.length; start += 1) {
    if (raw[start] !== "{") continue;

    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < raw.length; index += 1) {
      const char = raw[index]!;
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === '"') {
          inString = false;
        }
        continue;
      }

      if (char === '"') {
        inString = true;
      } else if (char === "{") {
        depth += 1;
      } else if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          try {
            candidates.push({
              start,
              end: index,
              value: JSON.parse(raw.slice(start, index + 1)) as unknown,
            });
          } catch {
            // A balanced brace block is not necessarily JSON (for example a
            // diagnostic template). Continue scanning later start positions.
          }
          break;
        }
        if (depth < 0) break;
      }
    }
  }

  const outermost = candidates.filter(
    (candidate) =>
      !candidates.some(
        (other) =>
          other !== candidate &&
          other.start <= candidate.start &&
          other.end >= candidate.end,
      ),
  );
  if (outermost.length === 0) {
    throw new Error("no valid JSON object in critic output");
  }
  if (outermost.length > 1) {
    throw new Error("ambiguous JSON objects in critic output");
  }
  return outermost[0]!.value;
}
