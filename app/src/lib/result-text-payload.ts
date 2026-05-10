export function stripSingleJsonMarkdownFence(text: string): string {
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced?.[1]?.trim() ?? text;
}

export function topLevelJsonObjectCandidates(text: string): string[] {
  const candidates: string[] = [];
  let depth = 0;
  let startIndex: number | null = null;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char == null) break;

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === "{") {
      if (depth === 0) startIndex = index;
      depth += 1;
      continue;
    }

    if (char === "}") {
      if (depth === 0) continue;
      depth -= 1;
      if (depth === 0 && startIndex != null) {
        candidates.push(text.slice(startIndex, index + 1));
        startIndex = null;
      }
    }
  }

  return candidates;
}

export function parseResultTextPayload(text: string): unknown | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const candidate = stripSingleJsonMarkdownFence(trimmed);

  try {
    return JSON.parse(candidate);
  } catch {
    for (const objectCandidate of topLevelJsonObjectCandidates(candidate).reverse()) {
      try {
        return JSON.parse(objectCandidate);
      } catch {
        continue;
      }
    }
    return null;
  }
}
