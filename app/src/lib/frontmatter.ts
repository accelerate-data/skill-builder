/** Parsed YAML frontmatter fields from a SKILL.md file. */
export interface SkillFrontmatter {
  name?: string;
  description?: string;
  domain?: string;
  type?: string;
  tools?: string;
  model?: string;
  version?: string;
  author?: string;
  [key: string]: string | undefined;
}

export interface ParsedSkillContent {
  frontmatter: SkillFrontmatter | null;
  body: string;
}

/**
 * Parse YAML frontmatter from SKILL.md content.
 * Handles flat key-value pairs only (no nested objects or anchors).
 * Tolerates CRLF line endings.
 */
export function parseFrontmatter(content: string): ParsedSkillContent {
  const normalized = content.replace(/\r\n/g, "\n");
  const trimmed = normalized.trimStart();

  if (!trimmed.startsWith("---")) {
    return { frontmatter: null, body: content };
  }

  const afterFirst = trimmed.slice(3);
  const endMatch = afterFirst.match(/\n---[ \t]*(\n|$)/);
  if (!endMatch || endMatch.index === undefined) {
    return { frontmatter: null, body: content };
  }

  const yamlBlock = afterFirst.slice(0, endMatch.index);
  const body = afterFirst.slice(endMatch.index + endMatch[0].length).replace(/^\n+/, "");

  const frontmatter: SkillFrontmatter = {};
  let currentMultilineKey: string | null = null;
  let multilineBuf = "";

  for (const line of yamlBlock.split("\n")) {
    const trimmedLine = line.trim();

    // Continuation line for multi-line scalar
    if (
      currentMultilineKey &&
      (line.startsWith(" ") || line.startsWith("\t")) &&
      trimmedLine.length > 0
    ) {
      if (multilineBuf.length > 0) multilineBuf += " ";
      multilineBuf += trimmedLine;
      continue;
    }

    // Flush accumulated multi-line value
    if (currentMultilineKey) {
      const val = multilineBuf.trim();
      if (val) frontmatter[currentMultilineKey] = val;
      currentMultilineKey = null;
      multilineBuf = "";
    }

    // Parse key: value
    const colonIdx = trimmedLine.indexOf(":");
    if (colonIdx === -1) continue;

    const key = trimmedLine.slice(0, colonIdx).trim().replace(/-/g, "_");
    const rawVal = trimmedLine.slice(colonIdx + 1).trim();

    if (rawVal === ">" || rawVal === "|") {
      currentMultilineKey = key;
      multilineBuf = "";
    } else {
      const cleaned =
        (rawVal.startsWith('"') && rawVal.endsWith('"')) ||
        (rawVal.startsWith("'") && rawVal.endsWith("'"))
          ? rawVal.slice(1, -1)
          : rawVal;
      if (cleaned) frontmatter[key] = cleaned;
    }
  }

  // Flush trailing multi-line
  if (currentMultilineKey) {
    const val = multilineBuf.trim();
    if (val) frontmatter[currentMultilineKey] = val;
  }

  const hasFields = Object.keys(frontmatter).length > 0;
  return { frontmatter: hasFields ? frontmatter : null, body };
}

/** Check if a filename is a SKILL.md file. */
export function isSkillFile(filename: string): boolean {
  const normalized = filename.replace(/\\/g, "/");
  return normalized === "SKILL.md" || normalized.endsWith("/SKILL.md");
}
