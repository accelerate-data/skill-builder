import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/**
 * Structural sync test: ensures the frontend display-types.ts mirror stays
 * in sync with the canonical sidecar definition via DISPLAY_TYPES_VERSION.
 */
describe("DisplayItem type sync", () => {
  const sidecarPath = path.resolve(__dirname, "../../../sidecar/display-types.ts");
  const frontendPath = path.resolve(__dirname, "../../lib/display-types.ts");

  function extractVersion(filePath: string): number {
    const content = fs.readFileSync(filePath, "utf8");
    const match = content.match(/DISPLAY_TYPES_VERSION\s*=\s*(\d+)/);
    if (!match) throw new Error(`No DISPLAY_TYPES_VERSION found in ${filePath}`);
    return parseInt(match[1], 10);
  }

  function extractTypeUnion(content: string, typeName: string): string[] {
    const regex = new RegExp(`type ${typeName}\\s*=[\\s\\S]*?;`);
    const match = content.match(regex);
    if (!match) return [];
    const members = match[0].match(/"[^"]+"/g);
    return (members ?? []).map((m) => m.replace(/"/g, "")).sort();
  }

  function extractInterfaceFields(content: string, interfaceName: string): string[] {
    const regex = new RegExp(`interface ${interfaceName}\\s*\\{([\\s\\S]*?)\\}`, "m");
    const match = content.match(regex);
    if (!match) return [];
    // Extract field names (lines like "  fieldName?: Type;" or "  fieldName: Type;")
    const fields = match[1].match(/^\s+(\w+)\??\s*:/gm);
    return (fields ?? []).map((f) => f.trim().replace(/\??:$/, "")).sort();
  }

  it("version numbers match", () => {
    const sidecarVersion = extractVersion(sidecarPath);
    const frontendVersion = extractVersion(frontendPath);
    expect(frontendVersion).toBe(sidecarVersion);
  });

  it("DisplayItemType variants match", () => {
    const sidecarContent = fs.readFileSync(sidecarPath, "utf8");
    const frontendContent = fs.readFileSync(frontendPath, "utf8");
    expect(extractTypeUnion(frontendContent, "DisplayItemType")).toEqual(
      extractTypeUnion(sidecarContent, "DisplayItemType"),
    );
  });

  it("ToolStatus variants match", () => {
    const sidecarContent = fs.readFileSync(sidecarPath, "utf8");
    const frontendContent = fs.readFileSync(frontendPath, "utf8");
    expect(extractTypeUnion(frontendContent, "ToolStatus")).toEqual(
      extractTypeUnion(sidecarContent, "ToolStatus"),
    );
  });

  it("SubagentStatus variants match", () => {
    const sidecarContent = fs.readFileSync(sidecarPath, "utf8");
    const frontendContent = fs.readFileSync(frontendPath, "utf8");
    expect(extractTypeUnion(frontendContent, "SubagentStatus")).toEqual(
      extractTypeUnion(sidecarContent, "SubagentStatus"),
    );
  });

  it("ResultStatus variants match", () => {
    const sidecarContent = fs.readFileSync(sidecarPath, "utf8");
    const frontendContent = fs.readFileSync(frontendPath, "utf8");
    expect(extractTypeUnion(frontendContent, "ResultStatus")).toEqual(
      extractTypeUnion(sidecarContent, "ResultStatus"),
    );
  });

  it("DisplayItem interface fields match", () => {
    const sidecarContent = fs.readFileSync(sidecarPath, "utf8");
    const frontendContent = fs.readFileSync(frontendPath, "utf8");
    expect(extractInterfaceFields(frontendContent, "DisplayItem")).toEqual(
      extractInterfaceFields(sidecarContent, "DisplayItem"),
    );
  });
});
