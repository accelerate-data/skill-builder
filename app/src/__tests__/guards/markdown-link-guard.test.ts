import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/**
 * Guard test: every <ReactMarkdown> usage in production code must include
 * components={markdownComponents} to prevent links from navigating the
 * Tauri webview (which crashes the SPA).
 *
 * If you're adding a new ReactMarkdown usage, import markdownComponents
 * from "@/components/markdown-link" and pass it as the components prop.
 */

function walkDir(dir: string, ext: string[]): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__" || entry.name === "test" || entry.name === "node_modules") continue;
      results.push(...walkDir(full, ext));
    } else if (ext.some((e) => entry.name.endsWith(e)) && !entry.name.includes(".test.") && !entry.name.includes(".spec.")) {
      results.push(full);
    }
  }
  return results;
}

describe("markdown link guard", () => {
  it("all ReactMarkdown usages include markdownComponents", () => {
    const srcDir = path.resolve(__dirname, "../../");
    const files = walkDir(srcDir, [".tsx", ".ts"]);

    const violations: string[] = [];

    for (const file of files) {
      const content = fs.readFileSync(file, "utf-8");
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (
          line.includes("<ReactMarkdown") &&
          !line.includes("markdownComponents")
        ) {
          const rel = path.relative(srcDir, file);
          violations.push(`${rel}:${i + 1}: ${line.trim()}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
