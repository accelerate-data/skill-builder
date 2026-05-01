import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const sourceRoot = path.resolve(__dirname, "../../");

function walkSourceFiles(dir: string): string[] {
  const files: string[] = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === "__tests__" || entry.name === "node_modules" || entry.name === "test") continue;
      files.push(...walkSourceFiles(fullPath));
      continue;
    }

    if ((entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) && !entry.name.endsWith(".d.ts")) {
      files.push(fullPath);
    }
  }

  return files;
}

describe("Tauri command policy", () => {
  it("centralizes raw Tauri invoke access in lib/tauri.ts", () => {
    const offenders: string[] = [];

    for (const filePath of walkSourceFiles(sourceRoot)) {
      const relPath = path.relative(sourceRoot, filePath).replace(/\\/g, "/");
      const source = fs.readFileSync(filePath, "utf8");

      if (source.includes("@tauri-apps/api/core") && relPath !== "lib/tauri.ts") {
        offenders.push(relPath);
      }
    }

    expect(offenders).toEqual([]);
  });

  it("keeps invokeUnsafe private to the wrapper module", () => {
    const offenders: string[] = [];

    for (const filePath of walkSourceFiles(sourceRoot)) {
      const relPath = path.relative(sourceRoot, filePath).replace(/\\/g, "/");
      if (relPath === "lib/tauri.ts") continue;

      const source = fs.readFileSync(filePath, "utf8");
      if (source.includes("invokeUnsafe")) offenders.push(relPath);
    }

    expect(offenders).toEqual([]);
  });

  it("exposes typed invokeCommand and names the raw escape hatch explicitly", () => {
    const source = fs.readFileSync(path.join(sourceRoot, "lib/tauri.ts"), "utf8");

    expect(source).toContain("export const invokeCommand");
    expect(source).toContain("export const invokeUnsafe");
    expect(source).not.toContain("export { invoke }");
  });
});
