import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

describe("AgentEvent type sync", () => {
  const sidecarPath = path.resolve(__dirname, "../../../sidecar/agent-events.ts");
  const frontendPath = path.resolve(__dirname, "../../lib/agent-events.ts");

  function extractVersion(filePath: string): number {
    const content = fs.readFileSync(filePath, "utf8");
    const match = content.match(/AGENT_EVENTS_VERSION\s*=\s*(\d+)/);
    if (!match) throw new Error(`No AGENT_EVENTS_VERSION found in ${filePath}`);
    return parseInt(match[1], 10);
  }

  function extractInterfaceUnionMembers(content: string, typeName: string): string[] {
    const regex = new RegExp(`type ${typeName}\\s*=[\\s\\S]*?;`);
    const match = content.match(regex);
    if (!match) return [];
    return match[0]
      .split("=")[1]
      .replace(/;/g, "")
      .split("|")
      .map((member) => member.trim())
      .filter(Boolean)
      .sort();
  }

  function extractInterfaceFields(content: string, interfaceName: string): string[] {
    const regex = new RegExp(`interface ${interfaceName}\\s*\\{([\\s\\S]*?)\\}`, "m");
    const match = content.match(regex);
    if (!match) return [];
    return ((match[1].match(/^\s+(\w+)\??\s*:/gm) ?? []).map((f) =>
      f.trim().replace(/\??:$/, ""),
    )).sort();
  }

  it("version numbers match", () => {
    expect(extractVersion(frontendPath)).toBe(extractVersion(sidecarPath));
  });

  it("AgentEvent variants match", () => {
    const sidecarContent = fs.readFileSync(sidecarPath, "utf8");
    const frontendContent = fs.readFileSync(frontendPath, "utf8");
    expect(extractInterfaceUnionMembers(frontendContent, "AgentEvent")).toEqual(
      extractInterfaceUnionMembers(sidecarContent, "AgentEvent"),
    );
  });

  for (const interfaceName of [
    "ModelUsageEntry",
    "RunConfigEvent",
    "RunInitEvent",
    "TurnUsageEvent",
    "CompactionEvent",
    "ContextWindowEvent",
    "SessionExhaustedEvent",
    "InitProgressEvent",
    "TurnCompleteEvent",
    "RunResultEvent",
  ]) {
    it(`${interfaceName} fields match`, () => {
      const sidecarContent = fs.readFileSync(sidecarPath, "utf8");
      const frontendContent = fs.readFileSync(frontendPath, "utf8");
      expect(extractInterfaceFields(frontendContent, interfaceName)).toEqual(
        extractInterfaceFields(sidecarContent, interfaceName),
      );
    });
  }
});
